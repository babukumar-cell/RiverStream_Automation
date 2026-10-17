import fs from 'fs';
import path from 'path';

const TEMP_DIR = path.resolve(__dirname, '../test-data/temp');

/**
 * Ensure the temporary directory exists.
 */
export function ensureTempDir(): string {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  return TEMP_DIR;
}

/**
 * Creates a unique copy of an existing test file with a timestamp/random suffix
 * to prevent duplicate file rejection in River Stream.
 * 
 * Example: 'claims.sif' -> 'claims_20261014_124500_8391.sif'
 */
export function createUniqueTestFile(sourceFilePath: string, customPrefix?: string): string {
  if (!fs.existsSync(sourceFilePath)) {
    throw new Error(`Source test file not found: ${sourceFilePath}`);
  }

  ensureTempDir();

  const parsed = path.parse(sourceFilePath);
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHmmss
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  
  const baseName = customPrefix ? `${customPrefix}_${parsed.name}` : parsed.name;
  const uniqueFileName = `${baseName}_${dateStr}_${randomSuffix}${parsed.ext}`;
  const targetPath = path.join(TEMP_DIR, uniqueFileName);

  fs.copyFileSync(sourceFilePath, targetPath);
  return targetPath;
}

/**
 * Creates an on-the-fly test file (e.g., .exe, .txt, no-ext, corrupted) for validation testing.
 */
export function createMockFile(fileName: string, content?: string | Buffer): string {
  ensureTempDir();
  const targetPath = path.join(TEMP_DIR, fileName);

  if (content !== undefined) {
    fs.writeFileSync(targetPath, content);
  } else {
    // Default dummy content
    fs.writeFileSync(targetPath, `Mock test content for ${fileName}`);
  }

  return targetPath;
}

/**
 * Creates a large dummy file of a specified size in MB for size limit testing.
 */
export function createLargeFile(fileName: string, sizeInMb: number = 30): string {
  ensureTempDir();
  const targetPath = path.join(TEMP_DIR, fileName);

  const fd = fs.openSync(targetPath, 'w');
  fs.writeSync(fd, Buffer.from('%PDF-1.4\n% Large test file\n'));
  fs.ftruncateSync(fd, sizeInMb * 1024 * 1024);
  fs.closeSync(fd);

  return targetPath;
}

/**
 * Cleans up temporary test files.
 */
export function cleanupTempFiles(): void {
  if (fs.existsSync(TEMP_DIR)) {
    try {
      const files = fs.readdirSync(TEMP_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEMP_DIR, file));
      }
    } catch (err) {
      console.warn(`[file-utils] Warning during temp cleanup: ${(err as Error).message}`);
    }
  }
}
