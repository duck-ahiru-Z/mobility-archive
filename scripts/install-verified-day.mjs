import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function installVerifiedDay(stagingRoot, targetRoot, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Valid date required');
  const parts = date.split('-');
  const source = path.resolve(stagingRoot, ...parts);
  const target = path.resolve(targetRoot, ...parts);
  if (source === target) throw new Error('Staging must be separate');
  const report = JSON.parse(await fs.readFile(path.join(source, 'quality.json'), 'utf8'));
  if (report.date !== date || !['passed', 'degraded'].includes(report.status) || report.errors.length) throw new Error('Quality verification did not pass');
  await fs.mkdir(path.dirname(target), {recursive:true});
  const backup = path.resolve(stagingRoot, `${date}.previous`);
  try { await fs.stat(backup); throw new Error('Previous backup already exists; use a fresh staging directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let previous = false;
  try { await fs.rename(target, backup); previous = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await fs.rename(source, target); }
  catch (error) { if (previous) await fs.rename(backup, target); throw error; }
  // Prior data is already outside the git staging path and remains recoverable.
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await installVerifiedDay(process.argv[2], process.argv[3], process.env.ARCHIVE_DATE);
}
