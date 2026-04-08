import { createLogger } from '@sim/logger'
import { ServiceNowIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('ServiceNowConnector')

const DEFAULT_MAX_ITEMS = 500
const PAGE_SIZE = 100

interface ServiceNowRecord {
  sys_id: string
  sys_updated_on?: string
  sys_created_on?: string
  sys_created_by?: string
  sys_updated_by?: string
}

interface KBArticle extends ServiceNowRecord {
  short_description?: string
  text?: string
  wiki?: string
  workflow_state?: string
  kb_category?: string | { display_value?: string }
  kb_knowledge_base?: string | { display_value?: string }
  number?: string
  author?: string | { display_value?: string }
}

interface Incident extends ServiceNowRecord {
  number?: string
  short_description?: string
  description?: string
  state?: string
  priority?: string
  category?: string
  assigned_to?: string | { display_value?: string }
  opened_by?: string | { display_value?: string }
  close_notes?: string
  comments_and_work_notes?: string
  work_notes?: string
  resolution_notes?: string
}

/**
 * Normalizes the instance URL to ensure it has the correct format.
 */
function normalizeInstanceUrl(instanceUrl: string): string {
  let url = instanceUrl.trim()
  url = url.replace(/\/+$/, '')
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    url = `https://${url}`
  }
  return url
}

/**
 * Builds Basic Auth header from username and API key/password.
 */
function buildAuthHeader(accessToken: string, sourceConfig: Record<string, unknown>): string {
  const username = sourceConfig.username as string
  const encoded = Buffer.from(`${username}:${accessToken}`).toString('base64')
  return `Basic ${encoded}`
}

/**
 * Calls the ServiceNow Table API.
 */
async function serviceNowApiGet(
  instanceUrl: string,
  tableName: string,
  authHeader: string,
  params: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<{ result: Record<string, unknown>[]; nextOffset?: number; totalCount?: number }> {
  const queryParams = new URLSearchParams(params)
  const url = `${instanceUrl}/api/now/table/${tableName}?${queryParams.toString()}`

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`ServiceNow API error (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as { result: Record<string, unknown>[] }

  const totalCountHeader = response.headers.get('X-Total-Count')
  const totalCount = totalCountHeader ? Number(totalCountHeader) : undefined

  const offset = Number(params.sysparm_offset || '0')
  const limit = Number(params.sysparm_limit || String(PAGE_SIZE))
  const resultCount = data.result?.length ?? 0

  const nextOffset = resultCount >= limit ? offset + limit : undefined

  return {
    result: data.result || [],
    nextOffset,
    totalCount,
  }
}

/**
 * Extracts a display value from a field that may be a string or a reference object.
 * When sysparm_display_value=true, fields are plain strings.
 * When sysparm_display_value=all, fields are objects with display_value/value.
 * This helper normalises both shapes.
 */
function displayValue(field: unknown): string | undefined {
  if (typeof field === 'string') return field || undefined
  if (field && typeof field === 'object') {
    const obj = field as Record<string, unknown>
    if ('display_value' in obj && typeof obj.display_value === 'string') {
      return obj.display_value || undefined
    }
    if ('value' in obj && typeof obj.value === 'string') {
      return obj.value || undefined
    }
  }
  return undefined
}

/**
 * Extracts the raw value from a field that may be a string or an object
 * returned by sysparm_display_value=all. Prefers `value` over `display_value`
 * so that coded values (e.g. state "1") are preserved for mapping functions.
 */
function rawValue(field: unknown): string | undefined {
  if (typeof field === 'string') return field || undefined
  if (field && typeof field === 'object') {
    const obj = field as Record<string, unknown>
    if ('value' in obj && typeof obj.value === 'string') {
      return obj.value || undefined
    }
    if ('display_value' in obj && typeof obj.display_value === 'string') {
      return obj.display_value || undefined
    }
  }
  return undefined
}

/**
 * Maps ServiceNow state codes to human-readable labels for incidents.
 */
function incidentStateLabel(state: string | undefined): string {
  const stateMap: Record<string, string> = {
    '1': 'New',
    '2': 'In Progress',
    '3': 'On Hold',
    '6': 'Resolved',
    '7': 'Closed',
    '8': 'Canceled',
  }
  return state ? stateMap[state] || state : 'Unknown'
}

/**
 * Maps ServiceNow priority codes to human-readable labels.
 */
function priorityLabel(priority: string | undefined): string {
  const priorityMap: Record<string, string> = {
    '1': 'Critical',
    '2': 'High',
    '3': 'Moderate',
    '4': 'Low',
    '5': 'Planning',
  }
  return priority ? priorityMap[priority] || priority : 'Unknown'
}

/**
 * Converts a KB article record to an ExternalDocument.
 */
function kbArticleToDocument(article: KBArticle, instanceUrl: string): ExternalDocument {
  const title = rawValue(article.short_description) || rawValue(article.number) || article.sys_id
  const articleText = rawValue(article.text) || rawValue(article.wiki) || ''
  const content = htmlToPlainText(articleText)
  const sysId = rawValue(article.sys_id as unknown as string) || article.sys_id
  const updatedOn = rawValue(article.sys_updated_on) || ''
  const contentHash = `servicenow:${sysId}:${updatedOn}`
  const sourceUrl = `${instanceUrl}/kb_view.do?sys_kb_id=${sysId}`

  return {
    externalId: sysId,
    title,
    content,
    mimeType: 'text/plain',
    sourceUrl,
    contentHash,
    metadata: {
      type: 'kb_article',
      number: rawValue(article.number),
      workflowState: rawValue(article.workflow_state),
      category: displayValue(article.kb_category),
      knowledgeBase: displayValue(article.kb_knowledge_base),
      author: displayValue(article.author) || rawValue(article.sys_created_by),
      lastUpdated: rawValue(article.sys_updated_on),
      createdOn: rawValue(article.sys_created_on),
    },
  }
}

/**
 * Converts an incident record to an ExternalDocument.
 */
function incidentToDocument(incident: Incident, instanceUrl: string): ExternalDocument {
  const number = rawValue(incident.number)
  const shortDesc = rawValue(incident.short_description)
  const title = number ? `${number}: ${shortDesc || 'Untitled'}` : shortDesc || incident.sys_id

  const parts: string[] = []
  if (shortDesc) {
    parts.push(`Summary: ${shortDesc}`)
  }
  const description = rawValue(incident.description)
  if (description) {
    parts.push(`Description: ${htmlToPlainText(description)}`)
  }
  const state = rawValue(incident.state)
  const priority = rawValue(incident.priority)
  parts.push(`State: ${incidentStateLabel(state)}`)
  parts.push(`Priority: ${priorityLabel(priority)}`)
  const category = rawValue(incident.category)
  if (category) {
    parts.push(`Category: ${category}`)
  }
  if (displayValue(incident.assigned_to)) {
    parts.push(`Assigned To: ${displayValue(incident.assigned_to)}`)
  }
  if (displayValue(incident.opened_by)) {
    parts.push(`Opened By: ${displayValue(incident.opened_by)}`)
  }
  const resolutionNotes = rawValue(incident.resolution_notes)
  if (resolutionNotes) {
    parts.push(`Resolution Notes: ${htmlToPlainText(resolutionNotes)}`)
  }
  const closeNotes = rawValue(incident.close_notes)
  if (closeNotes) {
    parts.push(`Close Notes: ${htmlToPlainText(closeNotes)}`)
  }

  const content = parts.join('\n')
  const sysId = rawValue(incident.sys_id as unknown as string) || incident.sys_id
  const updatedOn = rawValue(incident.sys_updated_on) || ''
  const contentHash = `servicenow:${sysId}:${updatedOn}`
  const sourceUrl = `${instanceUrl}/incident.do?sys_id=${sysId}`

  return {
    externalId: sysId,
    title,
    content,
    mimeType: 'text/plain',
    sourceUrl,
    contentHash,
    metadata: {
      type: 'incident',
      number,
      state: incidentStateLabel(state),
      priority: priorityLabel(priority),
      category,
      assignedTo: displayValue(incident.assigned_to),
      openedBy: displayValue(incident.opened_by),
      author: displayValue(incident.opened_by) || rawValue(incident.sys_created_by),
      lastUpdated: rawValue(incident.sys_updated_on),
      createdOn: rawValue(incident.sys_created_on),
    },
  }
}

/**
 * Builds the sysparm_query filter string for KB articles.
 */
function buildKBQuery(sourceConfig: Record<string, unknown>): string {
  const parts: string[] = []

  const workflowState = sourceConfig.workflowState as string | undefined
  if (workflowState && workflowState !== 'all') {
    parts.push(`workflow_state=${workflowState}`)
  }

  const kbCategory = sourceConfig.kbCategory as string | undefined
  if (kbCategory?.trim()) {
    parts.push(`kb_category.label=${kbCategory.trim()}`)
  }

  parts.push('ORDERBYDESCsys_updated_on')
  return parts.join('^')
}

/**
 * Builds the sysparm_query filter string for incidents.
 */
function buildIncidentQuery(sourceConfig: Record<string, unknown>): string {
  const parts: string[] = []

  const incidentState = sourceConfig.incidentState as string | undefined
  if (incidentState && incidentState !== 'all') {
    parts.push(`state=${incidentState}`)
  }

  const incidentPriority = sourceConfig.incidentPriority as string | undefined
  if (incidentPriority && incidentPriority !== 'all') {
    parts.push(`priority=${incidentPriority}`)
  }

  parts.push('ORDERBYDESCsys_updated_on')
  return parts.join('^')
}

export const servicenowConnector: ConnectorConfig = {
  id: 'servicenow',
  name: 'ServiceNow',
  description: 'Sync Knowledge Base articles and Incidents from ServiceNow',
  version: '1.0.0',
  icon: ServiceNowIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your ServiceNow API key or password',
  },

  configFields: [
    {
      id: 'instanceUrl',
      title: 'Instance URL',
      type: 'short-input',
      placeholder: 'yourinstance.service-now.com',
      required: true,
      description: 'Your ServiceNow instance URL',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'admin',
      required: true,
      description: 'ServiceNow username for Basic Auth',
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      required: true,
      description: 'Type of content to sync from ServiceNow',
      options: [
        { label: 'Knowledge Base Articles', id: 'kb_knowledge' },
        { label: 'Incidents', id: 'incident' },
      ],
    },
    {
      id: 'workflowState',
      title: 'Article State',
      type: 'dropdown',
      required: false,
      description: 'Filter KB articles by workflow state',
      options: [
        { label: 'All States', id: 'all' },
        { label: 'Published', id: 'published' },
        { label: 'Draft', id: 'draft' },
        { label: 'Review', id: 'review' },
        { label: 'Retired', id: 'retired' },
      ],
    },
    {
      id: 'kbCategory',
      title: 'KB Category',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. IT, HR, General',
      description: 'Filter KB articles by category label',
    },
    {
      id: 'incidentState',
      title: 'Incident State',
      type: 'dropdown',
      required: false,
      description: 'Filter incidents by state',
      options: [
        { label: 'All States', id: 'all' },
        { label: 'New', id: '1' },
        { label: 'In Progress', id: '2' },
        { label: 'On Hold', id: '3' },
        { label: 'Resolved', id: '6' },
        { label: 'Closed', id: '7' },
      ],
    },
    {
      id: 'incidentPriority',
      title: 'Incident Priority',
      type: 'dropdown',
      required: false,
      description: 'Filter incidents by priority',
      options: [
        { label: 'All Priorities', id: 'all' },
        { label: 'Critical', id: '1' },
        { label: 'High', id: '2' },
        { label: 'Moderate', id: '3' },
        { label: 'Low', id: '4' },
        { label: 'Planning', id: '5' },
      ],
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_ITEMS})`,
      description: 'Maximum number of items to sync',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    _syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const instanceUrl = normalizeInstanceUrl(sourceConfig.instanceUrl as string)
    const contentType = (sourceConfig.contentType as string) || 'kb_knowledge'
    const maxItems = sourceConfig.maxItems ? Number(sourceConfig.maxItems) : DEFAULT_MAX_ITEMS
    const authHeader = buildAuthHeader(accessToken, sourceConfig)

    const offset = cursor ? Number(cursor) : 0
    const remaining = maxItems - offset
    if (remaining <= 0) {
      return { documents: [], hasMore: false }
    }

    const limit = Math.min(PAGE_SIZE, remaining)
    const isKB = contentType === 'kb_knowledge'
    const tableName = isKB ? 'kb_knowledge' : 'incident'
    const query = isKB ? buildKBQuery(sourceConfig) : buildIncidentQuery(sourceConfig)

    const fields = isKB
      ? 'sys_id,short_description,text,wiki,workflow_state,kb_category,kb_knowledge_base,number,author,sys_created_by,sys_updated_by,sys_updated_on,sys_created_on'
      : 'sys_id,number,short_description,description,state,priority,category,assigned_to,opened_by,close_notes,resolution_notes,sys_created_by,sys_updated_by,sys_updated_on,sys_created_on'

    const params: Record<string, string> = {
      sysparm_limit: String(limit),
      sysparm_offset: String(offset),
      sysparm_query: query,
      sysparm_fields: fields,
      sysparm_display_value: 'all',
    }

    logger.info('Fetching ServiceNow records', {
      table: tableName,
      offset,
      limit,
      query,
    })

    const { result, nextOffset } = await serviceNowApiGet(
      instanceUrl,
      tableName,
      authHeader,
      params
    )

    const documents: ExternalDocument[] = []
    for (const record of result) {
      const doc = isKB
        ? kbArticleToDocument(record as unknown as KBArticle, instanceUrl)
        : incidentToDocument(record as unknown as Incident, instanceUrl)

      if (doc.content.trim()) {
        documents.push(doc)
      }
    }

    const hasMore = nextOffset !== undefined && nextOffset < maxItems
    const nextCursor = hasMore ? String(nextOffset) : undefined

    logger.info('Fetched ServiceNow documents', {
      count: documents.length,
      hasMore,
      nextCursor,
    })

    return {
      documents,
      nextCursor,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const instanceUrl = normalizeInstanceUrl(sourceConfig.instanceUrl as string)
    const contentType = (sourceConfig.contentType as string) || 'kb_knowledge'
    const authHeader = buildAuthHeader(accessToken, sourceConfig)
    const isKB = contentType === 'kb_knowledge'
    const tableName = isKB ? 'kb_knowledge' : 'incident'

    const fields = isKB
      ? 'sys_id,short_description,text,wiki,workflow_state,kb_category,kb_knowledge_base,number,author,sys_created_by,sys_updated_by,sys_updated_on,sys_created_on'
      : 'sys_id,number,short_description,description,state,priority,category,assigned_to,opened_by,close_notes,resolution_notes,sys_created_by,sys_updated_by,sys_updated_on,sys_created_on'

    try {
      const { result } = await serviceNowApiGet(instanceUrl, tableName, authHeader, {
        sysparm_query: `sys_id=${externalId}`,
        sysparm_limit: '1',
        sysparm_offset: '0',
        sysparm_fields: fields,
        sysparm_display_value: 'all',
      })

      if (!result || result.length === 0) {
        return null
      }

      const record = result[0]
      const doc = isKB
        ? kbArticleToDocument(record as unknown as KBArticle, instanceUrl)
        : incidentToDocument(record as unknown as Incident, instanceUrl)

      return doc.content.trim() ? doc : null
    } catch (error) {
      logger.warn('Failed to get ServiceNow document', {
        externalId,
        table: tableName,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const instanceUrl = sourceConfig.instanceUrl as string | undefined
    const username = sourceConfig.username as string | undefined
    const contentType = sourceConfig.contentType as string | undefined
    const maxItems = sourceConfig.maxItems as string | undefined

    if (!instanceUrl?.trim()) {
      return { valid: false, error: 'Instance URL is required' }
    }

    if (!username?.trim()) {
      return { valid: false, error: 'Username is required' }
    }

    if (!contentType) {
      return { valid: false, error: 'Content type is required' }
    }

    if (maxItems && (Number.isNaN(Number(maxItems)) || Number(maxItems) <= 0)) {
      return { valid: false, error: 'Max items must be a positive number' }
    }

    const normalizedUrl = normalizeInstanceUrl(instanceUrl)
    const authHeader = buildAuthHeader(accessToken, sourceConfig)
    const tableName = contentType === 'kb_knowledge' ? 'kb_knowledge' : 'incident'

    try {
      await serviceNowApiGet(
        normalizedUrl,
        tableName,
        authHeader,
        {
          sysparm_limit: '1',
          sysparm_offset: '0',
        },
        VALIDATE_RETRY_OPTIONS
      )
      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect to ServiceNow'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'type', displayName: 'Record Type', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    { id: 'category', displayName: 'Category', fieldType: 'text' },
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'lastUpdated', displayName: 'Last Updated', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.type === 'string') {
      result.type = metadata.type === 'kb_article' ? 'KB Article' : 'Incident'
    }

    const state = metadata.state ?? metadata.workflowState
    if (typeof state === 'string') {
      result.state = state
    }

    if (typeof metadata.priority === 'string') {
      result.priority = metadata.priority
    }

    if (typeof metadata.category === 'string') {
      result.category = metadata.category
    }

    const author = metadata.author
    if (typeof author === 'string') {
      result.author = author
    }

    const lastUpdated = parseTagDate(metadata.lastUpdated)
    if (lastUpdated) {
      result.lastUpdated = lastUpdated
    }

    return result
  },
}
