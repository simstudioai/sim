import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  authParams,
  contactProperties,
  idParam,
  resourceOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleB2CServiceRecordParams,
  OracleContact,
  OracleResourceResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildOracleHeaders,
  buildResourceUrl,
  mapContact,
  transformResourceResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceGetContactTool: ToolConfig<
  OracleB2CServiceRecordParams,
  OracleResourceResponse<OracleContact>
> = {
  id: 'oracle_b2c_service_get_contact',
  name: 'Oracle B2C Service Get Contact',
  description:
    'Retrieve an Oracle B2C Service contact by ID, including email addresses and phone numbers.',
  version: '1.0.0',
  params: { ...authParams, ...idParam },
  request: {
    url: (params) =>
      buildResourceUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.contacts, params.id, [
        'emails',
        'phones',
      ]),
    method: 'GET',
    headers: buildOracleHeaders,
  },
  transformResponse: transformResourceResponse(mapContact),
  outputs: resourceOutputs(contactProperties),
}
