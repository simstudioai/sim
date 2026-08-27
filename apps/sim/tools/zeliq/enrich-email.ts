import type { ToolConfig } from '@/tools/types'
import { zeliqHosting } from '@/tools/zeliq/hosting'
import type { ZeliqAsyncEnrichmentResponse, ZeliqEnrichEmailParams } from '@/tools/zeliq/types'
import {
  buildZeliqEmailRequestBody,
  buildZeliqHeaders,
  parseZeliqAsyncResponse,
} from '@/tools/zeliq/validation'

/**
 * Queues a work-email enrichment and sends the completed result to callbackUrl.
 *
 * Endpoint and schema: https://docs.zeliq.com/reference/enrich-email
 * Async contract: https://help.zeliq.com/en/articles/14652396-zeliq-enrichment-api
 */
export const zeliqEnrichEmailTool: ToolConfig<
  ZeliqEnrichEmailParams,
  ZeliqAsyncEnrichmentResponse
> = {
  id: 'zeliq_enrich_email',
  name: 'Zeliq Enrich Email',
  description:
    'Queue work-email enrichment from a LinkedIn URL or person and company details. Zeliq posts the completed enrichment to the required callback URL.',
  version: '1.0.0',
  hosting: zeliqHosting<ZeliqEnrichEmailParams>({
    operation: 'email',
    estimatedCredits: 1,
    validateParams: buildZeliqEmailRequestBody,
  }),
  params: {
    linkedinUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL; provide this or person and company details',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name when enriching without a LinkedIn URL',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name when enriching without a LinkedIn URL',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name; provide company or domain with first and last name',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain; provide domain or company with first and last name',
    },
    callbackUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'HTTP or HTTPS URL where Zeliq posts the completed enrichment result',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zeliq API key',
    },
  },
  request: {
    url: 'https://api.zeliq.com/api/contact/enrich/email',
    method: 'POST',
    headers: (params) => buildZeliqHeaders(params.apiKey),
    body: buildZeliqEmailRequestBody,
  },
  transformResponse: parseZeliqAsyncResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP-style acceptance status (202)' },
    message: { type: 'string', description: 'Zeliq job acceptance message' },
    jobId: { type: 'string', description: 'Asynchronous Zeliq enrichment job ID', optional: true },
  },
}
