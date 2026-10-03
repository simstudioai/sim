import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  contactWriteParams,
  idParam,
  mutationOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleMutationResponse,
  OracleUpdateContactParams,
} from '@/tools/oracle_b2c_service/types'
import {
  buildContactBody,
  buildOracleHeaders,
  buildResourceUrl,
  requireAtLeastOneField,
  transformMutationResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceUpdateContactTool: ToolConfig<
  OracleUpdateContactParams,
  OracleMutationResponse
> = {
  id: 'oracle_b2c_service_update_contact',
  name: 'Oracle B2C Service Update Contact',
  description: 'Update named fields on an Oracle B2C Service contact.',
  version: '1.0.0',
  params: { ...authParams, ...idParam, ...contactWriteParams },
  request: {
    url: (params) => buildResourceUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.contacts, params.id),
    method: 'PATCH',
    headers: (params) => buildOracleHeaders(params, { json: true }),
    body: (params) => requireAtLeastOneField(buildContactBody(params), 'Update contact'),
  },
  transformResponse: transformMutationResponse('updated'),
  outputs: mutationOutputs,
}
