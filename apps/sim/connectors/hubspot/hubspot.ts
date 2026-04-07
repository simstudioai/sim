import { createLogger } from '@sim/logger'
import { HubspotIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, parseTagDate } from '@/connectors/utils'

const logger = createLogger('HubSpotConnector')

const BASE_URL = 'https://api.hubapi.com'
const PAGE_SIZE = 100

/** Properties to fetch per object type. */
const OBJECT_PROPERTIES: Record<string, string[]> = {
  contacts: [
    'firstname',
    'lastname',
    'email',
    'phone',
    'company',
    'jobtitle',
    'lifecyclestage',
    'hs_lead_status',
    'hubspot_owner_id',
    'createdate',
    'lastmodifieddate',
  ],
  companies: [
    'name',
    'domain',
    'industry',
    'description',
    'phone',
    'city',
    'state',
    'country',
    'numberofemployees',
    'annualrevenue',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
  deals: [
    'dealname',
    'amount',
    'dealstage',
    'pipeline',
    'closedate',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
  tickets: [
    'subject',
    'content',
    'hs_pipeline',
    'hs_pipeline_stage',
    'hs_ticket_priority',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
} as const

/**
 * Fetches the HubSpot portal ID for the authenticated account.
 * Caches the result in syncContext to avoid repeated calls.
 */
async function getPortalId(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  if (syncContext?.portalId) {
    return syncContext.portalId as string
  }

  const response = await fetchWithRetry(`${BASE_URL}/account-info/v3/details`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch HubSpot portal ID: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const portalId = String(data.portalId)

  if (syncContext) {
    syncContext.portalId = portalId
  }

  return portalId
}

/**
 * Builds the document title for a CRM record based on its object type.
 */
function buildRecordTitle(objectType: string, properties: Record<string, string | null>): string {
  switch (objectType) {
    case 'contacts': {
      const first = properties.firstname || ''
      const last = properties.lastname || ''
      const name = `${first} ${last}`.trim()
      return name || properties.email || 'Unnamed Contact'
    }
    case 'companies':
      return properties.name || properties.domain || 'Unnamed Company'
    case 'deals':
      return properties.dealname || 'Unnamed Deal'
    case 'tickets':
      return properties.subject || 'Unnamed Ticket'
    default:
      return `Record ${properties.hs_object_id || 'Unknown'}`
  }
}

/**
 * Builds a plain-text representation of a CRM record's properties for indexing.
 */
function buildRecordContent(objectType: string, properties: Record<string, string | null>): string {
  const parts: string[] = []

  const title = buildRecordTitle(objectType, properties)
  parts.push(title)

  for (const [key, value] of Object.entries(properties)) {
    if (value && key !== 'hs_object_id') {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      parts.push(`${label}: ${value}`)
    }
  }

  return parts.join('\n').trim()
}

/**
 * Converts a HubSpot CRM record to an ExternalDocument.
 */
async function recordToDocument(
  record: Record<string, unknown>,
  objectType: string,
  portalId: string
): Promise<ExternalDocument> {
  const id = record.id as string
  const properties = (record.properties || {}) as Record<string, string | null>

  const content = buildRecordContent(objectType, properties)
  const contentHash = await computeContentHash(content)
  const title = buildRecordTitle(objectType, properties)

  const lastModified =
    properties.lastmodifieddate || properties.hs_lastmodifieddate || properties.createdate

  return {
    externalId: id,
    title,
    content,
    mimeType: 'text/plain',
    sourceUrl: `https://app.hubspot.com/contacts/${portalId}/record/${objectType}/${id}`,
    contentHash,
    metadata: {
      objectType,
      owner: properties.hubspot_owner_id || undefined,
      lastModified: lastModified || undefined,
      pipeline: properties.pipeline || properties.hs_pipeline || undefined,
    },
  }
}

export const hubspotConnector: ConnectorConfig = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'Sync CRM records from HubSpot into your knowledge base',
  version: '1.0.0',
  icon: HubspotIcon,

  auth: {
    mode: 'oauth',
    provider: 'hubspot',
    requiredScopes: [
      'crm.objects.contacts.read',
      'crm.objects.companies.read',
      'crm.objects.deals.read',
      'tickets',
    ],
  },

  configFields: [
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Contacts', id: 'contacts' },
        { label: 'Companies', id: 'companies' },
        { label: 'Deals', id: 'deals' },
        { label: 'Tickets', id: 'tickets' },
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
    const properties = OBJECT_PROPERTIES[objectType] || []

    const portalId = await getPortalId(accessToken, syncContext)

    const sortProperty = objectType === 'contacts' ? 'lastmodifieddate' : 'hs_lastmodifieddate'

    const searchBody: Record<string, unknown> = {
      properties,
      sorts: [{ propertyName: sortProperty, direction: 'DESCENDING' }],
      limit: PAGE_SIZE,
    }
    if (cursor) {
      searchBody.after = cursor
    }

    logger.info(`Listing HubSpot ${objectType}`, { cursor })

    const response = await fetchWithRetry(`${BASE_URL}/crm/v3/objects/${objectType}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(searchBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`Failed to list HubSpot ${objectType}`, {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to list HubSpot ${objectType}: ${response.status}`)
    }

    const data = await response.json()
    const results = (data.results || []) as Record<string, unknown>[]
    const paging = data.paging as { next?: { after?: string } } | undefined
    const nextCursor = paging?.next?.after

    const documents: ExternalDocument[] = await Promise.all(
      results.map((record) => recordToDocument(record, objectType, portalId))
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

    const hasMore = Boolean(nextCursor) && (maxRecords <= 0 || totalFetched < maxRecords)

    return {
      documents,
      nextCursor: hasMore ? nextCursor : undefined,
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
    const properties = OBJECT_PROPERTIES[objectType] || []

    let portalId = syncContext?.portalId as string | undefined
    if (!portalId) {
      portalId = await getPortalId(accessToken)
      if (syncContext) syncContext.portalId = portalId
    }

    const params = new URLSearchParams()
    for (const prop of properties) {
      params.append('properties', prop)
    }

    const url = `${BASE_URL}/crm/v3/objects/${objectType}/${externalId}?${params.toString()}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get HubSpot ${objectType} record: ${response.status}`)
    }

    const record = await response.json()
    return recordToDocument(record, objectType, portalId)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const objectType = sourceConfig.objectType as string

    if (!objectType) {
      return { valid: false, error: 'Object type is required' }
    }

    if (!OBJECT_PROPERTIES[objectType]) {
      return { valid: false, error: `Unsupported object type: ${objectType}` }
    }

    const maxRecords = sourceConfig.maxRecords as string | undefined
    if (maxRecords && (Number.isNaN(Number(maxRecords)) || Number(maxRecords) <= 0)) {
      return { valid: false, error: 'Max records must be a positive number' }
    }

    try {
      const response = await fetchWithRetry(
        `${BASE_URL}/crm/v3/objects/${objectType}?limit=1`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text()
        return {
          valid: false,
          error: `Failed to access HubSpot ${objectType}: ${response.status} - ${errorText}`,
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
    { id: 'owner', displayName: 'Owner', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'pipeline', displayName: 'Pipeline', fieldType: 'text' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.objectType === 'string') result.objectType = metadata.objectType
    if (typeof metadata.owner === 'string') result.owner = metadata.owner

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.pipeline === 'string') result.pipeline = metadata.pipeline

    return result
  },
}
