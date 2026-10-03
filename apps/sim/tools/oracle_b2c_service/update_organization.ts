import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  idParam,
  mutationOutputs,
  organizationWriteParams,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleMutationResponse,
  OracleUpdateOrganizationParams,
} from '@/tools/oracle_b2c_service/types'
import {
  buildOracleHeaders,
  buildOrganizationBody,
  buildResourceUrl,
  requireAtLeastOneField,
  transformMutationResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceUpdateOrganizationTool: ToolConfig<
  OracleUpdateOrganizationParams,
  OracleMutationResponse
> = {
  id: 'oracle_b2c_service_update_organization',
  name: 'Oracle B2C Service Update Organization',
  description: 'Update named fields on an Oracle B2C Service organization.',
  version: '1.0.0',
  params: { ...authParams, ...idParam, ...organizationWriteParams },
  request: {
    url: (params) =>
      buildResourceUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.organizations, params.id),
    method: 'PATCH',
    headers: (params) => buildOracleHeaders(params, { json: true }),
    body: (params) => requireAtLeastOneField(buildOrganizationBody(params), 'Update organization'),
  },
  transformResponse: transformMutationResponse('updated'),
  outputs: mutationOutputs,
}
