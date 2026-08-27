import { FULLENRICH_CREDIT_WEIGHTS, fullEnrichEstimatedHosting } from '@/tools/fullenrich/hosting'
import {
  fullEnrichAsyncStartResponseSchema,
  fullEnrichNameSchema,
  fullEnrichReverseEmailsSchema,
  fullEnrichWebhookUrlSchema,
} from '@/tools/fullenrich/schemas'
import type {
  FullEnrichAsyncStartResponse,
  FullEnrichStartReverseEmailParams,
} from '@/tools/fullenrich/types'
import { extractFullEnrichError, parseFullEnrichInput } from '@/tools/fullenrich/utils'
import type { ToolConfig } from '@/tools/types'

const ESTIMATE_BASIS =
  'Conservative upper bound assuming every email produces a result at 1 credit per reverse email lookup; https://fullenrich.com/pricing.md; verified 2026-08-26'

function estimateCredits(params: FullEnrichStartReverseEmailParams): number {
  const emails = parseFullEnrichInput(params.data, fullEnrichReverseEmailsSchema, 'Emails')
  return emails.length * FULLENRICH_CREDIT_WEIGHTS.reverseEmail
}

export const startReverseEmailTool: ToolConfig<
  FullEnrichStartReverseEmailParams,
  FullEnrichAsyncStartResponse
> = {
  id: 'fullenrich_start_reverse_email',
  name: 'FullEnrich Start Reverse Email',
  description: 'Start an asynchronous reverse lookup of up to 100 email addresses.',
  version: '1.0.0',
  hosting: fullEnrichEstimatedHosting(estimateCredits, ESTIMATE_BASIS),
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'FullEnrich API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Readable reverse-lookup name shown in the FullEnrich dashboard',
    },
    data: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of 1-100 objects containing email and optional string-valued custom fields',
    },
    webhookUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTPS endpoint notified when the entire lookup finishes',
    },
    contactFinishedWebhookUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTPS endpoint notified when each email finishes',
    },
  },
  request: {
    url: 'https://app.fullenrich.com/api/v2/contact/reverse/email/bulk',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: fullEnrichNameSchema.parse(params.name),
        data: parseFullEnrichInput(params.data, fullEnrichReverseEmailsSchema, 'Emails'),
      }
      if (params.webhookUrl !== undefined) {
        body.webhook_url = fullEnrichWebhookUrlSchema.parse(params.webhookUrl)
      }
      if (params.contactFinishedWebhookUrl !== undefined) {
        body.webhook_events = {
          contact_finished: fullEnrichWebhookUrlSchema.parse(params.contactFinishedWebhookUrl),
        }
      }
      return body
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await extractFullEnrichError(response))
    const data = fullEnrichAsyncStartResponseSchema.parse(await response.json())
    return { success: true, output: { enrichmentId: data.enrichment_id } }
  },
  outputs: {
    enrichmentId: {
      type: 'string',
      description: 'ID used to retrieve asynchronous reverse-email results',
    },
  },
}
