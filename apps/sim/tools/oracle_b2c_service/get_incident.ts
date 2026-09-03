import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  idParam,
  incidentProperties,
  includeThreadsParam,
  resourceOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleGetIncidentParams,
  OracleIncident,
  OracleResourceResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildOracleHeaders,
  buildResourceUrl,
  mapIncident,
  transformResourceResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceGetIncidentTool: ToolConfig<
  OracleGetIncidentParams,
  OracleResourceResponse<OracleIncident>
> = {
  id: 'oracle_b2c_service_get_incident',
  name: 'Oracle B2C Service Get Incident',
  description: 'Retrieve an Oracle B2C Service incident by ID, optionally including its threads.',
  version: '1.0.0',
  params: { ...authParams, ...idParam, ...includeThreadsParam },
  request: {
    url: (params) =>
      buildResourceUrl(
        params,
        ORACLE_B2C_SERVICE_COLLECTIONS.incidents,
        params.id,
        params.includeThreads ? ['threads'] : undefined
      ),
    method: 'GET',
    headers: buildOracleHeaders,
  },
  transformResponse: transformResourceResponse(mapIncident),
  outputs: resourceOutputs(incidentProperties),
}
