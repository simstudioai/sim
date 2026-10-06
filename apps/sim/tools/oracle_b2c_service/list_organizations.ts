import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  listParams,
  organizationSummaryProperties,
  pageOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleB2CServiceListParams,
  OracleOrganizationSummary,
  OraclePageResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildCollectionUrl,
  buildOracleHeaders,
  mapOrganizationSummary,
  transformPageResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceListOrganizationsTool: ToolConfig<
  OracleB2CServiceListParams,
  OraclePageResponse<OracleOrganizationSummary>
> = {
  id: 'oracle_b2c_service_list_organizations',
  name: 'Oracle B2C Service List Organizations',
  description: 'Return one bounded page of Oracle B2C Service organization summaries.',
  version: '1.0.0',
  params: { ...authParams, ...listParams },
  request: {
    url: (params) => buildCollectionUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.organizations),
    method: 'GET',
    headers: buildOracleHeaders,
  },
  transformResponse: transformPageResponse(mapOrganizationSummary),
  outputs: pageOutputs(organizationSummaryProperties),
}
