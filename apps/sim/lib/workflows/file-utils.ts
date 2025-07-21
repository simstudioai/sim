import type { WorkflowFileReference } from './file-manager'

/**
 * Utility functions for working with workflow files
 */

/**
 * Get the appropriate URL for a file based on usage context
 *
 * @param file - The file reference
 * @param context - How the file will be used
 * @returns The appropriate URL
 */
export function getFileUrl(
  file: WorkflowFileReference,
  context: 'internal' | 'external' = 'internal'
): string {
  if (context === 'external' && file.directUrl) {
    // Use direct cloud storage URL for external services (Mistral OCR, etc.)
    return file.directUrl
  }

  // Use API path for internal use (with auth, logging, etc.)
  return file.path
}

/**
 * Get the direct cloud storage URL for external services
 * Falls back to API path if direct URL is not available
 *
 * @param file - The file reference
 * @returns Direct URL or API path as fallback
 */
export function getDirectFileUrl(file: WorkflowFileReference): string {
  return file.directUrl || file.path
}

/**
 * Get the API path for internal file access
 *
 * @param file - The file reference
 * @returns API path for internal access
 */
export function getInternalFileUrl(file: WorkflowFileReference): string {
  return file.path
}

/**
 * Check if a file has a direct cloud storage URL available
 *
 * @param file - The file reference
 * @returns True if direct URL is available
 */
export function hasDirectUrl(file: WorkflowFileReference): boolean {
  return Boolean(file.directUrl)
}

/**
 * Convert a full URL to a domain for display purposes
 *
 * @param url - The full URL
 * @returns Domain name or original URL if parsing fails
 */
export function getUrlDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return url
  }
}

/**
 * Check if a URL is a direct cloud storage URL (not an API path)
 *
 * @param url - The URL to check
 * @returns True if it's a direct cloud storage URL
 */
export function isDirectCloudUrl(url: string): boolean {
  return url.startsWith('https://') && !url.includes('/api/files/serve')
}

/**
 * Convert an API path to a full URL if needed
 *
 * @param path - The path (could be relative API path or full URL)
 * @param baseUrl - Base URL to use for relative paths (optional, uses current origin)
 * @returns Full URL
 */
export function toFullUrl(path: string, baseUrl?: string): string {
  if (path.startsWith('https://') || path.startsWith('http://')) {
    return path // Already a full URL
  }

  if (typeof window !== 'undefined') {
    // Browser environment
    return new URL(path, window.location.origin).toString()
  }

  if (baseUrl) {
    return new URL(path, baseUrl).toString()
  }

  // Fallback for server environment without baseUrl
  return path
}
