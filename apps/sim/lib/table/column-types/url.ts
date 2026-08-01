import { TypeUrl } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'

/**
 * A bare hostname, the form people paste most (`sim.ai`, `docs.sim.ai`).
 * Mirrors the grid's own bare-domain promotion so a value that already renders
 * as a link in a text column stays acceptable once the column is typed.
 */
const BARE_DOMAIN =
  /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:\d{1,5})?([/?#]\S*)?$/

/**
 * Normalizes to an absolute `http(s)` URL, or null when the value is not one.
 *
 * Only `http`/`https` are accepted: the grid renders this type as a clickable
 * anchor, so admitting `javascript:` or `data:` here would put a user-authored
 * scheme behind a link the next viewer clicks.
 */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  // Requires `//`, not just a colon. A bare `example.com:8080` matches the
  // colon-only form, and `new URL()` then reads `example.com:` as the SCHEME —
  // which is not http(s), so a perfectly ordinary host:port URL was rejected
  // and the cell nulled. With `//` required it falls through to BARE_DOMAIN.
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
      return url.toString()
    } catch {
      return null
    }
  }
  if (!BARE_DOMAIN.test(trimmed)) return null
  try {
    return new URL(`https://${trimmed}`).toString()
  } catch {
    return null
  }
}

export const urlColumnType: ColumnTypeDefinition = {
  id: 'url',
  label: 'URL',
  icon: TypeUrl,
  jsonbCast: null,
  orderable: true,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 'https://sim.ai',
  ownedMetadata: ownedKeysOf('url'),
  workflowInputType: 'string',
  editor: 'text',
  // A URL can be far longer than a cell is wide, so double-click opens the
  // expanded popover rather than a one-line inline editor.
  expandable: true,
  parseErrorMessage: 'Invalid URL',

  coerce(value) {
    if (typeof value !== 'string') return { ok: false }
    const normalized = normalizeUrl(value)
    return normalized === null ? { ok: false } : { ok: true, value: normalized }
  },

  validateCell(value, column) {
    if (typeof value !== 'string') return `${column.name} must be a URL`
    if (value === '') return null
    return normalizeUrl(value) === null ? `${column.name} must be a valid http(s) URL` : null
  },

  formatForDisplay(value) {
    return typeof value === 'string' ? value : ''
  },

  formatForInput(value) {
    return typeof value === 'string' ? value : ''
  },

  // Always linkable: the grid promotes the cell to a favicon link, or to an
  // in-workspace resource chip when the URL points back into Sim.
  display(value) {
    if (value === null || value === undefined || value === '') return { kind: 'empty' }
    return { kind: 'linkable', text: String(value) }
  },
}
