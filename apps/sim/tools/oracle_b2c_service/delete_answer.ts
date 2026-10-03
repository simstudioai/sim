import { ORACLE_B2C_SERVICE_COLLECTIONS } from '@/tools/oracle_b2c_service/constants'
import { authParams, idParam, mutationOutputs } from '@/tools/oracle_b2c_service/params'
import type {
  OracleB2CServiceRecordParams,
  OracleMutationResponse,
} from '@/tools/oracle_b2c_service/types'
import {
  buildOracleHeaders,
  buildResourceUrl,
  transformMutationResponse,
} from '@/tools/oracle_b2c_service/utils'
import type { ToolConfig } from '@/tools/types'

export const oracleB2CServiceDeleteAnswerTool: ToolConfig<
  OracleB2CServiceRecordParams,
  OracleMutationResponse
> = {
  id: 'oracle_b2c_service_delete_answer',
  name: 'Oracle B2C Service Delete Classic Answer',
  description: 'Delete an Oracle B2C Service Classic Answer by ID.',
  version: '1.0.0',
  params: { ...authParams, ...idParam },
  request: {
    url: (params) => buildResourceUrl(params, ORACLE_B2C_SERVICE_COLLECTIONS.answers, params.id),
    method: 'DELETE',
    headers: buildOracleHeaders,
  },
  transformResponse: transformMutationResponse('deleted'),
  outputs: mutationOutputs,
}
