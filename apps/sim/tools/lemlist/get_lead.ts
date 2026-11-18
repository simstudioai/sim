import type { LemlistGetLeadParams, LemlistGetLeadResponse } from '@/tools/lemlist/types'
import { LEMLIST_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

interface LemlistV2Lead {
  _id?: string
  isPaused?: boolean
  contactId?: string
  variables?: Record<string, string | undefined>
  campaign?: { id?: string }
  enrichment?: { emailStatus?: string }
}

/**
 * Lookup by email (`GET /leads/{email}`) answers with an array of v2 leads, one per campaign, whose
 * profile fields sit under `variables`. Maps the first onto the flat shape the ID lookup returns.
 */
function flattenV2Lead(lead: LemlistV2Lead | undefined): Record<string, unknown> {
  if (!lead) throw new Error('Lead not found')
  const variables = lead.variables ?? {}
  return {
    _id: lead._id,
    email: variables.email,
    firstName: variables.firstName,
    lastName: variables.lastName,
    companyName: variables.companyName,
    jobTitle: variables.jobTitle,
    companyDomain: variables.companyDomain,
    isPaused: lead.isPaused,
    campaignId: lead.campaign?.id,
    contactId: lead.contactId,
    emailStatus: lead.enrichment?.emailStatus,
  }
}

export const getLeadTool: ToolConfig<LemlistGetLeadParams, LemlistGetLeadResponse> = {
  id: 'lemlist_get_lead',
  name: 'Lemlist Get Lead',
  description: 'Retrieves lead information by email address or lead ID.',
  version: '1.0.0',
  oauth: LEMLIST_CREDENTIAL_OAUTH,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Lemlist API key',
    },
    leadIdentifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Lead email address (e.g., "john@example.com") or lead ID (e.g., "lea_abc123def456")',
    },
  },

  request: {
    url: (params) => {
      const identifier = params.leadIdentifier || ''
      const isEmail = identifier.includes('@')
      if (isEmail) {
        return `https://api.lemlist.com/api/leads/${encodeURIComponent(identifier)}`
      }
      return `https://api.lemlist.com/api/leads?id=${encodeURIComponent(identifier)}`
    },
    method: 'GET',
    headers: (params) => {
      const credentials = Buffer.from(`:${params.apiKey}`).toString('base64')
      return {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const body = await response.json()
    const data = Array.isArray(body) ? flattenV2Lead(body[0]) : body

    return {
      success: true,
      output: {
        _id: data._id ?? '',
        email: data.email ?? '',
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        companyName: data.companyName ?? null,
        jobTitle: data.jobTitle ?? null,
        companyDomain: data.companyDomain ?? null,
        isPaused: data.isPaused ?? false,
        campaignId: data.campaignId ?? null,
        contactId: data.contactId ?? null,
        emailStatus: data.emailStatus ?? null,
      },
    }
  },

  outputs: {
    _id: {
      type: 'string',
      description: 'Lead ID',
    },
    email: {
      type: 'string',
      description: 'Lead email address',
    },
    firstName: {
      type: 'string',
      description: 'Lead first name',
      optional: true,
    },
    lastName: {
      type: 'string',
      description: 'Lead last name',
      optional: true,
    },
    companyName: {
      type: 'string',
      description: 'Company name',
      optional: true,
    },
    jobTitle: {
      type: 'string',
      description: 'Job title',
      optional: true,
    },
    companyDomain: {
      type: 'string',
      description: 'Company domain',
      optional: true,
    },
    isPaused: {
      type: 'boolean',
      description: 'Whether the lead is paused',
    },
    campaignId: {
      type: 'string',
      description: 'Campaign ID the lead belongs to',
      optional: true,
    },
    contactId: {
      type: 'string',
      description: 'Contact ID',
      optional: true,
    },
    emailStatus: {
      type: 'string',
      description: 'Email deliverability status',
      optional: true,
    },
  },
}
