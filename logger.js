const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "logs");
const CSV_PATH = path.join(LOG_DIR, "compression_log.csv");
const TXT_PATH = path.join(LOG_DIR, "compression_log.txt");

const CSV_HEADER = "Date,Time,Filename,Location,Original Size (bytes),Compressed Size (bytes),Original Size (readable),Compressed Size (readable),Saved (bytes),Saved (%)";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function ensureCsvHeader() {
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, CSV_HEADER + "\n", "utf8");
  }
}

function formatBytes(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + " MB";
  return (bytes / 1e3).toFixed(2) + " KB";
}

function now() {
  const d = new Date();
  const date = d.toLocaleDateString("en-GB").replace(/\//g, "-"); // DD-MM-YYYY
  const time = d.toTimeString().slice(0, 8);                       // HH:MM:SS
  return { date, time };
}

// Escape a value for CSV (wraps in quotes if it contains comma or quote)
function csvEscape(val) {
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Append one compression entry to both log files.
 * @param {object} entry
 * @param {string} entry.inputPath   - full path of original file
 * @param {string} entry.outputPath  - full path of compressed file
 * @param {number} entry.origSize    - bytes
 * @param {number} entry.newSize     - bytes
 */
function logEntry({ inputPath, outputPath, origSize, newSize }) {
  ensureLogDir();
  ensureCsvHeader();

  const { date, time } = now();
  const filename = path.basename(inputPath);
  const location = path.dirname(inputPath);
  const savedBytes = origSize - newSize;
  const savedPct = (((origSize - newSize) / origSize) * 100).toFixed(1);
  const origReadable = formatBytes(origSize);
  const newReadable = formatBytes(newSize);
  const savedReadable = formatBytes(savedBytes);

  // --- CSV ---
  const csvRow = [
    date, time,
    csvEscape(filename),
    csvEscape(location),
    origSize, newSize,
    csvEscape(origReadable),
    csvEscape(newReadable),
    savedBytes,
    savedPct + "%",
  ].join(",");
  fs.appendFileSync(CSV_PATH, csvRow + "\n", "utf8");

  // --- Human-readable TXT ---
  const divider = "─".repeat(72);
  const block = [
    divider,
    `  Date/Time  : ${date}  ${time}`,
    `  File       : ${filename}`,
    `  Location   : ${location}`,
    `  Original   : ${origReadable.padStart(10)}   (${origSize.toLocaleString()} bytes)`,
    `  Compressed : ${newReadable.padStart(10)}   (${newSize.toLocaleString()} bytes)`,
    `  Saved      : ${savedReadable.padStart(10)}   (${savedPct}%)`,
    "",
  ].join("\n");
  fs.appendFileSync(TXT_PATH, block + "\n", "utf8");
}

/**
 * Append a session summary footer to the TXT log.
 * @param {object} summary
 * @param {number} summary.totalFiles
 * @param {number} summary.totalSavedBytes
 */
function logSessionSummary({ totalFiles, totalSavedBytes }) {
  ensureLogDir();
  const { date, time } = now();
  const block = [
    "═".repeat(72),
    `  SESSION SUMMARY  —  ${date}  ${time}`,
    `  Files compressed : ${totalFiles}`,
    `  Total space saved: ${formatBytes(totalSavedBytes)}`,
    "═".repeat(72),
    "",
    "",
  ].join("\n");
  fs.appendFileSync(TXT_PATH, block + "\n", "utf8");
}

module.exports = { logEntry, logSessionSummary };
