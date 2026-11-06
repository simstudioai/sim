import { compareStrings } from '@sim/utils/string'

/** Partitions discovered files without splitting their serial fixtures or omitting unmeasured files. */
export function partitionFiles(
  files: readonly string[],
  durations: Record<string, number>,
  count: number
): string[][] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid shard count')
  const measured = files
    .map((file) => durations[file])
    .filter((duration) => Number.isFinite(duration) && duration > 0)
    .sort((a, b) => a - b)
  const fallback = measured[Math.floor(measured.length / 2)] ?? 1
  const weight = (file: string) =>
    Number.isFinite(durations[file]) && durations[file] >= 0
      ? Math.max(1, durations[file])
      : fallback
  const shards = Array.from({ length: count }, () => ({ files: [] as string[], seconds: 0 }))
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || compareStrings(a, b))) {
    const target = shards.reduce((smallest, shard) =>
      shard.seconds < smallest.seconds ? shard : smallest
    )
    target.files.push(file)
    target.seconds += weight(file)
  }
  return shards.map((shard) => shard.files.sort(compareStrings))
}
