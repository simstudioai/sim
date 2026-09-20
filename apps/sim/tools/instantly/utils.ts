import { toBooleanOrNull, toStringOrNull } from '@sim/utils/coerce'
import { filterUndefined, toRecord, toRecordOrNull } from '@sim/utils/object'
import type {
  InstantlyCampaign,
  InstantlyEmail,
  InstantlyLead,
  InstantlyLeadList,
} from '@/tools/instantly/types'
import type { ToolConfig } from '@/tools/types'

const INSTANTLY_API_BASE_URL = 'https://api.instantly.ai'

type InstantlyBaseParams = { apiKey: string }
type JsonRecord = Record<string, unknown>

export const instantlyBaseParamFields = {
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Instantly API key with the required V2 scopes',
  },
} satisfies ToolConfig<InstantlyBaseParams>['params']

export const instantlyHeaders = (params: InstantlyBaseParams) => ({
  Authorization: `Bearer ${params.apiKey.trim()}`,
  'Content-Type': 'application/json',
})

export function instantlyUrl(path: string, query?: Record<string, unknown>): string {
  const url = new URL(path, INSTANTLY_API_BASE_URL)

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.append(key, String(value))
    }
  }

  return url.toString()
}

export function compactBody(values: Record<string, unknown>): Record<string, unknown> {
  return filterUndefined(values)
}

export async function parseInstantlyResponse(response: Response): Promise<unknown> {
  const data = await parseJsonResponse(response)

  if (!response.ok) {
    throw new Error(
      extractInstantlyError(data, `Instantly API request failed (${response.status})`)
    )
  }

  return data
}

export function getItems(value: unknown): JsonRecord[] {
  const data = toRecord(value)
  return Array.isArray(data.items) ? data.items.map(toRecord) : []
}

export function getNextStartingAfter(value: unknown): string | null {
  const data = toRecord(value)
  return toStringOrNull(data.next_starting_after)
}

export function mapLead(value: unknown): InstantlyLead {
  const lead = toRecord(value)

  return {
    id: toStringOrNull(lead.id),
    timestamp_created: toStringOrNull(lead.timestamp_created),
    timestamp_updated: toStringOrNull(lead.timestamp_updated),
    organization: toStringOrNull(lead.organization),
    campaign: toStringOrNull(lead.campaign),
    status: asNumber(lead.status),
    email: toStringOrNull(lead.email),
    personalization: toStringOrNull(lead.personalization),
    website: toStringOrNull(lead.website),
    last_name: toStringOrNull(lead.last_name),
    first_name: toStringOrNull(lead.first_name),
    company_name: toStringOrNull(lead.company_name),
    job_title: toStringOrNull(lead.job_title),
    phone: toStringOrNull(lead.phone),
    email_open_count: asNumber(lead.email_open_count),
    email_reply_count: asNumber(lead.email_reply_count),
    email_click_count: asNumber(lead.email_click_count),
    company_domain: toStringOrNull(lead.company_domain),
    payload: toRecordOrNull(lead.payload),
    lt_interest_status: asNumber(lead.lt_interest_status),
  }
}

export function mapCampaign(value: unknown): InstantlyCampaign {
  const campaign = toRecord(value)

  return {
    id: toStringOrNull(campaign.id),
    name: toStringOrNull(campaign.name),
    pl_value: asNumber(campaign.pl_value),
    status: asNumber(campaign.status),
    is_evergreen: toBooleanOrNull(campaign.is_evergreen),
    timestamp_created: toStringOrNull(campaign.timestamp_created),
    timestamp_updated: toStringOrNull(campaign.timestamp_updated),
    email_gap: asNumber(campaign.email_gap),
    daily_limit: asNumber(campaign.daily_limit),
    daily_max_leads: asNumber(campaign.daily_max_leads),
    open_tracking: toBooleanOrNull(campaign.open_tracking),
    stop_on_reply: toBooleanOrNull(campaign.stop_on_reply),
    sequences: Array.isArray(campaign.sequences) ? campaign.sequences : [],
    campaign_schedule: toRecordOrNull(campaign.campaign_schedule),
  }
}

export function mapEmail(value: unknown): InstantlyEmail {
  const email = toRecord(value)
  const body = toRecord(email.body)

  return {
    id: toStringOrNull(email.id),
    timestamp_created: toStringOrNull(email.timestamp_created),
    timestamp_email: toStringOrNull(email.timestamp_email),
    message_id: toStringOrNull(email.message_id),
    subject: toStringOrNull(email.subject),
    from_address_email: toStringOrNull(email.from_address_email),
    to_address_email_list: toStringOrNull(email.to_address_email_list),
    cc_address_email_list: toStringOrNull(email.cc_address_email_list),
    bcc_address_email_list: toStringOrNull(email.bcc_address_email_list),
    reply_to: toStringOrNull(email.reply_to),
    body: {
      text: toStringOrNull(body.text),
      html: toStringOrNull(body.html),
    },
    organization_id: toStringOrNull(email.organization_id),
    campaign_id: toStringOrNull(email.campaign_id),
    subsequence_id: toStringOrNull(email.subsequence_id),
    list_id: toStringOrNull(email.list_id),
    lead: toStringOrNull(email.lead),
    lead_id: toStringOrNull(email.lead_id),
    eaccount: toStringOrNull(email.eaccount),
    ue_type: asNumber(email.ue_type),
    is_unread: asNumber(email.is_unread),
    is_auto_reply: asNumber(email.is_auto_reply),
    i_status: asNumber(email.i_status),
    thread_id: toStringOrNull(email.thread_id),
    content_preview: toStringOrNull(email.content_preview),
  }
}

export function mapLeadList(value: unknown): InstantlyLeadList {
  const leadList = toRecord(value)

  return {
    id: toStringOrNull(leadList.id),
    organization_id: toStringOrNull(leadList.organization_id),
    has_enrichment_task: toBooleanOrNull(leadList.has_enrichment_task),
    owned_by: toStringOrNull(leadList.owned_by),
    name: toStringOrNull(leadList.name),
    timestamp_created: toStringOrNull(leadList.timestamp_created),
  }
}

export const leadOutputs = {
  lead: {
    type: 'object',
    description: 'Lead details',
    properties: {
      id: { type: 'string', description: 'Lead ID', nullable: true },
      email: { type: 'string', description: 'Lead email address', nullable: true },
      first_name: { type: 'string', description: 'Lead first name', nullable: true },
      last_name: { type: 'string', description: 'Lead last name', nullable: true },
      company_name: { type: 'string', description: 'Lead company name', nullable: true },
      job_title: { type: 'string', description: 'Lead job title', nullable: true },
      campaign: { type: 'string', description: 'Campaign ID', nullable: true },
      status: { type: 'number', description: 'Lead status', nullable: true },
      payload: { type: 'json', description: 'Lead custom variables', nullable: true },
    },
  },
  id: { type: 'string', description: 'Lead ID', optional: true },
  email_address: { type: 'string', description: 'Lead email address', optional: true },
  first_name: { type: 'string', description: 'Lead first name', optional: true },
  last_name: { type: 'string', description: 'Lead last name', optional: true },
  campaign: { type: 'string', description: 'Campaign ID', optional: true },
  status: { type: 'number', description: 'Lead status', optional: true },
} satisfies ToolConfig['outputs']

export const leadsListOutputs = {
  leads: {
    type: 'array',
    description: 'List of leads',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Lead ID', nullable: true },
        email: { type: 'string', description: 'Lead email address', nullable: true },
        first_name: { type: 'string', description: 'Lead first name', nullable: true },
        last_name: { type: 'string', description: 'Lead last name', nullable: true },
        company_name: { type: 'string', description: 'Lead company name', nullable: true },
        campaign: { type: 'string', description: 'Campaign ID', nullable: true },
        status: { type: 'number', description: 'Lead status', nullable: true },
      },
    },
  },
  count: { type: 'number', description: 'Number of leads returned' },
  next_starting_after: { type: 'string', description: 'Cursor for the next page', optional: true },
} satisfies ToolConfig['outputs']

export const campaignOutputs = {
  campaign: {
    type: 'object',
    description: 'Campaign details',
    properties: {
      id: { type: 'string', description: 'Campaign ID', nullable: true },
      name: { type: 'string', description: 'Campaign name', nullable: true },
      status: { type: 'number', description: 'Campaign status', nullable: true },
      daily_limit: { type: 'number', description: 'Daily sending limit', nullable: true },
      daily_max_leads: { type: 'number', description: 'Daily max new leads', nullable: true },
      open_tracking: {
        type: 'boolean',
        description: 'Whether open tracking is enabled',
        nullable: true,
      },
    },
  },
  id: { type: 'string', description: 'Campaign ID', optional: true },
  name: { type: 'string', description: 'Campaign name', optional: true },
  status: { type: 'number', description: 'Campaign status', optional: true },
} satisfies ToolConfig['outputs']

export const campaignActionOutputs = {
  ...campaignOutputs,
  message: { type: 'string', description: 'Confirmation message from Instantly', optional: true },
} satisfies ToolConfig['outputs']

export const campaignsListOutputs = {
  campaigns: {
    type: 'array',
    description: 'List of campaigns',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Campaign ID', nullable: true },
        name: { type: 'string', description: 'Campaign name', nullable: true },
        status: { type: 'number', description: 'Campaign status', nullable: true },
        daily_limit: { type: 'number', description: 'Daily sending limit', nullable: true },
      },
    },
  },
  count: { type: 'number', description: 'Number of campaigns returned' },
  next_starting_after: { type: 'string', description: 'Cursor for the next page', optional: true },
} satisfies ToolConfig['outputs']

export const emailOutputs = {
  email: {
    type: 'object',
    description: 'Email details',
    properties: {
      id: { type: 'string', description: 'Email ID', nullable: true },
      subject: { type: 'string', description: 'Email subject', nullable: true },
      from_address_email: { type: 'string', description: 'Sender email', nullable: true },
      to_address_email_list: {
        type: 'string',
        description: 'Recipient email list',
        nullable: true,
      },
      thread_id: { type: 'string', description: 'Thread ID', nullable: true },
      content_preview: { type: 'string', description: 'Email content preview', nullable: true },
    },
  },
  id: { type: 'string', description: 'Email ID', optional: true },
  subject: { type: 'string', description: 'Email subject', optional: true },
  thread_id: { type: 'string', description: 'Thread ID', optional: true },
} satisfies ToolConfig['outputs']

export const emailsListOutputs = {
  emails: {
    type: 'array',
    description: 'List of emails',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Email ID', nullable: true },
        subject: { type: 'string', description: 'Email subject', nullable: true },
        from_address_email: { type: 'string', description: 'Sender email', nullable: true },
        lead: { type: 'string', description: 'Lead email', nullable: true },
        thread_id: { type: 'string', description: 'Thread ID', nullable: true },
      },
    },
  },
  count: { type: 'number', description: 'Number of emails returned' },
  next_starting_after: { type: 'string', description: 'Cursor for the next page', optional: true },
} satisfies ToolConfig['outputs']

export const leadListOutputs = {
  lead_list: {
    type: 'object',
    description: 'Lead list details',
    properties: {
      id: { type: 'string', description: 'Lead list ID', nullable: true },
      organization_id: { type: 'string', description: 'Organization ID', nullable: true },
      has_enrichment_task: {
        type: 'boolean',
        description: 'Whether enrichment is enabled',
        nullable: true,
      },
      owned_by: { type: 'string', description: 'Owner user ID', nullable: true },
      name: { type: 'string', description: 'Lead list name', nullable: true },
      timestamp_created: { type: 'string', description: 'Creation timestamp', nullable: true },
    },
  },
  id: { type: 'string', description: 'Lead list ID', optional: true },
  name: { type: 'string', description: 'Lead list name', optional: true },
} satisfies ToolConfig['outputs']

export const leadListsListOutputs = {
  lead_lists: {
    type: 'array',
    description: 'List of lead lists',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Lead list ID', nullable: true },
        name: { type: 'string', description: 'Lead list name', nullable: true },
        has_enrichment_task: {
          type: 'boolean',
          description: 'Whether enrichment is enabled',
          nullable: true,
        },
        timestamp_created: { type: 'string', description: 'Creation timestamp', nullable: true },
      },
    },
  },
  count: { type: 'number', description: 'Number of lead lists returned' },
  next_starting_after: { type: 'string', description: 'Cursor for the next page', optional: true },
} satisfies ToolConfig['outputs']

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function getMessage(value: unknown): string | null {
  const data = toRecord(value)
  return typeof data.message === 'string' ? data.message : null
}

function extractInstantlyError(value: unknown, fallback: string): string {
  const data = toRecord(value)
  if (typeof data.message === 'string') return data.message
  if (typeof data.error === 'string') return data.error
  return fallback
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
