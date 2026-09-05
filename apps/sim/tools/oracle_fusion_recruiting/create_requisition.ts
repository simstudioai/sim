import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  CREATE_REQUISITION_OUTPUTS,
  type OracleFusionRecruitingCreateRequisitionParams,
  type OracleFusionRecruitingCreateRequisitionResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingCreateRequisitionTool: InternalToolConfig<
  OracleFusionRecruitingCreateRequisitionParams,
  OracleFusionRecruitingCreateRequisitionResponse
> = {
  id: 'oracle_fusion_recruiting_create_requisition',
  name: 'Create Requisition',
  description: 'Create requisition.',
  ...internalExecution,
  params: {
    ...credentials,
    body: { type: 'json', required: true, visibility: 'user-or-llm', description: 'Documented Oracle fields: Title, RequisitionNumber, RecruitingType, HiringManagerId, RecruiterId, PrimaryLocationId, PhaseId, StateId, UnlimitedOpenings, NumberOfOpenings, TemplateId, HiringManagerAssignmentId, RecruiterAssignmentId, BusinessUnitId, DepartmentId, JobId, JobFamilyId, PositionId, GradeId, LegalEmployerId, OrganizationId, PrimaryWorkLocationId, CandidateSelectionProcessId, WorkerType, JobType, FullTimeOrPartTime, RegularOrTemporary, WorkplaceTypeCode, BusinessJustification, ExternalContactName, ExternalContactEmail, InternalContactName, InternalContactEmail. Int64 IDs must be decimal strings. Required: HiringManagerId, PhaseId, PrimaryLocationId, RecruiterId, RecruitingType, StateId, Title, UnlimitedOpenings.' },
  },
  outputs: CREATE_REQUISITION_OUTPUTS,
}
