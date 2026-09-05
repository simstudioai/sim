import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  GET_APPLICATION_OUTPUTS,
  type OracleFusionRecruitingGetApplicationParams,
  type OracleFusionRecruitingGetApplicationResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingGetApplicationTool: InternalToolConfig<
  OracleFusionRecruitingGetApplicationParams,
  OracleFusionRecruitingGetApplicationResponse
> = {
  id: 'oracle_fusion_recruiting_get_application',
  name: 'Get Application',
  description: 'Get application.',
  ...internalExecution,
  params: {
    ...credentials,
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Application id; use the identifier returned by the matching list tool',
    },
  },
  outputs: GET_APPLICATION_OUTPUTS,
}
