import { sleep } from '@sim/utils/helpers'
import { enrowHosting } from '@/tools/enrow/hosting'
import type {
  EnrowVerifyEmailParams,
  EnrowVerifyEmailResponse,
  EnrowVerifyEmailResult,
} from '@/tools/enrow/types'
import {
  ENROW_EMAIL_OUTPUT,
  ENROW_ID_OUTPUT,
  ENROW_QUALIFICATION_OUTPUT,
} from '@/tools/enrow/types'
import type { ToolConfig } from '@/tools/types'

const POLL_INTERVAL_MS = 3000
const MAX_POLL_TIME_MS = 120_000

/** Map a raw Enrow verify-email result payload to the typed output shape. */
function mapVerifyResult(data: Record<string, unknown>, jobId: string): EnrowVerifyEmailResult {
  return {
    id: jobId,
    email: (data.email as string) ?? null,
    qualification: (data.qualification as string) ?? null,
  }
}

/**
 * Enrow — Verify Email (single, async).
 *
 * Submits a verification via `POST https://api.enrow.io/email/verify/single`,
 * receives a job `id`, then polls
 * `GET https://api.enrow.io/email/verify/single?id=<id>` until HTTP 200
 * (complete) or the polling window expires. HTTP 202 means still in progress.
 *
 * Pricing: 0.25 credits per verification (charged per call).
 * Docs: https://enrow.readme.io/reference/verify-single-email
 */
export const enrowVerifyEmailTool: ToolConfig<EnrowVerifyEmailParams, EnrowVerifyEmailResponse> = {
  id: 'enrow_verify_email',
  name: 'Enrow Verify Email',
  description:
    'Verify the deliverability of an email address using the Enrow async verifier. Submits a verification request and polls until the result is ready. Costs 0.25 credits per verification. (https://enrow.readme.io/reference/verify-single-email)',
  version: '1.0.0',

  hosting: enrowHosting<EnrowVerifyEmailParams>((_params, output) => {
    // 0.25 credits per completed verification. Bill only when the job resolved
    // to a qualification — a fall-back to the initial submit response (poll never
    // finished) has no qualification and must not be charged.
    return output.qualification ? 0.25 : 0
  }),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrow API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to verify (e.g. "john@example.com")',
    },
  },

  request: {
    url: 'https://api.enrow.io/email/verify/single',
    method: 'POST',
    headers: (params: EnrowVerifyEmailParams) => ({
      'x-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params: EnrowVerifyEmailParams) => ({
      email: params.email,
    }),
  },

  transformResponse: async (response: Response): Promise<EnrowVerifyEmailResponse> => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Enrow API error: ${response.status} - ${errorText}`)
    }
    const json = await response.json()
    const id = (json.id as string) ?? null
    if (!id) {
      throw new Error('Enrow verify-email did not return a job id')
    }
    return {
      success: true,
      output: {
        id,
        email: null,
        qualification: null,
      },
    }
  },

  postProcess: async (
    result: EnrowVerifyEmailResponse,
    params: EnrowVerifyEmailParams
  ): Promise<EnrowVerifyEmailResponse> => {
    if (!result.success) return result

    const jobId = result.output.id
    if (!jobId) {
      throw new Error('Enrow verify-email did not return a job id to poll')
    }

    let elapsed = 0
    while (elapsed < MAX_POLL_TIME_MS) {
      await sleep(POLL_INTERVAL_MS)
      elapsed += POLL_INTERVAL_MS

      const pollResponse = await fetch(
        `https://api.enrow.io/email/verify/single?id=${encodeURIComponent(jobId)}`,
        {
          headers: {
            'x-api-key': params.apiKey,
          },
        }
      )

      if (pollResponse.status === 202) {
        // Still in progress — keep polling
        continue
      }

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text()
        throw new Error(`Enrow verify-email poll error: ${pollResponse.status} - ${errorText}`)
      }

      // HTTP 200 → complete
      const json = await pollResponse.json()
      const data = (json as Record<string, unknown>) ?? {}
      return {
        success: true,
        output: mapVerifyResult(data, jobId),
      }
    }

    throw new Error('Enrow verify-email did not complete within the polling window')
  },

  outputs: {
    id: ENROW_ID_OUTPUT,
    email: ENROW_EMAIL_OUTPUT,
    qualification: ENROW_QUALIFICATION_OUTPUT,
  },
}
