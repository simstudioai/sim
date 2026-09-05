import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  type OracleFusionRecruitingUpdateRequisitionParams,
  type OracleFusionRecruitingUpdateRequisitionResponse,
  UPDATE_REQUISITION_OUTPUTS,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingUpdateRequisitionTool: InternalToolConfig<
  OracleFusionRecruitingUpdateRequisitionParams,
  OracleFusionRecruitingUpdateRequisitionResponse
> = {
  id: 'oracle_fusion_recruiting_update_requisition',
  name: 'Update Requisition',
  description: 'Update requisition.',
  ...internalExecution,
  params: {
    ...credentials,
    requisitionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Requisition id; use the identifier returned by the matching list tool',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Documented Oracle fields: Title, RequisitionNumber, RecruitingType, HiringManagerId, RecruiterId, PrimaryLocationId, PhaseId, StateId, UnlimitedOpenings, NumberOfOpenings, TemplateId, HiringManagerAssignmentId, RecruiterAssignmentId, BusinessUnitId, DepartmentId, JobId, JobFamilyId, PositionId, GradeId, LegalEmployerId, OrganizationId, PrimaryWorkLocationId, CandidateSelectionProcessId, WorkerType, JobType, FullTimeOrPartTime, RegularOrTemporary, WorkplaceTypeCode, BusinessJustification, ExternalContactName, ExternalContactEmail, InternalContactName, InternalContactEmail. Int64 IDs must be decimal strings.',
    },
  },
  outputs: UPDATE_REQUISITION_OUTPUTS,
}
