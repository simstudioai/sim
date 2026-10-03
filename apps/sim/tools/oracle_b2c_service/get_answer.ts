import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  answerProperties,
  authParams,
  idParam,
  resourceOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleAnswer,
  OracleB2CServiceRecordParams,
  OracleResourceResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildOracleHeaders,
  buildResourceUrl,
  mapAnswer,
  transformResourceResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceGetAnswerTool: ToolConfig<
  OracleB2CServiceRecordParams,
  OracleResourceResponse<OracleAnswer>
> = {
  id: 'oracle_b2c_service_get_answer',
  name: 'Oracle B2C Service Get Classic Answer',
  description: 'Retrieve an Oracle B2C Service Classic Answer by ID.',
  version: '1.0.0',
  params: { ...authParams, ...idParam },
  request: {
    url: (params) => buildResourceUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.answers, params.id),
    method: 'GET',
    headers: buildOracleHeaders,
  },
  transformResponse: transformResourceResponse(mapAnswer),
  outputs: resourceOutputs(answerProperties),
}
