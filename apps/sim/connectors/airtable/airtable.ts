import { createLogger } from '@sim/logger'
import { AirtableIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'

const logger = createLogger('AirtableConnector')

const AIRTABLE_API = 'https://api.airtable.com/v0'
const PAGE_SIZE = 100

/**
 * Computes a SHA-256 hash of the given content.
 */
async function computeContentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Flattens a record's fields into a plain-text representation.
 * Each field is rendered as "Field Name: value" on its own line.
 */
function recordToPlainText(
  fields: Record<string, unknown>,
  fieldNames?: Map<string, string>
): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue
    const displayName = fieldNames?.get(key) ?? key
    if (Array.isArray(value)) {
      // Attachments or linked records
      const items = value.map((v) => {
        if (typeof v === 'object' && v !== null) {
          const obj = v as Record<string, unknown>
          return (obj.url as string) || (obj.name as string) || JSON.stringify(v)
        }
        return String(v)
      })
      lines.push(`${displayName}: ${items.join(', ')}`)
    } else if (typeof value === 'object') {
      lines.push(`${displayName}: ${JSON.stringify(value)}`)
    } else {
      lines.push(`${displayName}: ${String(value)}`)
    }
  }
  return lines.join('\n')
}

/**
 * Extracts a human-readable title from a record's fields.
 * Prefers the configured title field, then falls back to common field names.
 */
function extractTitle(fields: Record<string, unknown>, titleField?: string): string {
  if (titleField && fields[titleField] != null) {
    return String(fields[titleField])
  }
  const candidates = ['Name', 'Title', 'name', 'title', 'Summary', 'summary']
  for (const candidate of candidates) {
    if (fields[candidate] != null) {
      return String(fields[candidate])
    }
  }
  // Fall back to first non-null string field
  for (const value of Object.values(fields)) {
    if (typeof value === 'string' && value.trim()) {
      return value.length > 80 ? `${value.slice(0, 80)}…` : value
    }
  }
  return 'Untitled'
}

/**
 * Parses the cursor format: "offset:<airtable_offset>"
 */
function parseCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined
  if (cursor.startsWith('offset:')) return cursor.slice(7)
  return cursor
}

export const airtableConnector: ConnectorConfig = {
  id: 'airtable',
  name: 'Airtable',
  description: 'Sync records from an Airtable table into your knowledge base',
  version: '1.0.0',
  icon: AirtableIcon,

  oauth: {
    required: true,
    provider: 'airtable',
    requiredScopes: ['data.records:read', 'schema.bases:read'],
  },

  configFields: [
    {
      id: 'baseId',
      title: 'Base ID',
      type: 'short-input',
      placeholder: 'e.g. appXXXXXXXXXXXXXX',
      required: true,
    },
    {
      id: 'tableIdOrName',
      title: 'Table Name or ID',
      type: 'short-input',
      placeholder: 'e.g. Tasks or tblXXXXXXXXXXXXXX',
      required: true,
    },
    {
      id: 'viewId',
      title: 'View',
      type: 'short-input',
      placeholder: 'e.g. Grid view or viwXXXXXXXXXXXXXX',
      required: false,
    },
    {
      id: 'titleField',
      title: 'Title Field',
      type: 'short-input',
      placeholder: 'e.g. Name',
      required: false,
    },
    {
      id: 'maxRecords',
      title: 'Max Records',
      type: 'short-input',
      placeholder: 'e.g. 1000 (default: unlimited)',
      required: false,
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string
  ): Promise<ExternalDocumentList> => {
    const baseId = sourceConfig.baseId as string
    const tableIdOrName = sourceConfig.tableIdOrName as string
    const viewId = sourceConfig.viewId as string | undefined
    const titleField = sourceConfig.titleField as string | undefined
    const maxRecords = sourceConfig.maxRecords ? Number(sourceConfig.maxRecords) : 0

    // Fetch table schema for field name mapping
    const fieldNames = await fetchFieldNames(accessToken, baseId, tableIdOrName)

    const params = new URLSearchParams()
    params.append('pageSize', String(PAGE_SIZE))
    if (viewId) params.append('view', viewId)
    if (maxRecords > 0) params.append('maxRecords', String(maxRecords))

    const offset = parseCursor(cursor)
    if (offset) params.append('offset', offset)

    const encodedTable = encodeURIComponent(tableIdOrName)
    const url = `${AIRTABLE_API}/${baseId}/${encodedTable}?${params.toString()}`

    logger.info(`Listing records from ${baseId}/${tableIdOrName}`, {
      offset: offset ?? 'none',
      view: viewId ?? 'default',
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Airtable records', {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to list Airtable records: ${response.status}`)
    }

    const data = (await response.json()) as {
      records: AirtableRecord[]
      offset?: string
    }

    const records = data.records || []
    const documents: ExternalDocument[] = await Promise.all(
      records.map((record) =>
        recordToDocument(record, baseId, tableIdOrName, titleField, fieldNames)
      )
    )

    const nextOffset = data.offset
    return {
      documents,
      nextCursor: nextOffset ? `offset:${nextOffset}` : undefined,
      hasMore: Boolean(nextOffset),
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const baseId = sourceConfig.baseId as string
    const tableIdOrName = sourceConfig.tableIdOrName as string
    const titleField = sourceConfig.titleField as string | undefined

    const fieldNames = await fetchFieldNames(accessToken, baseId, tableIdOrName)
    const encodedTable = encodeURIComponent(tableIdOrName)
    const url = `${AIRTABLE_API}/${baseId}/${encodedTable}/${externalId}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404 || response.status === 422) return null
      throw new Error(`Failed to get Airtable record: ${response.status}`)
    }

    const record = (await response.json()) as AirtableRecord
    return recordToDocument(record, baseId, tableIdOrName, titleField, fieldNames)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const baseId = sourceConfig.baseId as string
    const tableIdOrName = sourceConfig.tableIdOrName as string

    if (!baseId || !tableIdOrName) {
      return { valid: false, error: 'Base ID and table name are required' }
    }

    if (baseId && !baseId.startsWith('app')) {
      return { valid: false, error: 'Base ID should start with "app"' }
    }

    const maxRecords = sourceConfig.maxRecords as string | undefined
    if (maxRecords && (Number.isNaN(Number(maxRecords)) || Number(maxRecords) <= 0)) {
      return { valid: false, error: 'Max records must be a positive number' }
    }

    try {
      // Verify base and table are accessible by fetching 1 record
      const encodedTable = encodeURIComponent(tableIdOrName)
      const url = `${AIRTABLE_API}/${baseId}/${encodedTable}?pageSize=1`
      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text()
        if (response.status === 404 || response.status === 422) {
          return { valid: false, error: `Table "${tableIdOrName}" not found in base "${baseId}"` }
        }
        if (response.status === 403) {
          return { valid: false, error: 'Access denied. Check your Airtable permissions.' }
        }
        return { valid: false, error: `Airtable API error: ${response.status} - ${errorText}` }
      }

      // If a view is specified, verify it exists
      const viewId = sourceConfig.viewId as string | undefined
      if (viewId) {
        const viewUrl = `${AIRTABLE_API}/${baseId}/${encodedTable}?pageSize=1&view=${encodeURIComponent(viewId)}`
        const viewResponse = await fetchWithRetry(
          viewUrl,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
          VALIDATE_RETRY_OPTIONS
        )
        if (!viewResponse.ok) {
          return { valid: false, error: `View "${viewId}" not found in table "${tableIdOrName}"` }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [{ id: 'createdTime', displayName: 'Created Time', fieldType: 'date' }],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.createdTime === 'string') {
      const date = new Date(metadata.createdTime)
      if (!Number.isNaN(date.getTime())) result.createdTime = date
    }

    return result
  },
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
  createdTime: string
}

/**
 * Converts an Airtable record to an ExternalDocument.
 */
async function recordToDocument(
  record: AirtableRecord,
  baseId: string,
  tableIdOrName: string,
  titleField: string | undefined,
  fieldNames: Map<string, string>
): Promise<ExternalDocument> {
  const plainText = recordToPlainText(record.fields, fieldNames)
  const contentHash = await computeContentHash(plainText)
  const title = extractTitle(record.fields, titleField)

  const encodedTable = encodeURIComponent(tableIdOrName)
  const sourceUrl = `https://airtable.com/${baseId}/${encodedTable}/${record.id}`

  return {
    externalId: record.id,
    title,
    content: plainText,
    mimeType: 'text/plain',
    sourceUrl,
    contentHash,
    metadata: {
      createdTime: record.createdTime,
    },
  }
}

/**
 * Fetches the table schema to build a field ID → field name mapping.
 * Falls back to an empty map if the schema endpoint is unavailable.
 */
async function fetchFieldNames(
  accessToken: string,
  baseId: string,
  tableIdOrName: string
): Promise<Map<string, string>> {
  const fieldNames = new Map<string, string>()

  try {
    const url = `${AIRTABLE_API}/meta/bases/${baseId}/tables`
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch Airtable schema, using raw field keys', {
        status: response.status,
      })
      return fieldNames
    }

    const data = (await response.json()) as {
      tables: { id: string; name: string; fields: { id: string; name: string; type: string }[] }[]
    }

    const table = data.tables.find((t) => t.id === tableIdOrName || t.name === tableIdOrName)

    if (table) {
      for (const field of table.fields) {
        fieldNames.set(field.id, field.name)
        fieldNames.set(field.name, field.name)
      }
    }
  } catch (error) {
    logger.warn('Error fetching Airtable schema', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return fieldNames
}
