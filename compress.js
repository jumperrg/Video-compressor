const fs = require("fs");
const path = require("path");
const readline = require("readline");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const cliProgress = require("cli-progress");
const chalk = require("chalk");
const { logEntry, logSessionSummary } = require("./logger");

ffmpeg.setFfmpegPath(ffmpegPath);

const TARGET_DIR = process.argv[2] || "./videos";
const EXTENSIONS = new Set([".mp4", ".mov"]);

// ─── UI helpers ──────────────────────────────────────────────────────────────

const W = 68;

function hr(char = "─") {
  return chalk.gray(char.repeat(W));
}

function line(text = "") {
  return chalk.gray("│") + " " + text;
}

function banner() {
  const logo = [
    "  ██████╗ ██████╗ ███╗   ███╗██████╗ ██████╗ ███████╗███████╗███████╗",
    " ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗██╔════╝██╔════╝██╔════╝",
    " ██║     ██║   ██║██╔████╔██║██████╔╝██████╔╝█████╗  ███████╗███████╗",
    " ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██╗██╔══╝  ╚════██║╚════██║",
    " ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║███████╗███████║███████║",
    "  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝",
  ];
  console.log();
  console.log(hr("═"));
  logo.forEach((l) => console.log(chalk.cyan(l)));
  console.log();
  console.log(chalk.gray("  H.264 · YouTube · Instagram · TikTok"));
  console.log(hr("═"));
  console.log();
}

function sectionHeader(title) {
  const pad = Math.max(0, W - title.length - 4);
  console.log();
  console.log(chalk.gray("┌── ") + chalk.bold.white(title) + " " + chalk.gray("─".repeat(pad) + "┐"));
}

function sectionFooter() {
  console.log(chalk.gray("└" + "─".repeat(W - 1) + "┘"));
}

function keyHint(bindings) {
  return bindings
    .map(([k, label]) => chalk.bgGray.black(` ${k} `) + " " + chalk.gray(label))
    .join(chalk.gray("   "));
}

// Notification banner — shown after the user confirms each file's review
function notify(type, message) {
  const styles = {
    success: { bg: chalk.bgGreen.black,  icon: " ✔ ", border: chalk.green },
    info:    { bg: chalk.bgCyan.black,   icon: " i ", border: chalk.cyan },
    warning: { bg: chalk.bgYellow.black, icon: " ⚠ ", border: chalk.yellow },
    error:   { bg: chalk.bgRed.white,    icon: " ✖ ", border: chalk.red },
  };
  const s = styles[type] || styles.info;
  const tag = s.bg(s.icon);
  console.log();
  console.log(s.border("  ┌" + "─".repeat(W - 4) + "┐"));
  console.log(s.border("  │") + "  " + tag + "  " + chalk.white(message) + s.border("  │"));
  console.log(s.border("  └" + "─".repeat(W - 4) + "┘"));
}

// ─── Core logic ──────────────────────────────────────────────────────────────

function scanFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(scanFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const base = path.basename(entry.name, path.extname(entry.name));
      if (EXTENSIONS.has(ext) && !base.endsWith("_comp")) {
        const { size } = fs.statSync(fullPath);
        results.push({ fullPath, size });
      }
    }
  }
  return results;
}

function formatBytes(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + " MB";
  return (bytes / 1e3).toFixed(2) + " KB";
}

function buildOutputPath(inputPath) {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  return path.join(dir, `${base}_comp${ext}`);
}

function waitKey() {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    // Ensure stdin is in the right state for raw keypress reading
    stdin.resume();
    stdin.setEncoding("utf8");
    if (stdin.isTTY) stdin.setRawMode(true);

    // Drain any buffered input before we start listening
    stdin.read();

    const onData = (buf) => {
      const key = buf.toString().toLowerCase().trim();
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      resolve(key);
    };

    stdin.once("data", onData);
  });
}

function compressFile(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    let durationSec = 0;

    const bar = new cliProgress.SingleBar({
      format:
        "  " + chalk.cyan("Compressing") +
        " {bar} " +
        chalk.white("{percentage}%") +
        chalk.gray(" │ ETA: {eta}s │ {value}/{total}s"),
      barCompleteChar: "█",
      barIncompleteChar: "░",
      barsize: 28,
      hideCursor: true,
      clearOnComplete: false,
    });

    ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-crf 23",
        "-preset slow",
        "-profile:v high",
        "-level:v 4.1",
        "-movflags +faststart",
        "-pix_fmt yuv420p",
        "-b:a 192k",
        "-ac 2",
        "-ar 48000",
      ])
      .on("codecData", (data) => {
        const match = data.duration && data.duration.match(/(\d+):(\d+):(\d+)/);
        if (match) {
          durationSec =
            parseInt(match[1]) * 3600 +
            parseInt(match[2]) * 60 +
            parseInt(match[3]);
          bar.start(durationSec || 100, 0);
        }
      })
      .on("progress", (progress) => {
        if (!bar.isActive) return;
        const timemark = progress.timemark || "00:00:00";
        const match = timemark.match(/(\d+):(\d+):(\d+)/);
        if (match) {
          const currentSec =
            parseInt(match[1]) * 3600 +
            parseInt(match[2]) * 60 +
            parseInt(match[3]);
          bar.update(Math.min(currentSec, durationSec));
        }
      })
      .on("end", () => {
        if (bar.isActive) bar.stop();
        resolve();
      })
      .on("error", (err) => {
        if (bar.isActive) bar.stop();
        reject(err);
      })
      .save(outputPath);
  });
}

// Returns: 'next' | 'delete' | 'quit'
async function promptReview(originalPath, compPath, originalSize, compSize) {
  const savedBytes = originalSize - compSize;
  const savedPct = (((originalSize - compSize) / originalSize) * 100).toFixed(1);

  sectionHeader("Review");
  console.log(line(chalk.gray("  Original   ") + chalk.white(formatBytes(originalSize).padStart(9)) + chalk.gray("  " + path.basename(originalPath))));
  console.log(line(chalk.gray("  Compressed ") + chalk.green(formatBytes(compSize).padStart(9))     + chalk.gray("  " + path.basename(compPath))));
  console.log(line(chalk.gray("  Saved      ") + chalk.cyan(formatBytes(savedBytes).padStart(9))    + chalk.cyan(`  (${savedPct}%)`)));
  console.log(line());
  console.log(line("  " + keyHint([["Enter", "keep both & next"], ["d", "delete original"], ["q", "quit"]])));
  sectionFooter();

  const key = await waitKey();
  if (key === "q") return "quit";
  if (key === "d") return "delete";
  return "next";
}

// ─── Path prompt ─────────────────────────────────────────────────────────────

function askPath(currentDir) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log();
    rl.question(
      chalk.gray("  Current: ") + chalk.white(currentDir) + "\n" +
      chalk.gray("  New path (leave blank to keep): "),
      (answer) => {
        rl.close();
        resolve(answer.trim() || currentDir);
      }
    );
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner();

  // Ask for folder path upfront
  let targetDir = path.resolve(await askPath(TARGET_DIR));
  console.clear();
  banner();

  let files;
  let autoMode = false;

  while (true) {
    console.log(line(chalk.gray("Folder  ") + chalk.white(targetDir)));
    console.log();

    try {
      files = scanFiles(targetDir);
    } catch (err) {
      console.log(chalk.red(`  Error scanning: ${err.message}`));
      files = [];
    }

    if (files.length === 0) {
      console.log(chalk.yellow("  No .mp4 or .mov files found in this folder."));
      console.log();
      console.log("  " + keyHint([["p", "change folder"], ["q", "quit"]]));
      console.log();
      const k = await waitKey();
      if (k === "q") { console.log(chalk.yellow("\n  Aborted.\n")); process.exit(0); }
      targetDir = path.resolve(await askPath(targetDir));
      console.clear();
      banner();
      continue;
    }

    files.sort((a, b) => b.size - a.size);

    const totalFolderBytes = files.reduce((sum, f) => sum + f.size, 0);

    sectionHeader(`Queue  (${files.length} file${files.length > 1 ? "s" : ""}, largest first)`);
    files.forEach((f, i) => {
      const idx  = chalk.gray(`${String(i + 1).padStart(2)}.`);
      const size = chalk.cyan(formatBytes(f.size).padStart(10));
      const name = chalk.white(path.basename(f.fullPath));
      const loc  = chalk.gray("  " + path.dirname(f.fullPath));
      console.log(line(`  ${idx} ${size}  ${name}${loc}`));
    });
    console.log(line());
    console.log(line(
      chalk.gray("  Total in folder  ") +
      chalk.white(formatBytes(totalFolderBytes).padStart(10)) +
      chalk.gray(`  across ${files.length} file${files.length > 1 ? "s" : ""}`)
    ));
    sectionFooter();

    console.log();
    console.log("  " + keyHint([["Enter", "start & review each"], ["a", "start all (no review)"], ["p", "change folder"], ["q", "abort"]]));
    console.log();

    const startKey = await waitKey();
    if (startKey === "q") {
      console.log(chalk.yellow("\n  Aborted. Nothing was changed.\n"));
      process.exit(0);
    }
    if (startKey === "p") {
      targetDir = path.resolve(await askPath(targetDir));
      console.clear();
      banner();
      continue;
    }
    autoMode = startKey === "a";
    break;
  }

  const totalOriginalBytes = files.reduce((sum, f) => sum + f.size, 0);

  // Track the output file currently being written so SIGINT can clean it up
  let currentOutputPath = null;

  function cleanup() {
    if (currentOutputPath && fs.existsSync(currentOutputPath)) {
      try {
        fs.unlinkSync(currentOutputPath);
        console.log(chalk.yellow(`\n  Interrupted — deleted partial file: ${path.basename(currentOutputPath)}`));
      } catch (_) {}
    }
    process.exit(1);
  }

  process.on("SIGINT",  cleanup);
  process.on("SIGTERM", cleanup);

  let successCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;
  let errorCount = 0;
  let totalSavedBytes = 0;
  let totalElapsedSec = 0;

  for (let i = 0; i < files.length; i++) {
    const { fullPath, size } = files[i];
    const outputPath = buildOutputPath(fullPath);

    sectionHeader(`File ${i + 1} of ${files.length}`);
    console.log(line(chalk.gray("  Name        ") + chalk.white(path.basename(fullPath))));
    console.log(line(chalk.gray("  Output name ") + chalk.gray(path.basename(outputPath))));
    console.log(line(chalk.gray("  Folder      ") + chalk.gray(path.dirname(fullPath))));
    console.log(line(chalk.gray("  Original    ") + chalk.cyan(formatBytes(size))));
    sectionFooter();
    console.log();

    if (fs.existsSync(outputPath)) {
      notify("warning", `Skipping — compressed file already exists: ${path.basename(outputPath)}`);
      skippedCount++;
      continue;
    }

    const startTime = Date.now();
    try {
      currentOutputPath = outputPath;
      await compressFile(fullPath, outputPath);
      currentOutputPath = null;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const newSize = fs.statSync(outputPath).size;
      const savedPct = (((size - newSize) / size) * 100).toFixed(1);
      successCount++;
      totalSavedBytes += size - newSize;
      totalElapsedSec += parseFloat(elapsed);
      logEntry({ inputPath: fullPath, outputPath, origSize: size, newSize, elapsedSec: elapsed });

      // Print updated file card with real output size and savings
      sectionHeader(`File ${i + 1} of ${files.length}  ✔`);
      console.log(line(chalk.gray("  Name        ") + chalk.white(path.basename(fullPath))));
      console.log(line(chalk.gray("  Output name ") + chalk.gray(path.basename(outputPath))));
      console.log(line(chalk.gray("  Folder      ") + chalk.gray(path.dirname(fullPath))));
      console.log(line(chalk.gray("  Original size ") + chalk.cyan(formatBytes(size))));
      console.log(line(chalk.gray("  New size ") + chalk.green(formatBytes(newSize))));
      console.log(line(chalk.gray("  Saved       ") + chalk.cyan(formatBytes(size - newSize)) + chalk.cyan(`  (${savedPct}%)`)));
      console.log(line(chalk.gray("  Duration    ") + chalk.white(`${elapsed}s`)));
      sectionFooter();
      console.log();

      if (autoMode) {
        notify("success", `Done in ${elapsed}s · saved ${savedPct}% · both files kept`);
      } else {
        const action = await promptReview(fullPath, outputPath, size, newSize);

        if (action === "delete") {
          fs.unlinkSync(fullPath);
          deletedCount++;
          notify("success", `Done in ${elapsed}s · saved ${savedPct}% · original deleted`);
        } else if (action === "quit") {
          notify("info", `Done in ${elapsed}s · saved ${savedPct}% · both files kept`);
          console.log(chalk.yellow("\n  Stopped. Remaining files untouched."));
          break;
        } else {
          notify("success", `Done in ${elapsed}s · saved ${savedPct}% · both files kept`);
        }
      }
    } catch (err) {
      currentOutputPath = null;
      notify("error", `Compression failed: ${err.message}`);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      errorCount++;
    }
  }

  const totalElapsedRounded = totalElapsedSec.toFixed(1);
  logSessionSummary({ totalFiles: successCount, totalSavedBytes, totalElapsedSec: totalElapsedRounded });

  const totalAfterBytes = totalOriginalBytes - totalSavedBytes;

  console.log();
  console.log(hr("═"));
  console.log(chalk.bold.white("  SUMMARY"));
  console.log(hr());
  console.log(line(chalk.green (`  ✔ Compressed        ${successCount} file${successCount !== 1 ? "s" : ""}`)));
  if (skippedCount) console.log(line(chalk.yellow(`  ⚠ Skipped           ${skippedCount} file${skippedCount !== 1 ? "s" : ""}`)));
  if (errorCount)   console.log(line(chalk.red   (`  ✖ Errors            ${errorCount}`)));
  if (deletedCount) console.log(line(chalk.red   (`  ✖ Originals deleted  ${deletedCount}`)));
  console.log(line());
  console.log(line(chalk.gray ("  Before              ") + chalk.white(formatBytes(totalOriginalBytes))));
  console.log(line(chalk.gray ("  After               ") + chalk.green(formatBytes(totalAfterBytes))));
  console.log(line(chalk.gray ("  Total saved         ") + chalk.cyan(formatBytes(totalSavedBytes)) + chalk.cyan(`  (${((totalSavedBytes / totalOriginalBytes) * 100).toFixed(1)}%)`)));
  console.log(line(chalk.gray ("  Total duration      ") + chalk.white(`${totalElapsedRounded}s`)));
  console.log(hr("═"));
  console.log();

  process.exit(0);
}

main();
