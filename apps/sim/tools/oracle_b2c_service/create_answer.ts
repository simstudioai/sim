import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  answerProperties,
  answerWriteParams,
  authParams,
  resourceOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleAnswer,
  OracleCreateAnswerParams,
  OracleResourceResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildAnswerBody,
  buildCreateUrl,
  buildOracleHeaders,
  mapAnswer,
  requireNonBlank,
  transformResourceResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceCreateAnswerTool: ToolConfig<
  OracleCreateAnswerParams,
  OracleResourceResponse<OracleAnswer>
> = {
  id: 'oracle_b2c_service_create_answer',
  name: 'Oracle B2C Service Create Classic Answer',
  description: 'Create an Oracle B2C Service Classic Answer.',
  version: '1.0.0',
  params: {
    ...authParams,
    ...answerWriteParams,
    answerTypeId: { ...answerWriteParams.answerTypeId, required: true },
    languageId: { ...answerWriteParams.languageId, required: true },
    summary: { ...answerWriteParams.summary, required: true },
  },
  request: {
    url: (params) => buildCreateUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.answers),
    method: 'POST',
    headers: (params) => buildOracleHeaders(params, { json: true }),
    body: (params) =>
      buildAnswerBody({ ...params, summary: requireNonBlank(params.summary, 'Answer summary') }),
  },
  transformResponse: transformResourceResponse(mapAnswer),
  outputs: resourceOutputs(answerProperties),
}
