import { createLogger } from '@sim/logger'
import type {
  SalesforceDescribeObjectParams,
  SalesforceDescribeObjectResponse,
} from '@/tools/salesforce/types'
import { DESCRIBE_OBJECT_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceQuery')

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
      visibility: 'user-or-llm',
      description: 'Salesforce object API name (e.g., Account, Contact, Lead, Custom_Object__c)',
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
        keyPrefix: data.keyPrefix ?? null,
        queryable: data.queryable,
        createable: data.createable,
        updateable: data.updateable,
        deletable: data.deletable,
        childRelationships: data.childRelationships,
        recordTypeInfos: data.recordTypeInfos,
        fieldCount: data.fields?.length || 0,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Object metadata',
      properties: DESCRIBE_OBJECT_OUTPUT_PROPERTIES,
    },
  },
}
