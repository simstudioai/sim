import { authParams, incidentResponseOutputs } from '@/tools/oracle_b2c_service/params'
import type {
  OracleCreateIncidentResponseParams,
  OracleIncidentResponseResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildIncidentResponseBody,
  buildIncidentResponseUrl,
  buildOracleHeaders,
  transformIncidentResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceCreateIncidentResponseTool: ToolConfig<
  OracleCreateIncidentResponseParams,
  OracleIncidentResponseResponse
> = {
  id: 'oracle_b2c_service_create_incident_response',
  name: 'Oracle B2C Service Create Incident Response',
  description: 'Send a customer-facing email response through an Oracle B2C Service incident.',
  version: '1.0.0',
  params: {
    ...authParams,
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Incident numeric ID',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Response body text',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional response subject',
    },
    ccEmails: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'CC email addresses',
      items: { type: 'string', format: 'email' },
    },
    bccEmails: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'BCC email addresses',
      items: { type: 'string', format: 'email' },
    },
    useEmailSignature: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Append the responding staff account email signature',
    },
  },
  request: {
    url: buildIncidentResponseUrl,
    method: 'POST',
    headers: (params) => buildOracleHeaders(params, { json: true }),
    body: buildIncidentResponseBody,
  },
  transformResponse: transformIncidentResponse,
  outputs: incidentResponseOutputs,
}
