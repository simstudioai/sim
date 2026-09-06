import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_PERSON_PROCESS_RESULT_OUTPUTS,
  type OracleFusionHcmGetPersonProcessResultParams,
  type OracleFusionHcmGetPersonProcessResultResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetPersonProcessResultTool: InternalToolConfig<
  OracleFusionHcmGetPersonProcessResultParams,
  OracleFusionHcmGetPersonProcessResultResponse
> = {
  id: 'oracle_fusion_hcm_get_person_process_result',
  name: 'Get Person Process Result in Oracle Fusion HCM',
  description:
    'Read an Oracle Fusion HCM person process result by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
    objectActionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object action ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_PERSON_PROCESS_RESULT_OUTPUTS,
}
