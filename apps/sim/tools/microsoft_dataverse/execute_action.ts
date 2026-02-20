import { createLogger } from '@sim/logger'
import type {
  DataverseExecuteActionParams,
  DataverseExecuteActionResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseExecuteAction')

export const dataverseExecuteActionTool: ToolConfig<
  DataverseExecuteActionParams,
  DataverseExecuteActionResponse
> = {
  id: 'microsoft_dataverse_execute_action',
  name: 'Execute Microsoft Dataverse Action',
  description:
    'Execute a bound or unbound Dataverse action. Actions perform operations with side effects (e.g., Merge, GrantAccess, SendEmail, QualifyLead). For bound actions, provide the entity set name and record ID.',
  version: '1.0.0',

  oauth: { required: true, provider: 'microsoft-dataverse' },
  errorExtractor: 'nested-error-object',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Microsoft Dataverse API',
    },
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dataverse environment URL (e.g., https://myorg.crm.dynamics.com)',
    },
    actionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Action name (e.g., Merge, GrantAccess, SendEmail). Do not include the Microsoft.Dynamics.CRM. namespace prefix for unbound actions.',
    },
    entitySetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Entity set name for bound actions (e.g., accounts). Leave empty for unbound actions.',
    },
    recordId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Record GUID for bound actions. Leave empty for unbound or collection-bound actions.',
    },
    parameters: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Action parameters as a JSON object. For entity references, include @odata.type annotation (e.g., {"Target": {"@odata.type": "Microsoft.Dynamics.CRM.account", "accountid": "..."}})',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      if (params.entitySetName) {
        if (params.recordId) {
          return `${baseUrl}/api/data/v9.2/${params.entitySetName}(${params.recordId})/Microsoft.Dynamics.CRM.${params.actionName}`
        }
        return `${baseUrl}/api/data/v9.2/${params.entitySetName}/Microsoft.Dynamics.CRM.${params.actionName}`
      }
      return `${baseUrl}/api/data/v9.2/${params.actionName}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
    body: (params) => {
      if (!params.parameters) return {}
      let data = params.parameters
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          throw new Error('Invalid JSON format for action parameters')
        }
      }
      return data
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse execute action failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const data = response.status === 204 ? null : await response.json().catch(() => null)

    return {
      success: true,
      output: {
        result: data,
        success: true,
      },
    }
  },

  outputs: {
    result: {
      type: 'object',
      description:
        'Action response data. Structure varies by action. Null for actions that return 204 No Content.',
      optional: true,
    },
    success: { type: 'boolean', description: 'Whether the action executed successfully' },
  },
}
