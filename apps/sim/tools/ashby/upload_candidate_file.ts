import type { AshbyGetCandidateResponse } from '@/tools/ashby/types'
import { CANDIDATE_OUTPUTS } from '@/tools/ashby/utils'
import type { InternalToolConfig } from '@/tools/types'

interface Params {
  apiKey: string
  candidateId: string
  file: unknown
  fileName?: string
  onBehalfOfUserId?: string
}
export const uploadCandidateFileTool: InternalToolConfig<Params, AshbyGetCandidateResponse> = {
  id: 'ashby_upload_candidate_file',
  name: 'Ashby Upload Candidate File',
  description: 'Securely uploads a file and attaches it to an Ashby candidate.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate UUID',
    },
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'Stored file to attach to the candidate',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional filename override',
    },
    onBehalfOfUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Active Ashby user UUID to attribute this mutation to',
    },
  },
  operation: {
    input: (p) => ({
      apiKey: p.apiKey,
      candidateId: p.candidateId,
      file: p.file,
      fileName: p.fileName,
      onBehalfOfUserId: p.onBehalfOfUserId,
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(data.error || 'Failed to upload candidate file')
    return { success: true, output: data.output }
  },
  outputs: CANDIDATE_OUTPUTS,
}
