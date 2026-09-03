import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  contactProperties,
  contactWriteParams,
  resourceOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleContact,
  OracleCreateContactParams,
  OracleResourceResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildContactBody,
  buildCreateUrl,
  buildOracleHeaders,
  mapContact,
  transformResourceResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceCreateContactTool: ToolConfig<
  OracleCreateContactParams,
  OracleResourceResponse<OracleContact>
> = {
  id: 'oracle_b2c_service_create_contact',
  name: 'Oracle B2C Service Create Contact',
  description: 'Create an Oracle B2C Service contact with the supplied fields.',
  version: '1.0.0',
  params: { ...authParams, ...contactWriteParams },
  request: {
    url: (params) => buildCreateUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.contacts),
    method: 'POST',
    headers: (params) => buildOracleHeaders(params, { json: true }),
    body: buildContactBody,
  },
  transformResponse: transformResourceResponse(mapContact),
  outputs: resourceOutputs(contactProperties),
}
