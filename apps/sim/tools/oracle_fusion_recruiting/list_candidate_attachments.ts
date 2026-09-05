import { credentials, internalExecution, page } from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_CANDIDATE_ATTACHMENTS_OUTPUTS,
  type OracleFusionRecruitingListCandidateAttachmentsParams,
  type OracleFusionRecruitingListCandidateAttachmentsResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListCandidateAttachmentsTool: InternalToolConfig<
  OracleFusionRecruitingListCandidateAttachmentsParams,
  OracleFusionRecruitingListCandidateAttachmentsResponse
> = {
  id: 'oracle_fusion_recruiting_list_candidate_attachments',
  name: 'List Candidate Attachments',
  description: 'List candidate attachments. Returns metadata only; does not download file contents.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    candidateNumber: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Candidate number; use the identifier returned by the matching list tool' },
  },
  outputs: LIST_CANDIDATE_ATTACHMENTS_OUTPUTS,
}
