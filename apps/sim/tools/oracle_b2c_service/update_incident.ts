import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  idParam,
  incidentWriteParams,
  mutationOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleMutationResponse,
  OracleUpdateIncidentParams,
} from '@/tools/oracle_b2c_service/types'
import {
  buildIncidentBody,
  buildOracleHeaders,
  buildResourceUrl,
  requireAtLeastOneField,
  transformMutationResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceUpdateIncidentTool: ToolConfig<
  OracleUpdateIncidentParams,
  OracleMutationResponse
> = {
  id: 'oracle_b2c_service_update_incident',
  name: 'Oracle B2C Service Update Incident',
  description: 'Update named fields on an Oracle B2C Service incident.',
  version: '1.0.0',
  params: { ...authParams, ...idParam, ...incidentWriteParams },
  request: {
    url: (params) => buildResourceUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.incidents, params.id),
    method: 'PATCH',
    headers: (params) => buildOracleHeaders(params, { json: true }),
    body: (params) => requireAtLeastOneField(buildIncidentBody(params), 'Update incident'),
  },
  transformResponse: transformMutationResponse('updated'),
  outputs: mutationOutputs,
}
