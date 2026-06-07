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

function compressFile(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    let durationSec = 0;

    const bar = new cliProgress.SingleBar({
      format:
        chalk.cyan("  Progress") +
        " |{bar}| {percentage}% | ETA: {eta}s | {value}/{total}s",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
      clearOnComplete: false,
    });

    ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-crf 23",              // visually lossless (18=near-lossless, 28=more compressed)
        "-preset slow",         // better compression ratio at same CRF
        "-profile:v high",      // H.264 High profile — required by YT/IG/TikTok
        "-level:v 4.1",         // max level for 1080p60 compatibility
        "-movflags +faststart", // place moov atom at start for streaming
        "-pix_fmt yuv420p",     // 8-bit 4:2:0 — only format all platforms accept
        "-b:a 192k",            // audio bitrate recommended by all three platforms
        "-ac 2",                // stereo audio
        "-ar 48000",            // 48 kHz sample rate (platform standard)
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

// Pause and ask the user what to do after each successful compression.
// Returns: 'next' | 'delete' | 'quit'
function promptReview(originalPath, compPath, originalSize, compSize) {
  const savings = (((originalSize - compSize) / originalSize) * 100).toFixed(1);

  console.log(chalk.bold("\n  Review result:"));
  console.log(chalk.gray(`    Original : ${formatBytes(originalSize).padStart(10)}  ${originalPath}`));
  console.log(chalk.green(`    Compressed: ${formatBytes(compSize).padStart(10)}  ${compPath}`));
  console.log(chalk.cyan(`    Saved     : ${savings}%`));
  console.log();
  console.log(
    chalk.white("  ") +
    chalk.bold("[Enter]") + chalk.gray(" keep both & continue   ") +
    chalk.bold("[d]") + chalk.red(" delete original   ") +
    chalk.bold("[q]") + chalk.gray(" quit")
  );

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // readline on Windows needs raw mode nudge to catch single keypresses
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    process.stdin.once("data", (buf) => {
      const key = buf.toString().toLowerCase().trim();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      rl.close();

      if (key === "q") {
        resolve("quit");
      } else if (key === "d") {
        resolve("delete");
      } else {
        resolve("next");
      }
    });
  });
}

async function main() {
  const resolvedDir = path.resolve(TARGET_DIR);
  console.log(chalk.bold("\n=== Video Compressor ==="));
  console.log(chalk.gray(`Scanning: ${resolvedDir}\n`));

  let files;
  try {
    files = scanFiles(resolvedDir);
  } catch (err) {
    console.error(chalk.red(`Error scanning directory: ${err.message}`));
    process.exit(1);
  }

  if (files.length === 0) {
    console.log(chalk.yellow("No .mp4 or .mov files found."));
    return;
  }

  // Sort largest first
  files.sort((a, b) => b.size - a.size);

  console.log(chalk.bold(`Found ${files.length} file(s) to compress (largest first):\n`));
  files.forEach((f, i) => {
    console.log(chalk.gray(`  ${i + 1}. [${formatBytes(f.size).padStart(10)}] ${f.fullPath}`));
  });
  console.log();

  let successCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;
  let errorCount = 0;
  let totalSavedBytes = 0;

  for (let i = 0; i < files.length; i++) {
    const { fullPath, size } = files[i];
    const outputPath = buildOutputPath(fullPath);

    console.log(chalk.bold(`\n[${i + 1}/${files.length}] ${path.basename(fullPath)}`));
    console.log(chalk.gray(`  Input:  ${fullPath}`));
    console.log(chalk.gray(`  Output: ${outputPath}`));
    console.log(chalk.gray(`  Size:   ${formatBytes(size)}`));

    if (fs.existsSync(outputPath)) {
      console.log(chalk.yellow("  Skipping — output file already exists."));
      skippedCount++;
      continue;
    }

    const startTime = Date.now();
    try {
      await compressFile(fullPath, outputPath);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const newSize = fs.statSync(outputPath).size;
      console.log(chalk.green(`  Compressed in ${elapsed}s`));
      successCount++;
      totalSavedBytes += size - newSize;
      logEntry({ inputPath: fullPath, outputPath, origSize: size, newSize });

      const action = await promptReview(fullPath, outputPath, size, newSize);

      if (action === "delete") {
        fs.unlinkSync(fullPath);
        deletedCount++;
        console.log(chalk.red(`  Original deleted.`));
      } else if (action === "quit") {
        console.log(chalk.yellow("\n  Stopping after current file. Originals untouched."));
        break;
      } else {
        console.log(chalk.gray("  Both files kept."));
      }
    } catch (err) {
      console.error(chalk.red(`  Error: ${err.message}`));
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      errorCount++;
    }
  }

  logSessionSummary({ totalFiles: successCount, totalSavedBytes });
  console.log(chalk.bold("\n=== Summary ==="));
  console.log(chalk.green(`  Compressed : ${successCount}`));
  if (deletedCount) console.log(chalk.red(`  Originals deleted: ${deletedCount}`));
  if (skippedCount) console.log(chalk.yellow(`  Skipped    : ${skippedCount}`));
  if (errorCount)   console.log(chalk.red(`  Errors     : ${errorCount}`));
  console.log();

  process.exit(0);
}

main();
