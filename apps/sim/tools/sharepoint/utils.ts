import { createLogger } from '@sim/logger'
import type { CanvasLayout } from '@/tools/sharepoint/types'

const logger = createLogger('SharepointUtils')

export function optionalTrim(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  return trimmed || undefined
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
    logger.info('Processing section', {
      sectionId: section.id,
      hasColumns: !!section.columns,
      hasWebparts: !!section.webparts,
      columnsCount: section.columns?.length || 0,
    })

    if (section.columns) {
      for (const column of section.columns) {
        if (column.webparts) {
          for (const webpart of column.webparts) {
            logger.info('Processing webpart', {
              webpartId: webpart.id,
              hasInnerHtml: !!webpart.innerHtml,
              innerHtml: webpart.innerHtml,
            })

            if (webpart.innerHtml) {
              const text = stripHtmlTags(webpart.innerHtml)
              if (text) {
                textParts.push(text)
                logger.info('Extracted text', { text })
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
    finalContent,
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
