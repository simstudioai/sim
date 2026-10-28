import {
  CANDIDATE_PROPERTIES,
  type CheckrCandidateResponse,
  type CheckrDeleteCandidatePiiParams,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapCandidate,
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrDeleteCandidatePiiTool: ToolConfig<
  CheckrDeleteCandidatePiiParams,
  CheckrCandidateResponse
> = {
  id: 'checkr_delete_candidate_pii',
  name: 'Checkr Delete Candidate PII',
  description:
    "Request removal of a candidate's personally identifiable information. Fails if PII was already removed.",
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the candidate whose PII should be removed',
    },
    deletionContactEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the person requesting the PII removal',
    },
    deletionContactFirstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the person requesting the PII removal',
    },
    deletionContactLastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the person requesting the PII removal',
    },
  },

  request: {
    url: (params) => checkrUrl(`/candidates/${checkrId(params.candidateId, 'candidateId')}/pii`),
    method: 'DELETE',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        deletion_contact_email_address: trimmed(params.deletionContactEmail),
      }
      const firstName = trimmed(params.deletionContactFirstName)
      if (firstName) body.deletion_contact_first_name = firstName
      const lastName = trimmed(params.deletionContactLastName)
      if (lastName) body.deletion_contact_last_name = lastName
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { candidate: mapCandidate(data) } }
  },

  outputs: {
    candidate: {
      type: 'object',
      description: 'The candidate after the PII removal request',
      properties: CANDIDATE_PROPERTIES,
    },
  },
}
