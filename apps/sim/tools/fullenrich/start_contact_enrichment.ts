import { FULLENRICH_CREDIT_WEIGHTS, fullEnrichEstimatedHosting } from '@/tools/fullenrich/hosting'
import {
  fullEnrichAsyncStartResponseSchema,
  fullEnrichContactsSchema,
  fullEnrichNameSchema,
  fullEnrichWebhookUrlSchema,
} from '@/tools/fullenrich/schemas'
import type {
  FullEnrichAsyncStartResponse,
  FullEnrichStartContactEnrichmentParams,
} from '@/tools/fullenrich/types'
import { extractFullEnrichError, parseFullEnrichInput } from '@/tools/fullenrich/utils'
import type { ToolConfig } from '@/tools/types'

const ESTIMATE_BASIS =
  'Conservative upper bound assuming every requested field is found: work email 1 credit, personal email 3 credits, mobile phone 10 credits per contact; https://fullenrich.com/pricing.md; verified 2026-08-26'

function estimateCredits(params: FullEnrichStartContactEnrichmentParams): number {
  const contacts = parseFullEnrichInput(params.data, fullEnrichContactsSchema, 'Contacts')
  return contacts.reduce(
    (total, contact) =>
      total +
      contact.enrich_fields.reduce((contactTotal, field) => {
        if (field === 'contact.work_emails') {
          return contactTotal + FULLENRICH_CREDIT_WEIGHTS.workEmail
        }
        if (field === 'contact.personal_emails') {
          return contactTotal + FULLENRICH_CREDIT_WEIGHTS.personalEmail
        }
        return contactTotal + FULLENRICH_CREDIT_WEIGHTS.mobilePhone
      }, 0),
    0
  )
}

export const startContactEnrichmentTool: ToolConfig<
  FullEnrichStartContactEnrichmentParams,
  FullEnrichAsyncStartResponse
> = {
  id: 'fullenrich_start_contact_enrichment',
  name: 'FullEnrich Start Contact Enrichment',
  description:
    'Start an asynchronous enrichment of up to 100 contacts for work emails, personal emails, and mobile phones.',
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
      description: 'Readable enrichment name shown in the FullEnrich dashboard',
    },
    data: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of 1-100 contacts. Each requires linkedin_url, or first_name + last_name with domain/company_name, plus enrich_fields.',
    },
    webhookUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTPS endpoint notified when the entire enrichment finishes',
    },
    contactFinishedWebhookUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTPS endpoint notified when each contact finishes',
    },
  },
  request: {
    url: 'https://app.fullenrich.com/api/v2/contact/enrich/bulk',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: fullEnrichNameSchema.parse(params.name),
        data: parseFullEnrichInput(params.data, fullEnrichContactsSchema, 'Contacts'),
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
      description: 'ID used to retrieve asynchronous enrichment results',
    },
  },
}
