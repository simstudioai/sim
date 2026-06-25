import { createLogger } from '@sim/logger'
import type {
  SalesforceCreateCustomObjectParams,
  SalesforceCreateCustomObjectResponse,
} from '@/tools/salesforce/types'
import { CUSTOM_OBJECT_CREATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl, toCustomApiName } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceCreateCustomObject')

/**
 * Create a custom object via the Tooling API. The object is created with a
 * Text Name field and deployed immediately. Custom fields can then be added
 * with the Create Custom Field tool.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_customobject.htm
 */
export const salesforceCreateCustomObjectTool: ToolConfig<
  SalesforceCreateCustomObjectParams,
  SalesforceCreateCustomObjectResponse
> = {
  id: 'salesforce_create_custom_object',
  name: 'Create Custom Object in Salesforce',
  description: 'Create a custom object in Salesforce using the Tooling API',
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
      description:
        'API name of the new object; the __c suffix is added automatically (e.g., Project)',
    },
    label: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Singular display label for the object (e.g., Project)',
    },
    pluralLabel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Plural display label for the object (e.g., Projects)',
    },
    nameFieldLabel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label for the standard Name field (defaults to "<label> Name")',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal description of the object',
    },
    sharingModel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Org-wide sharing model: ReadWrite, Read, Private, or ControlledByParent (default ReadWrite)',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/tooling/sobjects/CustomObject`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const objectApiName = toCustomApiName(params.objectName, 'Object Name')
      const label = params.label?.trim()
      const pluralLabel = params.pluralLabel?.trim()
      if (!label) throw new Error('Label is required to create a custom object.')
      if (!pluralLabel) throw new Error('Plural Label is required to create a custom object.')

      const metadata: Record<string, any> = {
        label,
        pluralLabel,
        nameField: {
          type: 'Text',
          label: params.nameFieldLabel?.trim() || `${label} Name`,
        },
        deploymentStatus: 'Deployed',
        sharingModel: params.sharingModel?.trim() || 'ReadWrite',
      }
      if (params.description?.trim()) metadata.description = params.description.trim()

      return {
        FullName: objectApiName,
        Metadata: metadata,
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok || data?.success === false) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        'Failed to create custom object in Salesforce'
      )
      logger.error('Failed to create custom object', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        id: data.id,
        fullName: params?.objectName ? toCustomApiName(params.objectName, 'Object Name') : '',
        success: data.success === true,
        created: data.success === true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created custom object metadata',
      properties: CUSTOM_OBJECT_CREATE_OUTPUT_PROPERTIES,
    },
  },
}
