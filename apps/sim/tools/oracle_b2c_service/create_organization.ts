import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  organizationProperties,
  organizationWriteParams,
  resourceOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleCreateOrganizationParams,
  OracleOrganization,
  OracleResourceResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildCreateUrl,
  buildOracleHeaders,
  buildOrganizationBody,
  mapOrganization,
  requireNonBlank,
  transformResourceResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceCreateOrganizationTool: ToolConfig<
  OracleCreateOrganizationParams,
  OracleResourceResponse<OracleOrganization>
> = {
  id: 'oracle_b2c_service_create_organization',
  name: 'Oracle B2C Service Create Organization',
  description: 'Create an Oracle B2C Service organization.',
  version: '1.0.0',
  params: {
    ...authParams,
    ...organizationWriteParams,
    name: { ...organizationWriteParams.name, required: true },
  },
  request: {
    url: (params) => buildCreateUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.organizations),
    method: 'POST',
    headers: (params) => buildOracleHeaders(params, { json: true }),
    body: (params) =>
      buildOrganizationBody({ ...params, name: requireNonBlank(params.name, 'Organization name') }),
  },
  transformResponse: transformResourceResponse(mapOrganization),
  outputs: resourceOutputs(organizationProperties),
}
