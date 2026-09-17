import type { CodaGetMutationStatusParams, CodaGetMutationStatusResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  codaPath,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetMutationStatusTool: ToolConfig<
  CodaGetMutationStatusParams,
  CodaGetMutationStatusResponse
> = {
  id: 'coda_get_mutation_status',
  name: 'Coda Get Mutation Status',
  description:
    'Check whether a queued Coda change (row, page, publish, or automation request) has been applied. Status is kept for about a day.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Request ID returned by a Coda write operation',
    },
  },

  request: {
    url: (params) => buildCodaUrl(codaPath('mutationStatus', [params.requestId, 'requestId'])),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { completed: boolean; warning?: string }
    return { success: true, output: { completed: data.completed, warning: data.warning ?? null } }
  },

  outputs: {
    completed: { type: 'boolean', description: 'Whether the change has been applied' },
    warning: {
      type: 'string',
      description: 'Warning if the change completed with caveats',
      nullable: true,
    },
  },
}
