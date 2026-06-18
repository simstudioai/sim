import { sleep } from '@sim/utils/helpers'
import { enrowHosting } from '@/tools/enrow/hosting'
import type {
  EnrowFindEmailParams,
  EnrowFindEmailResponse,
  EnrowFindEmailResult,
} from '@/tools/enrow/types'
import {
  ENROW_EMAIL_OUTPUT,
  ENROW_ID_OUTPUT,
  ENROW_QUALIFICATION_OUTPUT,
} from '@/tools/enrow/types'
import type { ToolConfig } from '@/tools/types'

const POLL_INTERVAL_MS = 3000
const MAX_POLL_TIME_MS = 120_000

/** Map a raw Enrow find-email result payload to the typed output shape. */
function mapFindResult(data: Record<string, unknown>): EnrowFindEmailResult {
  return {
    id: (data.id as string) ?? '',
    email: (data.email as string) ?? null,
    qualification: (data.qualification as string) ?? null,
    fullname: (data.fullname as string) ?? null,
    company_name: (data.company_name as string) ?? null,
    company_domain: (data.company_domain as string) ?? null,
    linkedin_url: (data.linkedin_url as string) ?? null,
  }
}

/**
 * Enrow — Find Email (single, async).
 *
 * Submits a search via `POST https://api.enrow.io/email/find/single`, receives
 * a job `id`, then polls `GET https://api.enrow.io/email/find/single?id=<id>`
 * until HTTP 200 (complete) or the polling window expires. HTTP 202 means the
 * search is still in progress.
 *
 * Pricing: 1 credit per valid email found (charged only on success).
 * Docs: https://enrow.readme.io/reference/find-single-email
 */
export const enrowFindEmailTool: ToolConfig<EnrowFindEmailParams, EnrowFindEmailResponse> = {
  id: 'enrow_find_email',
  name: 'Enrow Find Email',
  description:
    'Find a verified B2B email address from a full name and company domain or name. Uses the Enrow async finder — submits a search and polls until the result is ready. Costs 1 credit per valid email found. (https://enrow.readme.io/reference/find-single-email)',
  version: '1.0.0',

  hosting: enrowHosting<EnrowFindEmailParams>((_params, output) => {
    // 1 credit charged only when a valid email is returned. Compare
    // case-insensitively so the API's qualifier casing can't zero out billing.
    return String(output.qualification ?? '').toLowerCase() === 'valid' ? 1 : 0
  }),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrow API key',
    },
    fullname: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full name of the person (e.g. "John Doe")',
    },
    company_domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g. "apple.com"). Preferred over company_name.',
    },
    company_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (e.g. "Apple"). Used when domain is unavailable.',
    },
  },

  request: {
    url: 'https://api.enrow.io/email/find/single',
    method: 'POST',
    headers: (params: EnrowFindEmailParams) => ({
      'x-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params: EnrowFindEmailParams) => {
      const body: Record<string, unknown> = { fullname: params.fullname }
      if (params.company_domain) body.company_domain = params.company_domain
      if (params.company_name) body.company_name = params.company_name
      return body
    },
  },

  transformResponse: async (response: Response): Promise<EnrowFindEmailResponse> => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Enrow API error: ${response.status} - ${errorText}`)
    }
    const json = await response.json()
    const id = (json.id as string) ?? null
    if (!id) {
      throw new Error('Enrow find-email did not return a job id')
    }
    return {
      success: true,
      output: {
        id,
        email: null,
        qualification: null,
        fullname: null,
        company_name: null,
        company_domain: null,
        linkedin_url: null,
      },
    }
  },

  postProcess: async (
    result: EnrowFindEmailResponse,
    params: EnrowFindEmailParams
  ): Promise<EnrowFindEmailResponse> => {
    if (!result.success) return result

    const jobId = result.output.id
    if (!jobId) {
      throw new Error('Enrow find-email did not return a job id to poll')
    }

    let elapsed = 0
    while (elapsed < MAX_POLL_TIME_MS) {
      await sleep(POLL_INTERVAL_MS)
      elapsed += POLL_INTERVAL_MS

      const pollResponse = await fetch(
        `https://api.enrow.io/email/find/single?id=${encodeURIComponent(jobId)}`,
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
        throw new Error(`Enrow find-email poll error: ${pollResponse.status} - ${errorText}`)
      }

      // HTTP 200 → complete
      const json = await pollResponse.json()
      const data = (json as Record<string, unknown>) ?? {}
      return {
        success: true,
        output: mapFindResult({ ...data, id: jobId }),
      }
    }

    throw new Error('Enrow find-email did not complete within the polling window')
  },

  outputs: {
    id: ENROW_ID_OUTPUT,
    email: ENROW_EMAIL_OUTPUT,
    qualification: ENROW_QUALIFICATION_OUTPUT,
    fullname: {
      type: 'string',
      description: 'Full name of the person searched',
      optional: true,
    },
    company_name: {
      type: 'string',
      description: 'Company name associated with the result',
      optional: true,
    },
    company_domain: {
      type: 'string',
      description: 'Company domain associated with the result',
      optional: true,
    },
    linkedin_url: {
      type: 'string',
      description: 'LinkedIn profile URL of the person',
      optional: true,
    },
  },
}
