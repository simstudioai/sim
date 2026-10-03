import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  incidentProperties,
  incidentWriteParams,
  resourceOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleCreateIncidentParams,
  OracleIncident,
  OracleResourceResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildCreateUrl,
  buildIncidentBody,
  buildOracleHeaders,
  mapIncident,
  requireNonBlank,
  transformResourceResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceCreateIncidentTool: ToolConfig<
  OracleCreateIncidentParams,
  OracleResourceResponse<OracleIncident>
> = {
  id: 'oracle_b2c_service_create_incident',
  name: 'Oracle B2C Service Create Incident',
  description: 'Create an Oracle B2C Service incident with a subject and primary contact.',
  version: '1.0.0',
  params: {
    ...authParams,
    ...incidentWriteParams,
    subject: { ...incidentWriteParams.subject, required: true },
    primaryContactId: { ...incidentWriteParams.primaryContactId, required: true },
  },
  request: {
    url: (params) => buildCreateUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.incidents),
    method: 'POST',
    headers: (params) => buildOracleHeaders(params, { json: true }),
    body: (params) =>
      buildIncidentBody({
        ...params,
        subject: requireNonBlank(params.subject, 'Incident subject'),
      }),
  },
  transformResponse: transformResourceResponse(mapIncident),
  outputs: resourceOutputs(incidentProperties),
}
