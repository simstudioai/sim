import { enrowHosting } from '@/tools/enrow/hosting'
import { pollEnrowJob } from '@/tools/enrow/poll'
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

/**
 * Map a raw Enrow find-email result payload to the typed output shape.
 *
 * `email` and `qualification` are top-level on the 200 body; the person and
 * company fields are nested under `info`.
 */
function mapFindResult(data: Record<string, unknown>, jobId: string): EnrowFindEmailResult {
  const info = (data.info as Record<string, unknown> | undefined) ?? {}
  return {
    id: jobId,
    email: (data.email as string) ?? null,
    qualification: (data.qualification as string) ?? null,
    fullname: (info.fullname as string) ?? null,
    firstname: (info.firstname as string) ?? null,
    lastname: (info.lastname as string) ?? null,
    company_name: (info.company_name as string) ?? null,
    company_domain: (info.company_domain as string) ?? null,
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
 * Docs: https://docs.enrow.io/api-reference/email-finder/find-single
 */
export const enrowFindEmailTool: ToolConfig<EnrowFindEmailParams, EnrowFindEmailResponse> = {
  id: 'enrow_find_email',
  name: 'Enrow Find Email',
  description:
    'Find a verified B2B email address from a full name and company domain or name. Uses the Enrow async finder — submits a search and polls until the result is ready. Costs 1 credit per valid email found. (https://docs.enrow.io/api-reference/email-finder/find-single)',
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
        firstname: null,
        lastname: null,
        company_name: null,
        company_domain: null,
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

    const data = await pollEnrowJob(
      `https://api.enrow.io/email/find/single?id=${encodeURIComponent(jobId)}`,
      params.apiKey,
      'find-email'
    )

    return {
      success: true,
      output: mapFindResult(data, jobId),
    }
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
    firstname: {
      type: 'string',
      description: 'First name of the person searched',
      optional: true,
    },
    lastname: {
      type: 'string',
      description: 'Last name of the person searched',
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
  },
}
