import { createLogger } from '@sim/logger'
import type {
  DataverseCloseCaseParams,
  DataverseCloseCaseResponse,
} from '@/tools/microsoft_dynamics_365/types'
import {
  getDataverseErrorMessage,
  getDynamics365BaseUrl,
  normalizeDataverseGuid,
  parseDataverseInt32,
  parseDataverseRequiredString,
} from '@/tools/microsoft_dynamics_365/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseCloseCase')

export const microsoftDynamics365CloseCaseTool: ToolConfig<
  DataverseCloseCaseParams,
  DataverseCloseCaseResponse
> = {
  id: 'microsoft_dynamics_365_close_case',
  name: 'Close Microsoft Dynamics 365 Case',
  description: 'Resolve and close a Dynamics 365 Customer Service case.',
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
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Trusted Dynamics 365 environment bound to the selected OAuth credential',
    },
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dynamics 365 environment URL (e.g., https://myorg.crm.dynamics.com)',
    },
    caseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GUID of the case to close',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Subject for the case-resolution activity (maximum 200 characters)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional description for the case-resolution activity',
    },
    timeSpent: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional nonnegative number of minutes spent resolving the case',
    },
    statusReason: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resolved case status-reason value (default: 5)',
    },
  },

  request: {
    url: (params) =>
      `${getDynamics365BaseUrl(params.environmentUrl, params.instanceUrl)}/api/data/v9.2/CloseIncident`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
    body: (params) => {
      const caseId = normalizeDataverseGuid(params.caseId, 'caseId')
      const subject = parseDataverseRequiredString(params.subject, 'subject', 200)
      const status =
        params.statusReason === undefined
          ? 5
          : parseDataverseInt32(params.statusReason, 'statusReason')
      const incidentResolution: Record<string, unknown> = {
        'incidentid@odata.bind': `/incidents(${caseId})`,
        subject,
      }
      if (params.description !== undefined) {
        if (typeof params.description !== 'string') {
          throw new Error('description must be a string')
        }
        incidentResolution.description = params.description
      }
      if (params.timeSpent !== undefined) {
        const timeSpent = parseDataverseInt32(params.timeSpent, 'timeSpent')
        if (timeSpent < 0) {
          throw new Error('timeSpent must be a nonnegative integer')
        }
        incidentResolution.timespent = timeSpent
      }

      return {
        IncidentResolution: incidentResolution,
        Status: status,
      }
    },
  },

  transformResponse: async (response: Response, params?: DataverseCloseCaseParams) => {
    if (!response.ok) {
      const errorMessage = await getDataverseErrorMessage(response)
      logger.error('Dataverse close case failed', { status: response.status })
      throw new Error(errorMessage)
    }
    if (response.status !== 204) {
      throw new Error(
        `Invalid Dataverse close case response: expected HTTP 204, received ${response.status}`
      )
    }
    if (!params) {
      throw new Error('Missing Dataverse close case response context')
    }

    return {
      success: true,
      output: {
        caseId: normalizeDataverseGuid(params.caseId, 'caseId'),
        success: true,
      },
    }
  },

  outputs: {
    caseId: { type: 'string', description: 'GUID of the closed case' },
    success: { type: 'boolean', description: 'Whether the case was closed successfully' },
  },
}
