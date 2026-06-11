import type { SendblueBaseParams } from '@/tools/sendblue/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Base URL for the Sendblue API as documented at https://docs.sendblue.com/api-v2/.
 */
export const SENDBLUE_API_BASE_URL = 'https://api.sendblue.com'

/**
 * Builds the authentication headers required by every Sendblue endpoint.
 * Sendblue authenticates with an API Key ID and API Secret Key sent as
 * the `sb-api-key-id` and `sb-api-secret-key` headers.
 */
export function sendblueHeaders(params: SendblueBaseParams): Record<string, string> {
  return {
    'sb-api-key-id': params.apiKeyId.trim(),
    'sb-api-secret-key': params.apiSecretKey.trim(),
    'Content-Type': 'application/json',
  }
}

/**
 * Shared credential param definitions reused across all Sendblue tools.
 */
export const sendblueBaseParamFields = {
  apiKeyId: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Sendblue API Key ID (sb-api-key-id)',
  },
  apiSecretKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Sendblue API Secret Key (sb-api-secret-key)',
  },
} satisfies ToolConfig['params']
