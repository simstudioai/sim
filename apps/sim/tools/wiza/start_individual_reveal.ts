import type { ToolConfig } from '@/tools/types'
import type {
  WizaStartIndividualRevealParams,
  WizaStartIndividualRevealResponse,
} from '@/tools/wiza/types'

export const wizaStartIndividualRevealTool: ToolConfig<
  WizaStartIndividualRevealParams,
  WizaStartIndividualRevealResponse
> = {
  id: 'wiza_start_individual_reveal',
  name: 'Wiza Start Individual Reveal',
  description:
    'Start an individual reveal to enrich a contact via LinkedIn URL, name+company, or email',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Wiza API key',
    },
    enrichment_level: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Enrichment depth: none, partial, phone, or full',
    },
    profile_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL (e.g., https://linkedin.com/in/johndoe)',
    },
    full_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name (used with company or domain)',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (used with full_name)',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain (used with full_name)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address (use alone or with other identifiers)',
    },
    accept_work: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to accept work emails (email_options)',
    },
    accept_personal: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to accept personal emails (email_options)',
    },
    callback_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional URL to receive a callback with the reveal update',
    },
  },

  request: {
    url: 'https://wiza.co/api/individual_reveals',
    method: 'POST',
    headers: (params: WizaStartIndividualRevealParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: WizaStartIndividualRevealParams) => {
      const individual: Record<string, unknown> = {}
      if (params.profile_url) individual.profile_url = params.profile_url
      if (params.full_name) individual.full_name = params.full_name
      if (params.company) individual.company = params.company
      if (params.domain) individual.domain = params.domain
      if (params.email) individual.email = params.email

      const body: Record<string, unknown> = {
        individual_reveal: individual,
        enrichment_level: params.enrichment_level,
      }

      if (params.accept_work !== undefined || params.accept_personal !== undefined) {
        const emailOptions: Record<string, unknown> = {}
        if (params.accept_work !== undefined) emailOptions.accept_work = params.accept_work
        if (params.accept_personal !== undefined) {
          emailOptions.accept_personal = params.accept_personal
        }
        body.email_options = emailOptions
      }

      if (params.callback_url) body.callback_url = params.callback_url

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Wiza API error: ${response.status} - ${errorText}`)
    }

    const json = await response.json()
    const d = json.data ?? {}

    return {
      success: true,
      output: {
        id: d.id ?? null,
        status: d.status ?? null,
        is_complete: d.is_complete ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Individual reveal ID (use with Get Individual Reveal)' },
    status: {
      type: 'string',
      description: 'Reveal status: queued, resolving, finished, or failed',
    },
    is_complete: { type: 'boolean', description: 'Whether the reveal has completed' },
  },
}
