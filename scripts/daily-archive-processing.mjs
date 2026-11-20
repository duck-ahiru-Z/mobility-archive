export const R2_GET_CONCURRENCY = 8;
export const PROCESS_BATCH_SIZE = 16;

export async function mapLimited(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

export async function processInBatches(items, batchSize, concurrency, mapper, consume) {
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    await consume(await mapLimited(batch, concurrency, mapper), start, items.length);
  }
}

export function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return null;
  return sortedValues[Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1)];
}

export function growthEstimate(dailyRawBytes) {
  return {
    projected_30_day_growth: dailyRawBytes * 30,
    projected_365_day_growth: dailyRawBytes * 365,
    projection_basis: 'estimate from this JST date raw-object bytes × days; not an R2 inventory delta',
    r2_growth_24h_bytes: null,
    r2_growth_24h_basis: 'not_measured',
  };
}
