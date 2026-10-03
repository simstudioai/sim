import {
  credentials,
  internalExecution,
  page,
  search,
} from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_INTERVIEW_SCHEDULES_OUTPUTS,
  type OracleFusionRecruitingListInterviewSchedulesParams,
  type OracleFusionRecruitingListInterviewSchedulesResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListInterviewSchedulesTool: InternalToolConfig<
  OracleFusionRecruitingListInterviewSchedulesParams,
  OracleFusionRecruitingListInterviewSchedulesResponse
> = {
  id: 'oracle_fusion_recruiting_list_interview_schedules',
  name: 'List Interview Schedules',
  description:
    'List interview schedules. Returns schedule lookup metadata, not interview appointments.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    ...search,
  },
  outputs: LIST_INTERVIEW_SCHEDULES_OUTPUTS,
}
