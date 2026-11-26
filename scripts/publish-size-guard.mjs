import fs from 'node:fs/promises';

// Stop with margin before GitHub's hard 100 MiB individual-file rejection.
export const MAX_PUBLISH_FILE_BYTES = 90 * 1024 * 1024;

export async function assertPublishableFiles(files, maxBytes = MAX_PUBLISH_FILE_BYTES) {
  const oversized = [];
  for (const file of files) {
    const size = (await fs.stat(file)).size;
    if (size >= maxBytes) oversized.push({ file, size });
  }
  if (oversized.length) {
    const details = oversized.map(({ file, size }) => `${file}: ${(size / 1024 / 1024).toFixed(2)} MiB`).join(', ');
    throw new Error(`Archive publication stopped before git commit: file reached the ${Math.floor(maxBytes / 1024 / 1024)} MiB safety limit (${details}). Split or compress the output before publishing.`);
  }
}
