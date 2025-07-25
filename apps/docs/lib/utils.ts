import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Combines multiple class names into a single string, merging Tailwind classes properly
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get the full URL for a video asset stored in Vercel Blob
 */
export function getVideoUrl(filename: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BLOB_BASE_URL
  if (!baseUrl) {
    console.warn('NEXT_PUBLIC_BLOB_BASE_URL not configured, falling back to local path')
    return `/${filename}`
  }
  return `${baseUrl}/${filename}`
}
