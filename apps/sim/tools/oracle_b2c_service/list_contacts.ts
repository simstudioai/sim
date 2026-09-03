import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  contactSummaryProperties,
  listParams,
  pageOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleB2CServiceListParams,
  OracleContactSummary,
  OraclePageResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildCollectionUrl,
  buildOracleHeaders,
  mapContactSummary,
  transformPageResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceListContactsTool: ToolConfig<
  OracleB2CServiceListParams,
  OraclePageResponse<OracleContactSummary>
> = {
  id: 'oracle_b2c_service_list_contacts',
  name: 'Oracle B2C Service List Contacts',
  description: 'Return one bounded page of Oracle B2C Service contact summaries.',
  version: '1.0.0',
  params: { ...authParams, ...listParams },
  request: {
    url: (params) => buildCollectionUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.contacts),
    method: 'GET',
    headers: buildOracleHeaders,
  },
  transformResponse: transformPageResponse(mapContactSummary),
  outputs: pageOutputs(contactSummaryProperties),
}
