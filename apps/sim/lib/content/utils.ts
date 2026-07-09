import fs from 'fs/promises'

export async function ensureContentDirs(contentDir: string, authorsDir: string) {
  await fs.mkdir(contentDir, { recursive: true })
  await fs.mkdir(authorsDir, { recursive: true })
}

export function toIsoDate(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

export function byDateDesc<T extends { date: string }>(a: T, b: T) {
  return new Date(b.date).getTime() - new Date(a.date).getTime()
}

/** Most recent `updated ?? date` across a set of posts, or `undefined` if empty. */
export function latestModified<T extends { date: string; updated?: string }>(
  posts: T[]
): Date | undefined {
  return posts.length > 0
    ? new Date(Math.max(...posts.map((p) => new Date(p.updated ?? p.date).getTime())))
    : undefined
}
