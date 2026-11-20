export async function listAllObjects(client, commandFactory, { bucket, prefix, log = console.log } = {}) {
  const objects = [];
  let continuationToken;
  let pages = 0;
  do {
    const input = { Bucket: bucket, Prefix: prefix, ...(continuationToken ? { ContinuationToken: continuationToken } : {}) };
    const result = await client.send(commandFactory(input));
    pages += 1;
    objects.push(...(result.Contents ?? []));
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    if (result.IsTruncated && !continuationToken) throw new Error(`R2 listing was truncated without a continuation token: ${prefix}`);
  } while (continuationToken);
  log({ prefix, pages_fetched: pages, objects_listed: objects.length, first_key: objects[0]?.Key ?? null, last_key: objects.at(-1)?.Key ?? null });
  return objects;
}

export function keyTimestamp(key) {
  const match = key.match(/\/(\d{8})\/(\d{6})(?:-[^/]+)?\.pb$/);
  if (!match) return null;
  const [date, time] = [match[1], match[2]];
  return new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`);
}

export function localDateOfKey(key) {
  const timestamp = keyTimestamp(key);
  return timestamp ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(timestamp) : null;
}

export function localMinuteSlotOfKey(key) {
  const timestamp = keyTimestamp(key);
  if (!timestamp) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(timestamp).reduce((result, part) => (result[part.type] = part.value, result), {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

export function missingJstMinuteSlots(date, seen) {
  const missing = [];
  for (let hour = 0; hour < 24; hour++) for (let minute = 0; minute < 60; minute++) {
    const slot = `${date.replaceAll('-', '')}${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
    if (!seen.has(slot)) missing.push(slot);
  }
  return missing;
}

export function utcDatesForJstDate(date) {
  const previousUtc = new Date(`${date}T00:00:00+09:00`);
  return [previousUtc.toISOString().slice(0, 10).replaceAll('-', ''), date.replaceAll('-', '')];
}
