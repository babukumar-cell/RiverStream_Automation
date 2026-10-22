import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Default location for generated files when the caller does not pass a directory.
 * Tests should pass `test.info().outputPath()` instead so files live with the test results
 * and are cleaned up by Playwright; nothing is ever written inside the repository.
 */
const DEFAULT_TEMP_DIR = path.join(os.tmpdir(), 'riverstream-automation');

/**
 * Ensure the output directory exists and return it.
 */
export function ensureTempDir(outputDir: string = DEFAULT_TEMP_DIR): string {
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHmmss
}

/**
 * Creates a unique copy of an existing test file with a timestamp/random suffix
 * to prevent duplicate file rejection in River Stream.
 *
 * Example: 'claims.sif' -> '<outputDir>/claims_20261014124500_8391.sif'
 */
export function createUniqueTestFile(sourceFilePath: string, customPrefix?: string, outputDir?: string): string {
  if (!fs.existsSync(sourceFilePath)) {
    throw new Error(`Source test file not found: ${sourceFilePath}`);
  }
  const dir = ensureTempDir(outputDir);
  const parsed = path.parse(sourceFilePath);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const baseName = customPrefix ? `${customPrefix}_${parsed.name}` : parsed.name;
  const targetPath = path.join(dir, `${baseName}_${timestamp()}_${randomSuffix}${parsed.ext}`);
  fs.copyFileSync(sourceFilePath, targetPath);
  return targetPath;
}

/**
 * Copies a source file to `<outputDir>/<fileName>` (the extension of the source is kept when
 * `fileName` has none). Use with `uniqueName()` so uploaded documents are traceable test data.
 */
export function createNamedCopy(sourceFilePath: string, fileName: string, outputDir?: string): string {
  if (!fs.existsSync(sourceFilePath)) {
    throw new Error(`Source test file not found: ${sourceFilePath}`);
  }
  const dir = ensureTempDir(outputDir);
  const finalName = path.extname(fileName) ? fileName : `${fileName}${path.extname(sourceFilePath)}`;
  const targetPath = path.join(dir, finalName);
  fs.copyFileSync(sourceFilePath, targetPath);
  return targetPath;
}

/**
 * Creates an on-the-fly test file (e.g., .exe, .txt, no-ext, corrupted) for validation testing.
 */
export function createMockFile(fileName: string, content?: string | Buffer, outputDir?: string): string {
  const dir = ensureTempDir(outputDir);
  const targetPath = path.join(dir, fileName);
  fs.writeFileSync(targetPath, content !== undefined ? content : `Mock test content for ${fileName}`);
  return targetPath;
}

/**
 * Creates a sparse dummy PDF of the given size in MB (1 MB = 1024 * 1024 bytes) for size-limit testing.
 */
export function createLargeFile(fileName: string, sizeInMb: number = 30, outputDir?: string): string {
  const dir = ensureTempDir(outputDir);
  const targetPath = path.join(dir, fileName);
  const fd = fs.openSync(targetPath, 'w');
  try {
    fs.writeSync(fd, Buffer.from('%PDF-1.4\n% Large test file\n'));
    fs.ftruncateSync(fd, Math.round(sizeInMb * 1024 * 1024));
  } finally {
    fs.closeSync(fd);
  }
  return targetPath;
}

/**
 * Removes every file in the given output directory (defaults to the shared OS temp folder).
 */
export function cleanupTempFiles(outputDir: string = DEFAULT_TEMP_DIR): void {
  if (!fs.existsSync(outputDir)) return;
  for (const file of fs.readdirSync(outputDir)) {
    fs.rmSync(path.join(outputDir, file), { force: true, recursive: true });
  }
}
