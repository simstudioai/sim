import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  answerWriteParams,
  authParams,
  idParam,
  mutationOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleMutationResponse,
  OracleUpdateAnswerParams,
} from '@/tools/oracle_b2c_service/types'
import {
  buildAnswerBody,
  buildOracleHeaders,
  buildResourceUrl,
  requireAtLeastOneField,
  transformMutationResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceUpdateAnswerTool: ToolConfig<
  OracleUpdateAnswerParams,
  OracleMutationResponse
> = {
  id: 'oracle_b2c_service_update_answer',
  name: 'Oracle B2C Service Update Classic Answer',
  description: 'Update named fields on an Oracle B2C Service Classic Answer.',
  version: '1.0.0',
  params: { ...authParams, ...idParam, ...answerWriteParams },
  request: {
    url: (params) => buildResourceUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.answers, params.id),
    method: 'PATCH',
    headers: (params) => buildOracleHeaders(params, { json: true }),
    body: (params) => requireAtLeastOneField(buildAnswerBody(params), 'Update answer'),
  },
  transformResponse: transformMutationResponse('updated'),
  outputs: mutationOutputs,
}
