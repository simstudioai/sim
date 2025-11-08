import fs from 'fs/promises'
import path from 'path'

export const BLOG_DIR = path.join(process.cwd(), 'content', 'blog')
export const AUTHORS_DIR = path.join(process.cwd(), 'content', 'authors')

export async function ensureContentDirs() {
  await fs.mkdir(BLOG_DIR, { recursive: true })
  await fs.mkdir(AUTHORS_DIR, { recursive: true })
}

export function toIsoDate(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

export function byDateDesc<T extends { date: string }>(a: T, b: T) {
  return new Date(b.date).getTime() - new Date(a.date).getTime()
}

export function stripMdxExtension(file: string) {
  return file.replace(/\.mdx?$/i, '')
}

export function isRelativeUrl(url: string) {
  return url.startsWith('/')
}
