import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Combines multiple class names into a single string, merging Tailwind classes properly
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get the full URL for an asset stored in Vercel Blob
 * - If CDN is configured (NEXT_PUBLIC_BLOB_BASE_URL), uses CDN URL
 * - Otherwise falls back to local static assets served from root path
 */
export function getAssetUrl(filename: string) {
  const cdnBaseUrl = process.env.NEXT_PUBLIC_BLOB_BASE_URL
  if (cdnBaseUrl) {
    return `${cdnBaseUrl}/${filename}`
  }
  return `/${filename}`
}
