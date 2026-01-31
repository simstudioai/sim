import type { LemlistGetLeadParams, LemlistGetLeadResponse } from '@/tools/lemlist/types'
import type { ToolConfig } from '@/tools/types'

export const getLeadTool: ToolConfig<LemlistGetLeadParams, LemlistGetLeadResponse> = {
  id: 'lemlist_get_lead',
  name: 'Lemlist Get Lead',
  description: 'Retrieves lead information by email address or lead ID.',
  version: '1.0.0',

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
    const data = await response.json()

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
