import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import {
  answerSummaryProperties,
  authParams,
  listParams,
  pageOutputs,
} from '@/tools/oracle_b2c_service/params'
import type {
  OracleAnswerSummary,
  OracleB2CServiceListParams,
  OraclePageResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildCollectionUrl,
  buildOracleHeaders,
  mapAnswerSummary,
  transformPageResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceListAnswersTool: ToolConfig<
  OracleB2CServiceListParams,
  OraclePageResponse<OracleAnswerSummary>
> = {
  id: 'oracle_b2c_service_list_answers',
  name: 'Oracle B2C Service List Classic Answers',
  description: 'Return one bounded page of Oracle B2C Service Classic Answer summaries.',
  version: '1.0.0',
  params: { ...authParams, ...listParams },
  request: {
    url: (params) => buildCollectionUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.answers),
    method: 'GET',
    headers: buildOracleHeaders,
  },
  transformResponse: transformPageResponse(mapAnswerSummary),
  outputs: pageOutputs(answerSummaryProperties),
}
