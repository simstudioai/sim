import type { ToolConfig } from '@/tools/types'
import { zeliqHosting } from '@/tools/zeliq/hosting'
import type { ZeliqAsyncEnrichmentResponse, ZeliqEnrichPhoneParams } from '@/tools/zeliq/types'
import {
  buildZeliqHeaders,
  buildZeliqPhoneRequestBody,
  parseZeliqAsyncResponse,
} from '@/tools/zeliq/validation'

/**
 * Queues a mobile-phone enrichment and sends the completed result to callbackUrl.
 *
 * Endpoint and example: https://docs.zeliq.com/reference/enrich-phone
 * Async contract: https://help.zeliq.com/en/articles/14652396-zeliq-enrichment-api
 */
export const zeliqEnrichPhoneTool: ToolConfig<
  ZeliqEnrichPhoneParams,
  ZeliqAsyncEnrichmentResponse
> = {
  id: 'zeliq_enrich_phone',
  name: 'Zeliq Enrich Phone',
  description:
    'Queue mobile-phone enrichment from a LinkedIn URL or email address. Zeliq posts the completed enrichment to the required callback URL.',
  version: '1.0.0',
  hosting: zeliqHosting<ZeliqEnrichPhoneParams>({
    operation: 'phone',
    estimatedCredits: 10,
    validateParams: buildZeliqPhoneRequestBody,
  }),
  params: {
    linkedinUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL; provide this or an email address',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address; provide this or a LinkedIn profile URL',
    },
    callbackUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
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
    url: 'https://api.zeliq.com/api/contact/enrich/phone',
    method: 'POST',
    headers: (params) => buildZeliqHeaders(params.apiKey),
    body: buildZeliqPhoneRequestBody,
  },
  transformResponse: parseZeliqAsyncResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP-style acceptance status (202)' },
    message: { type: 'string', description: 'Zeliq job acceptance message' },
    jobId: { type: 'string', description: 'Asynchronous Zeliq enrichment job ID', optional: true },
  },
}
