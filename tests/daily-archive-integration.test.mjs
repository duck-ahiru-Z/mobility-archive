import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import parquet from 'parquetjs-lite';
import G from 'gtfs-realtime-bindings';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const tempDirectories = [];
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function encodeFeed(entities) {
  const type = G.transit_realtime.FeedMessage;
  return Buffer.from(type.encode(type.create({
    header: { gtfsRealtimeVersion: '2.0', timestamp: 1790895600 },
    entity: entities,
  })).finish());
}

function xmlEscape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function listXml(prefix, objects) {
  const entries = objects.map(({ key, bytes }) => `<Contents><Key>${xmlEscape(key)}</Key><LastModified>2026-10-02T00:00:00.000Z</LastModified><ETag>"fixture"</ETag><Size>${bytes.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>fixture</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${objects.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${entries}</ListBucketResult>`;
}

describe('daily archive fixture integration', () => {
  it('writes compatible Parquet and manifest while failing on R2 read, invalid protobuf, and hash mismatch', async () => {
    const keys = {
      wbReadFail: 'raw/gtfs-rt/wakayama-bus/vehicle-positions/20261001/150000.pb',
      wbValid: 'raw/gtfs-rt/wakayama-bus/vehicle-positions/20261001/150100.pb',
      wbEmpty: 'raw/gtfs-rt/wakayama-bus/trip-updates/20261001/150000.pb',
      nagaInvalid: 'raw/gtfs-rt/wakayama-bus-naga/vehicle-positions/20261001/150000.pb',
      nagaBadHash: 'raw/gtfs-rt/wakayama-bus-naga/trip-updates/20261001/150000.pb',
    };
    const nonEmpty = encodeFeed([{ id: 'synthetic-entity', vehicle: { position: { latitude: 12.34, longitude: 56.78 }, vehicle: { id: 'fixture-vehicle' } } }]);
    const empty = encodeFeed([]);
    const invalid = Buffer.from('not-a-protobuf');
    const stored = new Map([
      [keys.wbReadFail, { bytes: nonEmpty, status: 404 }],
      [keys.wbValid, { bytes: nonEmpty, hash: crypto.createHash('sha256').update(nonEmpty).digest('hex') }],
      [keys.wbEmpty, { bytes: empty, hash: crypto.createHash('sha256').update(empty).digest('hex') }],
      [keys.nagaInvalid, { bytes: invalid, hash: crypto.createHash('sha256').update(invalid).digest('hex') }],
      [keys.nagaBadHash, { bytes: nonEmpty, hash: '0'.repeat(64) }],
    ]);
    const methods = [];
    const server = createServer((request, response) => {
      methods.push(request.method);
      const url = new URL(request.url, 'http://localhost');
      const bucketPath = '/mobility-archive-raw/';
      const key = decodeURIComponent(url.pathname.slice(bucketPath.length));
      if (url.searchParams.has('list-type')) {
        const prefix = url.searchParams.get('prefix') || '';
        const objects = [...stored.entries()]
          .filter(([objectKey]) => objectKey.startsWith(prefix))
          .map(([objectKey, value]) => ({ key: objectKey, bytes: value.bytes }));
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(listXml(prefix, objects));
        return;
      }
      if (key === '_control/monthly/202610.json') {
        const body = Buffer.from(JSON.stringify({ bytes: 23456 }));
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
        response.end(body);
        return;
      }
      const item = stored.get(key);
      if (!item || item.status === 404) {
        response.writeHead(404, { 'content-type': 'application/xml' });
        response.end('<Error><Code>NoSuchKey</Code><Message>missing fixture</Message></Error>');
        return;
      }
      response.writeHead(200, {
        'content-type': 'application/x-protobuf',
        'content-length': item.bytes.length,
        'x-amz-meta-http_status': '200',
        'x-amz-meta-sha256': item.hash,
      });
      response.end(item.bytes);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    const root = await mkdtemp(path.join(os.tmpdir(), 'mobility-archive-fixture-'));
    tempDirectories.push(root);
    const outputDir = path.join(root, 'archive');

    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      const result = await execFileAsync(process.execPath, [path.join(repoRoot, 'scripts/daily-archive.mjs')], {
        cwd: repoRoot,
        timeout: 30000,
        env: {
          ...process.env,
          ARCHIVE_DATE: '2026-10-02',
          OUTPUT_DIR: outputDir,
          R2_ENDPOINT: `http://127.0.0.1:${address.port}`,
          R2_ACCOUNT_ID: 'fixture-account',
          R2_ACCESS_KEY_ID: 'fixture-key',
          R2_SECRET_ACCESS_KEY: 'fixture-secret-not-real',
          R2_BUCKET: 'mobility-archive-raw',
          ALLOW_PRIVATE_DATASET: 'true',
          AWS_EC2_METADATA_DISABLED: 'true',
        },
        maxBuffer: 2 * 1024 * 1024,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      exitCode = error.code;
      stdout = error.stdout || '';
      stderr = error.stderr || '';
    }

    expect(exitCode).toBe(1);
    expect(stderr).not.toContain('fixture-secret-not-real');
    expect(stdout, `daily archive did not finish its manifest: ${stderr}`).toContain('"status":"failed"');
    expect(methods.every((method) => method === 'GET')).toBe(true);

    const dayDir = path.join(outputDir, '2026', '10', '02');
    const manifest = JSON.parse(await readFile(path.join(dayDir, 'manifest.json'), 'utf8'));
    expect(manifest.dataset_schema_version).toBe('1');
    expect(manifest.expected_fetch_count).toBe(5760);
    expect(manifest.saved_raw_object_count).toBe(5);
    expect(manifest.r2_estimated_bytes).toBe(23456);
    expect(manifest.processing.status).toBe('failed');
    expect(manifest.processing.failure_count).toBe(3);

    const wb = manifest.sources.find((source) => source.source_id === 'wakayama-bus');
    const wbVehicle = wb.feeds.find((feed) => feed.feed_type === 'vehicle-positions');
    const wbTrip = wb.feeds.find((feed) => feed.feed_type === 'trip-updates');
    expect(wbVehicle.r2_read_failure_count).toBe(1);
    expect(wbVehicle.missing_intervals).toContain('202610020000');
    expect(wbTrip.valid_feed_count).toBe(1);
    expect(wbTrip.valid_empty_feed_count).toBe(1);
    expect(wbTrip.success_rate).toBeCloseTo(1 / 1440);

    const naga = manifest.sources.find((source) => source.source_id === 'wakayama-bus-naga');
    expect(naga.feeds.find((feed) => feed.feed_type === 'vehicle-positions').invalid_feed_count).toBe(1);
    expect(naga.feeds.find((feed) => feed.feed_type === 'trip-updates').checksum_mismatch_count).toBe(1);

    const parquetPath = path.join(dayDir, 'wakayama-bus.parquet');
    const reader = await parquet.ParquetReader.openFile(parquetPath, { rawStatistics: true });
    try {
      expect(reader.schema.fields).toHaveProperty('raw_object_key');
      expect(reader.schema.fields).toHaveProperty('raw_sha256');
      expect(reader.metadata.row_groups.reduce((count, group) => count + Number(group.num_rows), 0)).toBe(1);
    } finally {
      await reader.close();
    }
    await expect(readFile(path.join(dayDir, 'wakayama-bus-naga.parquet'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(stdout).toContain('"status":"failed"');
  });
});
