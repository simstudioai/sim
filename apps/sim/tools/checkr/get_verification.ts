import {
  type CheckrGetVerificationParams,
  type CheckrVerificationResponse,
  VERIFICATION_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapVerification,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetVerificationTool: ToolConfig<
  CheckrGetVerificationParams,
  CheckrVerificationResponse
> = {
  id: 'checkr_get_verification',
  name: 'Checkr Get Verification',
  description: 'Retrieve a verification by ID.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    verificationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the verification',
    },
  },

  request: {
    url: (params) =>
      checkrUrl(`/verifications/${checkrId(params.verificationId, 'verificationId')}`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { verification: mapVerification(data) } }
  },

  outputs: {
    verification: {
      type: 'object',
      description: 'The verification',
      properties: VERIFICATION_PROPERTIES,
    },
  },
}
