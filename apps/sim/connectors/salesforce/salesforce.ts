import { createLogger } from '@sim/logger'
import { SalesforceIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('SalesforceConnector')

const USERINFO_URL = 'https://login.salesforce.com/services/oauth2/userinfo'
const API_VERSION = 'v62.0'
const PAGE_SIZE = 200

/** SOQL field lists per object type. */
const OBJECT_FIELDS: Record<string, string[]> = {
  KnowledgeArticleVersion: ['Id', 'Title', 'Summary', 'LastModifiedDate', 'ArticleNumber'],
  Case: ['Id', 'Subject', 'Description', 'Status', 'LastModifiedDate', 'CaseNumber'],
  Account: ['Id', 'Name', 'Description', 'Industry', 'LastModifiedDate'],
  Opportunity: [
    'Id',
    'Name',
    'Description',
    'StageName',
    'Amount',
    'LastModifiedDate',
    'CloseDate',
  ],
} as const

/** SOQL WHERE clause additions per object type. */
const OBJECT_WHERE: Record<string, string> = {
  KnowledgeArticleVersion: " WHERE PublishStatus='Online' AND Language='en_US'",
} as const

/**
 * Resolves the Salesforce instance REST URL from the userinfo endpoint.
 * Caches the result in syncContext to avoid repeated calls.
 */
async function resolveInstanceUrl(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  if (syncContext?.instanceUrl) {
    return syncContext.instanceUrl as string
  }

  const response = await fetchWithRetry(USERINFO_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to resolve Salesforce instance URL: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const urls = data.urls as Record<string, string> | undefined
  let restUrl = urls?.rest

  if (!restUrl) {
    throw new Error('Salesforce userinfo response did not include a REST URL')
  }

  restUrl = restUrl.replace('{version}', API_VERSION)

  if (syncContext) {
    syncContext.instanceUrl = restUrl
  }

  return restUrl
}

/**
 * Builds the document title for a Salesforce record based on its object type.
 */
function buildRecordTitle(objectType: string, record: Record<string, unknown>): string {
  switch (objectType) {
    case 'KnowledgeArticleVersion':
      return (record.Title as string) || 'Untitled Article'
    case 'Case':
      return (record.Subject as string) || 'Untitled Case'
    case 'Account':
      return (record.Name as string) || 'Unnamed Account'
    case 'Opportunity':
      return (record.Name as string) || 'Unnamed Opportunity'
    default:
      return `Record ${(record.Id as string) || 'Unknown'}`
  }
}

/** Fields that may contain HTML content and should be stripped to plain text. */
const HTML_FIELDS = new Set(['Description', 'Summary'])

/**
 * Builds plain-text content from a Salesforce record for indexing.
 */
function buildRecordContent(objectType: string, record: Record<string, unknown>): string {
  const parts: string[] = []
  const title = buildRecordTitle(objectType, record)
  parts.push(title)

  const fields = OBJECT_FIELDS[objectType] || []
  for (const field of fields) {
    if (field === 'Id') continue
    const value = record[field]
    if (value != null && value !== '') {
      const label = field.replace(/([A-Z])/g, ' $1').trim()
      const text =
        HTML_FIELDS.has(field) && typeof value === 'string' ? htmlToPlainText(value) : String(value)
      parts.push(`${label}: ${text}`)
    }
  }

  return parts.join('\n').trim()
}

/**
 * Returns the record number field value based on object type.
 */
function getRecordNumber(objectType: string, record: Record<string, unknown>): string | undefined {
  switch (objectType) {
    case 'KnowledgeArticleVersion':
      return (record.ArticleNumber as string) || undefined
    case 'Case':
      return (record.CaseNumber as string) || undefined
    default:
      return undefined
  }
}

/**
 * Returns the status/stage field value based on object type.
 */
function getRecordStatus(objectType: string, record: Record<string, unknown>): string | undefined {
  switch (objectType) {
    case 'Case':
      return (record.Status as string) || undefined
    case 'Opportunity':
      return (record.StageName as string) || undefined
    default:
      return undefined
  }
}

/**
 * Converts a Salesforce record to an ExternalDocument.
 */
async function recordToDocument(
  record: Record<string, unknown>,
  objectType: string,
  instanceUrl: string
): Promise<ExternalDocument> {
  const id = record.Id as string
  const content = buildRecordContent(objectType, record)
  const contentHash = await computeContentHash(content)
  const title = buildRecordTitle(objectType, record)

  const baseUrl = instanceUrl.replace(`/services/data/${API_VERSION}/`, '')

  return {
    externalId: id,
    title,
    content,
    mimeType: 'text/plain',
    sourceUrl: `${baseUrl}/${id}`,
    contentHash,
    metadata: {
      objectType,
      lastModified: (record.LastModifiedDate as string) || undefined,
      recordNumber: getRecordNumber(objectType, record),
      status: getRecordStatus(objectType, record),
    },
  }
}

export const salesforceConnector: ConnectorConfig = {
  id: 'salesforce',
  name: 'Salesforce',
  description: 'Sync records from Salesforce into your knowledge base',
  version: '1.0.0',
  icon: SalesforceIcon,

  auth: { mode: 'oauth', provider: 'salesforce', requiredScopes: ['api', 'refresh_token'] },

  configFields: [
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Knowledge Articles', id: 'KnowledgeArticleVersion' },
        { label: 'Cases', id: 'Case' },
        { label: 'Accounts', id: 'Account' },
        { label: 'Opportunities', id: 'Opportunity' },
      ],
    },
    {
      id: 'maxRecords',
      title: 'Max Records',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const objectType = sourceConfig.objectType as string
    const maxRecords = sourceConfig.maxRecords ? Number(sourceConfig.maxRecords) : 0
    const fields = OBJECT_FIELDS[objectType]

    if (!fields) {
      throw new Error(`Unsupported Salesforce object type: ${objectType}`)
    }

    const instanceUrl = await resolveInstanceUrl(accessToken, syncContext)

    let url: string

    if (cursor) {
      const baseUrl = instanceUrl.replace(`/services/data/${API_VERSION}/`, '')
      url = `${baseUrl}${cursor}`
    } else {
      const whereClause = OBJECT_WHERE[objectType] || ''
      const soql = `SELECT ${fields.join(',')} FROM ${objectType}${whereClause} ORDER BY LastModifiedDate DESC LIMIT ${PAGE_SIZE}`
      url = `${instanceUrl}query?q=${encodeURIComponent(soql)}`
    }

    logger.info(`Listing Salesforce ${objectType}`, { cursor: cursor || 'initial' })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`Failed to query Salesforce ${objectType}`, {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to query Salesforce ${objectType}: ${response.status}`)
    }

    const data = await response.json()
    const records = (data.records || []) as Record<string, unknown>[]
    const nextRecordsUrl = data.nextRecordsUrl as string | undefined

    const documents: ExternalDocument[] = await Promise.all(
      records.map((record) => recordToDocument(record, objectType, instanceUrl))
    )

    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0
    if (maxRecords > 0) {
      const remaining = maxRecords - previouslyFetched
      if (documents.length > remaining) {
        documents.splice(remaining)
      }
    }

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) {
      syncContext.totalDocsFetched = totalFetched
    }

    const hasMore = Boolean(nextRecordsUrl) && (maxRecords <= 0 || totalFetched < maxRecords)

    return {
      documents,
      nextCursor: hasMore ? nextRecordsUrl : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const objectType = sourceConfig.objectType as string
    const fields = OBJECT_FIELDS[objectType]

    if (!fields) {
      throw new Error(`Unsupported Salesforce object type: ${objectType}`)
    }

    let instanceUrl = syncContext?.instanceUrl as string | undefined
    if (!instanceUrl) {
      instanceUrl = await resolveInstanceUrl(accessToken)
      if (syncContext) syncContext.instanceUrl = instanceUrl
    }

    const url = `${instanceUrl}sobjects/${objectType}/${externalId}?fields=${fields.join(',')}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Salesforce ${objectType} record: ${response.status}`)
    }

    const record = await response.json()

    if (
      objectType === 'KnowledgeArticleVersion' &&
      (record as Record<string, unknown>).PublishStatus !== 'Online'
    ) {
      return null
    }

    return recordToDocument(record, objectType, instanceUrl)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const objectType = sourceConfig.objectType as string

    if (!objectType) {
      return { valid: false, error: 'Object type is required' }
    }

    if (!OBJECT_FIELDS[objectType]) {
      return { valid: false, error: `Unsupported object type: ${objectType}` }
    }

    const maxRecords = sourceConfig.maxRecords as string | undefined
    if (maxRecords && (Number.isNaN(Number(maxRecords)) || Number(maxRecords) <= 0)) {
      return { valid: false, error: 'Max records must be a positive number' }
    }

    try {
      const userinfoResponse = await fetchWithRetry(
        USERINFO_URL,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!userinfoResponse.ok) {
        const errorText = await userinfoResponse.text()
        return {
          valid: false,
          error: `Failed to authenticate with Salesforce: ${userinfoResponse.status} - ${errorText}`,
        }
      }

      const userinfo = await userinfoResponse.json()
      const urls = userinfo.urls as Record<string, string> | undefined
      let restUrl = urls?.rest

      if (!restUrl) {
        return { valid: false, error: 'Could not resolve Salesforce instance URL' }
      }

      restUrl = restUrl.replace('{version}', API_VERSION)

      const soql = `SELECT Id FROM ${objectType} LIMIT 1`
      const queryUrl = `${restUrl}query?q=${encodeURIComponent(soql)}`

      const queryResponse = await fetchWithRetry(
        queryUrl,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!queryResponse.ok) {
        const errorText = await queryResponse.text()
        return {
          valid: false,
          error: `Failed to access Salesforce ${objectType}: ${queryResponse.status} - ${errorText}`,
        }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'objectType', displayName: 'Object Type', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'recordNumber', displayName: 'Record Number', fieldType: 'text' },
    { id: 'status', displayName: 'Status', fieldType: 'text' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.objectType === 'string') result.objectType = metadata.objectType

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.recordNumber === 'string') result.recordNumber = metadata.recordNumber
    if (typeof metadata.status === 'string') result.status = metadata.status

    return result
  },
}
