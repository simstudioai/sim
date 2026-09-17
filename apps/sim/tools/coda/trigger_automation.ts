import type { CodaRequestIdResponse, CodaTriggerAutomationParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  parseJsonInput,
  REQUEST_ID_OUTPUT,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaTriggerAutomationTool: ToolConfig<
  CodaTriggerAutomationParams,
  CodaRequestIdResponse
> = {
  id: 'coda_trigger_automation',
  name: 'Coda Trigger Automation',
  description:
    'Trigger a webhook-invoked automation in a Coda doc, optionally passing a JSON payload the automation can read',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    ruleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the automation rule (e.g., "grid-auto-b3Jmey6jBS")',
    },
    payload: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object passed to the automation',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'hooks', 'automation', [params.ruleId, 'ruleId'])),
    method: 'POST',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const payload = parseJsonInput(params.payload, 'payload')
      if (payload === undefined || payload === null) return {}
      if (typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('payload must be a JSON object')
      }
      return payload as Record<string, unknown>
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string }
    return { success: true, output: { requestId: data.requestId } }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
  },
}
