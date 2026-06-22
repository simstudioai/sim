import { parseAsInteger, parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definitions for the knowledge document
 * (chunk list + inline chunk editor) page. The client (`Document`) consumes this
 * typed param definition as the single source of truth.
 *
 * - `page` is the chunk pagination page, shareable and bookmarkable. It defaults
 *   to 1 and clears from the URL at the default to keep links clean.
 * - `chunk` deep-links a specific chunk so it can be focused/opened in the inline
 *   editor from a shared link.
 */
export const documentParsers = {
  page: parseAsInteger.withDefault(1),
  chunk: parseAsString,
} as const

/**
 * Shared nuqs options for the document page. Pagination is a transient view
 * change, so it replaces history rather than churning the back stack; defaults
 * clear from the URL.
 */
export const documentUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
