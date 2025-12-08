import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { extractErrorMessage, getInstanceUrl } from './utils'

const logger = createLogger('SalesforceQuery')

export interface SalesforceDescribeObjectParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  objectName: string
}

export interface SalesforceDescribeObjectResponse {
  success: boolean
  output: {
    objectName: string
    label?: string
    labelPlural?: string
    fields?: any[]
    keyPrefix?: string
    queryable?: boolean
    createable?: boolean
    updateable?: boolean
    deletable?: boolean
    childRelationships?: any[]
    recordTypeInfos?: any[]
    metadata: {
      operation: 'describe_object'
      fieldCount: number
    }
    success: boolean
  }
}

/**
 * Describe a Salesforce object to get its metadata/fields
 * Useful for discovering available fields for queries
 */
export const salesforceDescribeObjectTool: ToolConfig<
  SalesforceDescribeObjectParams,
  SalesforceDescribeObjectResponse
> = {
  id: 'salesforce_describe_object',
  name: 'Describe Salesforce Object',
  description: 'Get metadata and field information for a Salesforce object',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

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

  transformResponse: async (response, params?) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        `Failed to describe object: ${params?.objectName}`
      )
      logger.error('Failed to describe object', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        objectName: params?.objectName || '',
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
