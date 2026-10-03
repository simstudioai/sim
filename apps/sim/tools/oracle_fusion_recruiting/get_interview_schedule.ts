import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  GET_INTERVIEW_SCHEDULE_OUTPUTS,
  type OracleFusionRecruitingGetInterviewScheduleParams,
  type OracleFusionRecruitingGetInterviewScheduleResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingGetInterviewScheduleTool: InternalToolConfig<
  OracleFusionRecruitingGetInterviewScheduleParams,
  OracleFusionRecruitingGetInterviewScheduleResponse
> = {
  id: 'oracle_fusion_recruiting_get_interview_schedule',
  name: 'Get Interview Schedule',
  description:
    'Get interview schedule. Returns schedule lookup metadata, not interview appointments.',
  ...internalExecution,
  params: {
    ...credentials,
    scheduleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Schedule id; use the identifier returned by the matching list tool',
    },
  },
  outputs: GET_INTERVIEW_SCHEDULE_OUTPUTS,
}
