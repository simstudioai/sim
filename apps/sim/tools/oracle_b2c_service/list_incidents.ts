import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  incidentSummaryProperties,
  listParams,
  pageOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleB2CServiceListParams,
  OracleIncidentSummary,
  OraclePageResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildCollectionUrl,
  buildOracleHeaders,
  mapIncidentSummary,
  transformPageResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceListIncidentsTool: ToolConfig<
  OracleB2CServiceListParams,
  OraclePageResponse<OracleIncidentSummary>
> = {
  id: 'oracle_b2c_service_list_incidents',
  name: 'Oracle B2C Service List Incidents',
  description: 'Return one bounded page of Oracle B2C Service incident summaries.',
  version: '1.0.0',
  params: { ...authParams, ...listParams },
  request: {
    url: (params) => buildCollectionUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.incidents),
    method: 'GET',
    headers: buildOracleHeaders,
  },
  transformResponse: transformPageResponse(mapIncidentSummary),
  outputs: pageOutputs(incidentSummaryProperties),
}
