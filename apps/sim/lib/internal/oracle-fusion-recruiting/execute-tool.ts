import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import * as operations from '@/lib/internal/oracle-fusion-recruiting/operations'
import * as schemas from '@/lib/internal/oracle-fusion-recruiting/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function execute<S extends z.ZodType>(
  schema: S,
  input: unknown,
  operation: (input: z.output<S>, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return Response.json({ success: false, error: getValidationErrorMessage(parsed.error, 'Invalid Recruiting request') }, { status: 400 })
  }
  try {
    const result = await operation(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      return Response.json({ success: false, error: error.message }, { status: error.status })
    }
    return Response.json({ success: false, error: 'Oracle Fusion Recruiting request failed' }, { status: 500 })
  }
}

export const executeOracleFusionRecruitingTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  switch (toolId) {
    case 'oracle_fusion_recruiting_list_candidates':
      return execute(schemas.listCandidatesSchema, input, operations.executeListCandidates, signal)
    case 'oracle_fusion_recruiting_get_candidate':
      return execute(schemas.getCandidateSchema, input, operations.executeGetCandidate, signal)
    case 'oracle_fusion_recruiting_create_candidate':
      return execute(schemas.createCandidateSchema, input, operations.executeCreateCandidate, signal)
    case 'oracle_fusion_recruiting_update_candidate':
      return execute(schemas.updateCandidateSchema, input, operations.executeUpdateCandidate, signal)
    case 'oracle_fusion_recruiting_delete_candidate':
      return execute(schemas.deleteCandidateSchema, input, operations.executeDeleteCandidate, signal)
    case 'oracle_fusion_recruiting_list_candidate_phones':
      return execute(schemas.listCandidatePhonesSchema, input, operations.executeListCandidatePhones, signal)
    case 'oracle_fusion_recruiting_get_candidate_phone':
      return execute(schemas.getCandidatePhoneSchema, input, operations.executeGetCandidatePhone, signal)
    case 'oracle_fusion_recruiting_create_candidate_phone':
      return execute(schemas.createCandidatePhoneSchema, input, operations.executeCreateCandidatePhone, signal)
    case 'oracle_fusion_recruiting_update_candidate_phone':
      return execute(schemas.updateCandidatePhoneSchema, input, operations.executeUpdateCandidatePhone, signal)
    case 'oracle_fusion_recruiting_delete_candidate_phone':
      return execute(schemas.deleteCandidatePhoneSchema, input, operations.executeDeleteCandidatePhone, signal)
    case 'oracle_fusion_recruiting_list_candidate_education':
      return execute(schemas.listCandidateEducationSchema, input, operations.executeListCandidateEducation, signal)
    case 'oracle_fusion_recruiting_list_candidate_experience':
      return execute(schemas.listCandidateExperienceSchema, input, operations.executeListCandidateExperience, signal)
    case 'oracle_fusion_recruiting_list_candidate_skills':
      return execute(schemas.listCandidateSkillsSchema, input, operations.executeListCandidateSkills, signal)
    case 'oracle_fusion_recruiting_list_candidate_attachments':
      return execute(schemas.listCandidateAttachmentsSchema, input, operations.executeListCandidateAttachments, signal)
    case 'oracle_fusion_recruiting_list_requisitions':
      return execute(schemas.listRequisitionsSchema, input, operations.executeListRequisitions, signal)
    case 'oracle_fusion_recruiting_get_requisition':
      return execute(schemas.getRequisitionSchema, input, operations.executeGetRequisition, signal)
    case 'oracle_fusion_recruiting_create_requisition':
      return execute(schemas.createRequisitionSchema, input, operations.executeCreateRequisition, signal)
    case 'oracle_fusion_recruiting_update_requisition':
      return execute(schemas.updateRequisitionSchema, input, operations.executeUpdateRequisition, signal)
    case 'oracle_fusion_recruiting_delete_requisition':
      return execute(schemas.deleteRequisitionSchema, input, operations.executeDeleteRequisition, signal)
    case 'oracle_fusion_recruiting_list_requisition_postings':
      return execute(schemas.listRequisitionPostingsSchema, input, operations.executeListRequisitionPostings, signal)
    case 'oracle_fusion_recruiting_list_applications':
      return execute(schemas.listApplicationsSchema, input, operations.executeListApplications, signal)
    case 'oracle_fusion_recruiting_get_application':
      return execute(schemas.getApplicationSchema, input, operations.executeGetApplication, signal)
    case 'oracle_fusion_recruiting_list_offers':
      return execute(schemas.listOffersSchema, input, operations.executeListOffers, signal)
    case 'oracle_fusion_recruiting_get_offer':
      return execute(schemas.getOfferSchema, input, operations.executeGetOffer, signal)
    case 'oracle_fusion_recruiting_list_interview_schedules':
      return execute(schemas.listInterviewSchedulesSchema, input, operations.executeListInterviewSchedules, signal)
    case 'oracle_fusion_recruiting_get_interview_schedule':
      return execute(schemas.getInterviewScheduleSchema, input, operations.executeGetInterviewSchedule, signal)
    case 'oracle_fusion_recruiting_list_requisition_templates':
      return execute(schemas.listRequisitionTemplatesSchema, input, operations.executeListRequisitionTemplates, signal)
    case 'oracle_fusion_recruiting_list_recruiting_representatives':
      return execute(schemas.listRecruitingRepresentativesSchema, input, operations.executeListRecruitingRepresentatives, signal)
    default:
      return Response.json({ success: false, error: 'Unsupported Oracle Fusion Recruiting tool' }, { status: 400 })
  }
}
