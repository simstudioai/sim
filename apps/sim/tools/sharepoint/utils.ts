import { createLogger } from '@sim/logger'
import type { CanvasLayout, SharepointListItem } from '@/tools/sharepoint/types'
import type { OutputProperty } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('SharepointUtils')

export function optionalTrim(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  return trimmed || undefined
}

/**
 * Encodes one Graph path id. Separators stay percent-encoded rather than rejected so every id
 * that worked before (composite site ids `host,guid,guid`, drive ids `b!...`) is sent unchanged;
 * empty and dot-segment values are rejected.
 */
export function graphPathSegment(value: string, paramName: string): string {
  return safeUrlPathSegment(value, paramName, { allowSeparators: true })
}

export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function getGraphNextPageUrl(data: object): string | undefined {
  const nextLink = (data as Record<string, unknown>)['@odata.nextLink']
  return typeof nextLink === 'string' ? nextLink : undefined
}

export function assertGraphNextPageUrl(nextPageUrl: string): string {
  const trimmed = nextPageUrl.trim()
  const url = new URL(trimmed)
  if (url.origin !== 'https://graph.microsoft.com') {
    throw new Error('nextPageUrl must be a Microsoft Graph @odata.nextLink URL')
  }
  return url.toString()
}

/**
 * Validates an `@odata.nextLink` and asserts it continues the collection the caller is querying.
 *
 * Every paged operation reads the one shared Next Page field, and a subBlock keeps its value
 * after the operation changes. Without this check, paging `/users` and then switching the block
 * to `/devices` would short-circuit back to the user page, silently returning the previous
 * collection. Comparing the final path segment also rejects a continuation URL pasted from an
 * unrelated response.
 */
export function assertGraphNextPageUrlForCollection(
  nextPageUrl: string,
  expectedSegments: string[]
): string {
  const url = new URL(assertGraphNextPageUrl(nextPageUrl))
  const segments = url.pathname.split('/').filter(Boolean)
  const collection = segments[segments.length - 1]
  // Graph matches path segments case-insensitively, so a nextLink may not echo the request's casing.
  const expected = expectedSegments.map((segment) => segment.toLowerCase())
  if (!collection || !expected.includes(collection.toLowerCase())) {
    throw new Error(
      `Next Page URL continues "${collection ?? 'an unknown collection'}", but this operation reads "${expectedSegments.join('" or "')}". Clear the Next Page field when switching operations.`
    )
  }
  return url.toString()
}

function stripHtmlTags(html: string): string {
  let text = html
  let previous: string

  do {
    previous = text
    text = text.replace(/<[^>]*>/g, '')
    text = text.replace(/[<>]/g, '')
  } while (text !== previous)

  return text.trim()
}

export function extractTextFromCanvasLayout(canvasLayout: CanvasLayout | null | undefined): string {
  logger.info('Extracting text from canvas layout', {
    hasCanvasLayout: !!canvasLayout,
    hasHorizontalSections: !!canvasLayout?.horizontalSections,
    sectionsCount: canvasLayout?.horizontalSections?.length || 0,
  })

  if (!canvasLayout?.horizontalSections) {
    logger.info('No canvas layout or horizontal sections found')
    return ''
  }

  const textParts: string[] = []

  for (const section of canvasLayout.horizontalSections) {
    if (section.columns) {
      for (const column of section.columns) {
        if (column.webparts) {
          for (const webpart of column.webparts) {
            if (webpart.innerHtml) {
              const text = stripHtmlTags(webpart.innerHtml)
              if (text) {
                textParts.push(text)
              }
            }
          }
        }
      }
    } else if (section.webparts) {
      for (const webpart of section.webparts) {
        if (webpart.innerHtml) {
          const text = stripHtmlTags(webpart.innerHtml)
          if (text) textParts.push(text)
        }
      }
    }
  }

  const finalContent = textParts.join('\n\n')
  logger.info('Final extracted content', {
    textPartsCount: textParts.length,
    finalContentLength: finalContent.length,
  })

  return finalContent
}

/** SharePoint list item fields that are system-managed and cannot be set via the Graph API. */
export const READ_ONLY_LIST_ITEM_FIELDS = new Set<string>([
  'Id',
  'id',
  'UniqueId',
  'GUID',
  'ContentTypeId',
  'Created',
  'Modified',
  'Author',
  'Editor',
  'CreatedBy',
  'ModifiedBy',
  'AuthorId',
  'EditorId',
  '_UIVersionString',
  'Attachments',
  'FileRef',
  'FileDirRef',
  'FileLeafRef',
])

/**
 * Removes read-only/system-managed fields from a SharePoint list item field set, logging any
 * fields that were stripped. Throws if no updatable fields remain.
 */
export function sanitizeListItemFields(
  fields: Record<string, unknown>,
  context: { action: 'update' | 'create' }
): Record<string, unknown> {
  const entries = Object.entries(fields)
  const updatableEntries = entries.filter(([key]) => !READ_ONLY_LIST_ITEM_FIELDS.has(key))

  if (updatableEntries.length !== entries.length) {
    const removed = entries
      .filter(([key]) => READ_ONLY_LIST_ITEM_FIELDS.has(key))
      .map(([key]) => key)
    logger.warn(`Removed read-only SharePoint fields from ${context.action}`, { removed })
  }

  if (updatableEntries.length === 0) {
    const requestedKeys = Object.keys(fields)
    const verb = context.action === 'update' ? 'updated' : 'set'
    throw new Error(
      `All provided fields are read-only and cannot be ${verb}: ${requestedKeys.join(', ')}`
    )
  }

  return Object.fromEntries(updatableEntries)
}

export function cleanODataMetadata<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map((item) => cleanODataMetadata(item)) as T
  }

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key.includes('@odata')) continue

    cleaned[key] = cleanODataMetadata(value)
  }

  return cleaned as T
}

/** Maps a Graph listItem to its id, column values, and baseItem metadata. */
export function mapListItem(item: Record<string, unknown>): SharepointListItem {
  return {
    id: item.id as string,
    fields: item.fields as Record<string, unknown> | undefined,
    webUrl: (item.webUrl as string | undefined) ?? null,
    createdDateTime: (item.createdDateTime as string | undefined) ?? null,
    lastModifiedDateTime: (item.lastModifiedDateTime as string | undefined) ?? null,
    createdBy: (item.createdBy as SharepointListItem['createdBy']) ?? null,
    lastModifiedBy: (item.lastModifiedBy as SharepointListItem['lastModifiedBy']) ?? null,
  }
}

export const LIST_ITEM_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Item ID' },
  fields: { type: 'object', description: 'Field values for the item' },
  webUrl: { type: 'string', description: 'URL that displays the item', optional: true },
  createdDateTime: { type: 'string', description: 'When the item was created', optional: true },
  lastModifiedDateTime: {
    type: 'string',
    description: 'When the item was last modified',
    optional: true,
  },
  createdBy: {
    type: 'object',
    description: 'Identity set of the creator (e.g. user.displayName, user.email)',
    optional: true,
  },
  lastModifiedBy: {
    type: 'object',
    description: 'Identity set of the last modifier (e.g. user.displayName, user.email)',
    optional: true,
  },
}
