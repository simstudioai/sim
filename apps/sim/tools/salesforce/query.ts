import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceQuery')

/**
 * Extracts Salesforce instance URL from ID token or uses provided instance URL
 */
function getInstanceUrl(idToken?: string, instanceUrl?: string): string {
  if (instanceUrl) return instanceUrl
  if (idToken) {
    try {
      const base64Url = idToken.split('.')[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
          .join('')
      )
      const decoded = JSON.parse(jsonPayload)
      if (decoded.profile) {
        const match = decoded.profile.match(/^(https:\/\/[^/]+)/)
        if (match) return match[1]
      } else if (decoded.sub) {
        const match = decoded.sub.match(/^(https:\/\/[^/]+)/)
        if (match && match[1] !== 'https://login.salesforce.com') return match[1]
      }
    } catch (error) {
      logger.error('Failed to decode Salesforce idToken', { error })
    }
  }
  throw new Error('Salesforce instance URL is required but not provided')
}

/**
 * Extracts a descriptive error message from Salesforce API responses
 */
function extractErrorMessage(data: any, status: number, defaultMessage: string): string {
  if (Array.isArray(data) && data[0]?.message) {
    return `Salesforce API Error (${status}): ${data[0].message}${data[0].errorCode ? ` [${data[0].errorCode}]` : ''}`
  }
  if (data?.message) {
    return `Salesforce API Error (${status}): ${data.message}`
  }
  if (data?.error) {
    return `Salesforce API Error (${status}): ${data.error}${data.error_description ? ` - ${data.error_description}` : ''}`
  }
  switch (status) {
    case 400:
      return `Salesforce API Error (400): Bad Request - The SOQL query is malformed or contains invalid syntax. Please check your query.`
    case 401:
      return `Salesforce API Error (401): Unauthorized - Invalid or expired access token. Please re-authenticate.`
    case 403:
      return `Salesforce API Error (403): Forbidden - You do not have permission to access this resource or execute this query.`
    case 404:
      return `Salesforce API Error (404): Not Found - The requested object or resource does not exist.`
    case 500:
      return `Salesforce API Error (500): Internal Server Error - An error occurred on Salesforce's servers.`
    default:
      return `${defaultMessage} (HTTP ${status})`
  }
}

export interface SalesforceQueryParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  query: string
}

/**
 * Execute a custom SOQL query
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm
 */
export const salesforceQueryTool: ToolConfig<any, any> = {
  id: 'salesforce_query',
  name: 'Run SOQL Query in Salesforce',
  description: 'Execute a custom SOQL query to retrieve data from Salesforce',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SOQL query to execute (e.g., SELECT Id, Name FROM Account LIMIT 10)',
    },
  },
  request: {
    url: (params) => {
      if (!params.query || params.query.trim() === '') {
        throw new Error(
          'SOQL Query is required. Please provide a valid SOQL query (e.g., SELECT Id, Name FROM Account LIMIT 10).'
        )
      }
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      const encodedQuery = encodeURIComponent(params.query)
      return `${instanceUrl}/services/data/v59.0/query?q=${encodedQuery}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response, params) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        'Failed to execute SOQL query'
      )
      logger.error('Failed to execute SOQL query', { data, status: response.status })
      throw new Error(errorMessage)
    }

    const records = data.records || []

    return {
      success: true,
      output: {
        records,
        totalSize: data.totalSize || records.length,
        done: data.done !== false,
        nextRecordsUrl: data.nextRecordsUrl,
        query: params.query,
        metadata: {
          operation: 'query',
          totalReturned: records.length,
          hasMore: !data.done,
        },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Query results',
      properties: {
        records: { type: 'array', description: 'Array of record objects' },
        totalSize: { type: 'number', description: 'Total number of records matching query' },
        done: { type: 'boolean', description: 'Whether all records have been returned' },
        nextRecordsUrl: { type: 'string', description: 'URL to fetch next batch of records' },
        query: { type: 'string', description: 'The executed SOQL query' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}

export interface SalesforceQueryMoreParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  nextRecordsUrl: string
}

/**
 * Retrieve additional query results using the nextRecordsUrl
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm
 */
export const salesforceQueryMoreTool: ToolConfig<any, any> = {
  id: 'salesforce_query_more',
  name: 'Get More Query Results from Salesforce',
  description: 'Retrieve additional query results using the nextRecordsUrl from a previous query',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    nextRecordsUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The nextRecordsUrl from a previous query response',
    },
  },
  request: {
    url: (params) => {
      if (!params.nextRecordsUrl || params.nextRecordsUrl.trim() === '') {
        throw new Error(
          'Next Records URL is required. This should be the nextRecordsUrl value from a previous query response.'
        )
      }
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      // nextRecordsUrl is typically a relative path like /services/data/v59.0/query/01g...
      const nextUrl = params.nextRecordsUrl.startsWith('/')
        ? params.nextRecordsUrl
        : `/${params.nextRecordsUrl}`
      return `${instanceUrl}${nextUrl}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        'Failed to get more query results'
      )
      logger.error('Failed to get more query results', { data, status: response.status })
      throw new Error(errorMessage)
    }

    const records = data.records || []

    return {
      success: true,
      output: {
        records,
        totalSize: data.totalSize || records.length,
        done: data.done !== false,
        nextRecordsUrl: data.nextRecordsUrl,
        metadata: {
          operation: 'query_more',
          totalReturned: records.length,
          hasMore: !data.done,
        },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Query results',
      properties: {
        records: { type: 'array', description: 'Array of record objects' },
        totalSize: { type: 'number', description: 'Total number of records matching query' },
        done: { type: 'boolean', description: 'Whether all records have been returned' },
        nextRecordsUrl: { type: 'string', description: 'URL to fetch next batch of records' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}

export interface SalesforceDescribeObjectParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  objectName: string
}

/**
 * Describe a Salesforce object to get its metadata/fields
 * Useful for discovering available fields for queries
 */
export const salesforceDescribeObjectTool: ToolConfig<any, any> = {
  id: 'salesforce_describe_object',
  name: 'Describe Salesforce Object',
  description: 'Get metadata and field information for a Salesforce object',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    objectName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'API name of the object (e.g., Account, Contact, Lead, Custom_Object__c)',
    },
  },
  request: {
    url: (params) => {
      if (!params.objectName || params.objectName.trim() === '') {
        throw new Error(
          'Object Name is required. Please provide a valid Salesforce object API name (e.g., Account, Contact, Lead).'
        )
      }
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/sobjects/${params.objectName}/describe`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response, params) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        `Failed to describe object: ${params.objectName}`
      )
      logger.error('Failed to describe object', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        objectName: params.objectName,
        label: data.label,
        labelPlural: data.labelPlural,
        fields: data.fields,
        keyPrefix: data.keyPrefix,
        queryable: data.queryable,
        createable: data.createable,
        updateable: data.updateable,
        deletable: data.deletable,
        childRelationships: data.childRelationships,
        recordTypeInfos: data.recordTypeInfos,
        metadata: {
          operation: 'describe_object',
          fieldCount: data.fields?.length || 0,
        },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Object metadata',
      properties: {
        objectName: { type: 'string', description: 'API name of the object' },
        label: { type: 'string', description: 'Display label' },
        labelPlural: { type: 'string', description: 'Plural display label' },
        fields: { type: 'array', description: 'Array of field definitions' },
        keyPrefix: { type: 'string', description: 'ID prefix for this object type' },
        queryable: { type: 'boolean', description: 'Whether object can be queried' },
        createable: { type: 'boolean', description: 'Whether records can be created' },
        updateable: { type: 'boolean', description: 'Whether records can be updated' },
        deletable: { type: 'boolean', description: 'Whether records can be deleted' },
        childRelationships: { type: 'array', description: 'Child relationship definitions' },
        recordTypeInfos: { type: 'array', description: 'Record type information' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}

/**
 * List all available Salesforce objects
 * Useful for discovering what objects are available
 */
export const salesforceListObjectsTool: ToolConfig<any, any> = {
  id: 'salesforce_list_objects',
  name: 'List Salesforce Objects',
  description: 'Get a list of all available Salesforce objects',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
  },
  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/sobjects`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        'Failed to list Salesforce objects'
      )
      logger.error('Failed to list objects', { data, status: response.status })
      throw new Error(errorMessage)
    }

    const objects = data.sobjects || []

    return {
      success: true,
      output: {
        objects,
        encoding: data.encoding,
        maxBatchSize: data.maxBatchSize,
        metadata: {
          operation: 'list_objects',
          totalReturned: objects.length,
        },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Objects list',
      properties: {
        objects: { type: 'array', description: 'Array of available Salesforce objects' },
        encoding: { type: 'string', description: 'Encoding used' },
        maxBatchSize: { type: 'number', description: 'Maximum batch size' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
