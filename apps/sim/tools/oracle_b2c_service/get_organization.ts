import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  idParam,
  organizationProperties,
  resourceOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleB2CServiceRecordParams,
  OracleOrganization,
  OracleResourceResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildOracleHeaders,
  buildResourceUrl,
  mapOrganization,
  transformResourceResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceGetOrganizationTool: ToolConfig<
  OracleB2CServiceRecordParams,
  OracleResourceResponse<OracleOrganization>
> = {
  id: 'oracle_b2c_service_get_organization',
  name: 'Oracle B2C Service Get Organization',
  description: 'Retrieve an Oracle B2C Service organization by ID.',
  version: '1.0.0',
  params: { ...authParams, ...idParam },
  request: {
    url: (params) =>
      buildResourceUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.organizations, params.id),
    method: 'GET',
    headers: buildOracleHeaders,
  },
  transformResponse: transformResourceResponse(mapOrganization),
  outputs: resourceOutputs(organizationProperties),
}
