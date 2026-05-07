import type {
  EmailBisonBaseParams,
  EmailBisonCampaign,
  EmailBisonCampaignTag,
  EmailBisonLead,
  EmailBisonLeadStats,
  EmailBisonReply,
  EmailBisonReplyAddress,
  EmailBisonReplyAttachment,
  EmailBisonTag,
} from '@/tools/emailbison/types'
import type { OutputProperty, ToolConfig } from '@/tools/types'

type QueryValue = string | number | boolean | Array<string | number> | undefined | null

interface EmailBisonEnvelope<T> {
  data?: T
}

export function emailBisonHeaders(params: EmailBisonBaseParams): Record<string, string> {
  return {
    Authorization: `Bearer ${params.apiKey.trim()}`,
    'Content-Type': 'application/json',
  }
}

export const emailBisonBaseParamFields = {
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Email Bison API token',
  },
  apiBaseUrl: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Email Bison instance URL that issued the token',
  },
} satisfies ToolConfig['params']

export function emailBisonUrl(
  path: string,
  query: Record<string, QueryValue>,
  baseUrl: string
): string {
  const url = new URL(path, normalizeEmailBisonBaseUrl(baseUrl))

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return

    if (Array.isArray(value)) {
      value.forEach((item) => {
        url.searchParams.append(key, String(item))
      })
      return
    }

    url.searchParams.set(key, String(value))
  })

  return url.toString()
}

function normalizeEmailBisonBaseUrl(baseUrl: string): string {
  const trimmedBaseUrl = baseUrl.trim()
  if (!trimmedBaseUrl) {
    throw new Error('Email Bison Instance URL is required')
  }

  const rawBaseUrl = /^https?:\/\//i.test(trimmedBaseUrl)
    ? trimmedBaseUrl
    : `https://${trimmedBaseUrl}`
  const parsed = new URL(rawBaseUrl)

  if (parsed.protocol !== 'https:') {
    throw new Error('Email Bison Instance URL must use HTTPS')
  }

  return parsed.origin
}

export function jsonBody(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

export async function emailBisonData<T>(response: Response): Promise<T | null> {
  const payload = (await response.json()) as EmailBisonEnvelope<T>
  return payload.data ?? null
}

export async function emailBisonArrayData(response: Response, label: string): Promise<unknown[]> {
  const data = await emailBisonData<unknown[]>(response)
  if (!Array.isArray(data)) {
    throw new Error(`Email Bison response did not include a valid ${label} array`)
  }
  return data
}

export async function emailBisonRecordData(response: Response, label: string): Promise<unknown> {
  const data = await emailBisonData<unknown>(response)
  if (!isRecord(data)) {
    throw new Error(`Email Bison response did not include a valid ${label} object`)
  }
  return data
}

export function mapLead(value: unknown): EmailBisonLead {
  const record = toRecord(value)
  const stats = toRecord(record.overall_stats)

  return {
    id: toNullableNumber(record.id),
    first_name: toStringOrNull(record.first_name),
    last_name: toStringOrNull(record.last_name),
    email: toStringOrNull(record.email),
    title: toStringOrNull(record.title),
    company: toStringOrNull(record.company),
    notes: toStringOrNull(record.notes),
    status: toStringOrNull(record.status),
    custom_variables: toArray(record.custom_variables).map((item) => {
      const variable = toRecord(item)
      return {
        name: toStringOrNull(variable.name),
        value: toStringOrNull(variable.value),
      }
    }),
    lead_campaign_data: toArray(record.lead_campaign_data),
    overall_stats: mapLeadStats(stats),
    created_at: toStringOrNull(record.created_at),
    updated_at: toStringOrNull(record.updated_at),
  }
}

export function mapCampaign(value: unknown): EmailBisonCampaign {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    uuid: toStringOrNull(record.uuid),
    name: toStringOrNull(record.name),
    type: toStringOrNull(record.type),
    status: toStringOrNull(record.status),
    emails_sent: toNullableNumber(record.emails_sent),
    opened: toNullableNumber(record.opened),
    unique_opens: toNullableNumber(record.unique_opens),
    replied: toNullableNumber(record.replied),
    unique_replies: toNullableNumber(record.unique_replies),
    bounced: toNullableNumber(record.bounced),
    unsubscribed: toNullableNumber(record.unsubscribed),
    interested: toNullableNumber(record.interested),
    total_leads_contacted: toNullableNumber(record.total_leads_contacted),
    total_leads: toNullableNumber(record.total_leads),
    max_emails_per_day: toNullableNumber(record.max_emails_per_day),
    max_new_leads_per_day: toNullableNumber(record.max_new_leads_per_day),
    plain_text: toNullableBoolean(record.plain_text),
    open_tracking: toNullableBoolean(record.open_tracking),
    can_unsubscribe: toNullableBoolean(record.can_unsubscribe),
    unsubscribe_text: toStringOrNull(record.unsubscribe_text),
    ...(record.sequence_prioritization !== undefined && {
      sequence_prioritization: toStringOrNull(record.sequence_prioritization),
    }),
    tags: toArray(record.tags).map(mapCampaignTag),
    created_at: toStringOrNull(record.created_at),
    updated_at: toStringOrNull(record.updated_at),
  }
}

function mapCampaignTag(value: unknown): EmailBisonCampaignTag {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    name: toStringOrNull(record.name),
    default: toNullableBoolean(record.default),
  }
}

export function mapTag(value: unknown): EmailBisonTag {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    name: toStringOrNull(record.name),
    default: toNullableBoolean(record.default),
    created_at: toStringOrNull(record.created_at),
    updated_at: toStringOrNull(record.updated_at),
  }
}

export function mapReply(value: unknown): EmailBisonReply {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    uuid: toStringOrNull(record.uuid),
    folder: toStringOrNull(record.folder),
    subject: toStringOrNull(record.subject),
    read: toNullableBoolean(record.read),
    interested: toNullableBoolean(record.interested),
    automated_reply: toNullableBoolean(record.automated_reply),
    html_body: toStringOrNull(record.html_body),
    text_body: toStringOrNull(record.text_body),
    raw_body: toStringOrNull(record.raw_body),
    headers: toStringOrNull(record.headers),
    date_received: toStringOrNull(record.date_received),
    type: toStringOrNull(record.type),
    tracked_reply: toNullableBoolean(record.tracked_reply),
    scheduled_email_id: toStringNumberOrNull(record.scheduled_email_id),
    campaign_id: toStringNumberOrNull(record.campaign_id),
    lead_id: toNullableNumber(record.lead_id),
    sender_email_id: toNullableNumber(record.sender_email_id),
    raw_message_id: toStringOrNull(record.raw_message_id),
    from_name: toStringOrNull(record.from_name),
    from_email_address: toStringOrNull(record.from_email_address),
    primary_to_email_address: toStringOrNull(record.primary_to_email_address),
    to: toArray(record.to).map(mapReplyAddress),
    cc: toStringOrNull(record.cc),
    bcc: toStringOrNull(record.bcc),
    parent_id: toStringNumberOrNull(record.parent_id),
    attachments: toArray(record.attachments).map(mapReplyAttachment),
    created_at: toStringOrNull(record.created_at),
    updated_at: toStringOrNull(record.updated_at),
  }
}

export function actionOutput(value: unknown): { success: boolean; message: string | null } {
  const record = toRecord(value)

  return {
    success: record.success === true,
    message: toStringOrNull(record.message),
  }
}

export const leadOutputs = {
  id: { type: 'number', description: 'Lead ID' },
  first_name: { type: 'string', description: 'Lead first name' },
  last_name: { type: 'string', description: 'Lead last name' },
  email: { type: 'string', description: 'Lead email address' },
  title: { type: 'string', description: 'Lead title', optional: true },
  company: { type: 'string', description: 'Lead company', optional: true },
  notes: { type: 'string', description: 'Lead notes', optional: true },
  status: { type: 'string', description: 'Lead status', optional: true },
  custom_variables: {
    type: 'array',
    description: 'Lead custom variables',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Custom variable name' },
        value: { type: 'string', description: 'Custom variable value', optional: true },
      },
    },
  },
  lead_campaign_data: {
    type: 'array',
    description: 'Lead campaign data returned by Email Bison',
  },
  overall_stats: {
    type: 'object',
    description: 'Lead engagement stats',
    properties: {
      emails_sent: { type: 'number', description: 'Emails sent' },
      opens: { type: 'number', description: 'Email opens' },
      replies: { type: 'number', description: 'Replies' },
      unique_replies: { type: 'number', description: 'Unique replies' },
      unique_opens: { type: 'number', description: 'Unique opens' },
    },
  },
  created_at: { type: 'string', description: 'Lead creation timestamp', optional: true },
  updated_at: { type: 'string', description: 'Lead update timestamp', optional: true },
} satisfies NonNullable<ToolConfig['outputs']>

const tagProperties = {
  id: { type: 'number', description: 'Tag ID' },
  name: { type: 'string', description: 'Tag name' },
  default: { type: 'boolean', description: 'Whether this is a default tag' },
  created_at: { type: 'string', description: 'Tag creation timestamp', optional: true },
  updated_at: { type: 'string', description: 'Tag update timestamp', optional: true },
} satisfies Record<string, OutputProperty>

const campaignTagProperties = {
  id: { type: 'number', description: 'Tag ID' },
  name: { type: 'string', description: 'Tag name' },
  default: { type: 'boolean', description: 'Whether this is a default tag' },
} satisfies Record<string, OutputProperty>

export const listLeadsOutputs = {
  leads: {
    type: 'array',
    description: 'List of leads',
    items: {
      type: 'object',
      properties: leadOutputs,
    },
  },
  count: { type: 'number', description: 'Number of leads returned' },
} satisfies NonNullable<ToolConfig['outputs']>

export const campaignOutputs = {
  id: { type: 'number', description: 'Campaign ID' },
  uuid: { type: 'string', description: 'Campaign UUID', optional: true },
  name: { type: 'string', description: 'Campaign name' },
  type: { type: 'string', description: 'Campaign type', optional: true },
  status: { type: 'string', description: 'Campaign status', optional: true },
  emails_sent: { type: 'number', description: 'Emails sent' },
  opened: { type: 'number', description: 'Total opens' },
  unique_opens: { type: 'number', description: 'Unique opens' },
  replied: { type: 'number', description: 'Total replies' },
  unique_replies: { type: 'number', description: 'Unique replies' },
  bounced: { type: 'number', description: 'Bounces' },
  unsubscribed: { type: 'number', description: 'Unsubscribes' },
  interested: { type: 'number', description: 'Interested replies' },
  total_leads_contacted: { type: 'number', description: 'Total leads contacted' },
  total_leads: { type: 'number', description: 'Total leads' },
  max_emails_per_day: { type: 'number', description: 'Maximum emails per day', optional: true },
  max_new_leads_per_day: {
    type: 'number',
    description: 'Maximum new leads per day',
    optional: true,
  },
  plain_text: {
    type: 'boolean',
    description: 'Whether campaign emails are plain text',
    optional: true,
  },
  open_tracking: {
    type: 'boolean',
    description: 'Whether open tracking is enabled',
    optional: true,
  },
  can_unsubscribe: {
    type: 'boolean',
    description: 'Whether recipients can unsubscribe',
    optional: true,
  },
  unsubscribe_text: { type: 'string', description: 'Unsubscribe text', optional: true },
  tags: {
    type: 'array',
    description: 'Campaign tags',
    items: { type: 'object', properties: campaignTagProperties },
  },
  created_at: { type: 'string', description: 'Campaign creation timestamp', optional: true },
  updated_at: { type: 'string', description: 'Campaign update timestamp', optional: true },
} satisfies NonNullable<ToolConfig['outputs']>

export const listCampaignsOutputs = {
  campaigns: {
    type: 'array',
    description: 'List of campaigns',
    items: {
      type: 'object',
      properties: campaignOutputs,
    },
  },
  count: { type: 'number', description: 'Number of campaigns returned' },
} satisfies NonNullable<ToolConfig['outputs']>

export const actionOutputs = {
  success: { type: 'boolean', description: 'Whether the action succeeded' },
  message: { type: 'string', description: 'Action message', optional: true },
} satisfies NonNullable<ToolConfig['outputs']>

export const listRepliesOutputs = {
  replies: {
    type: 'array',
    description: 'List of replies',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Reply ID' },
        subject: { type: 'string', description: 'Reply subject', optional: true },
        text_body: { type: 'string', description: 'Reply text body', optional: true },
        from_email_address: { type: 'string', description: 'Sender email', optional: true },
        primary_to_email_address: {
          type: 'string',
          description: 'Primary recipient',
          optional: true,
        },
        date_received: { type: 'string', description: 'Date received', optional: true },
        interested: { type: 'boolean', description: 'Whether the reply is marked interested' },
        read: { type: 'boolean', description: 'Whether the reply is read' },
      },
    },
  },
  count: { type: 'number', description: 'Number of replies returned' },
} satisfies NonNullable<ToolConfig['outputs']>

export const tagOutputs = {
  id: { type: 'number', description: 'Tag ID' },
  name: { type: 'string', description: 'Tag name' },
  default: { type: 'boolean', description: 'Whether this is a default tag' },
  created_at: { type: 'string', description: 'Tag creation timestamp', optional: true },
  updated_at: { type: 'string', description: 'Tag update timestamp', optional: true },
} satisfies NonNullable<ToolConfig['outputs']>

export const listTagsOutputs = {
  tags: {
    type: 'array',
    description: 'List of tags',
    items: {
      type: 'object',
      properties: tagProperties,
    },
  },
  count: { type: 'number', description: 'Number of tags returned' },
} satisfies NonNullable<ToolConfig['outputs']>

function mapLeadStats(record: Record<string, unknown>): EmailBisonLeadStats {
  return {
    emails_sent: toNullableNumber(record.emails_sent),
    opens: toNullableNumber(record.opens),
    replies: toNullableNumber(record.replies),
    unique_replies: toNullableNumber(record.unique_replies),
    unique_opens: toNullableNumber(record.unique_opens),
  }
}

function mapReplyAddress(value: unknown): EmailBisonReplyAddress {
  const record = toRecord(value)

  return {
    name: toStringOrNull(record.name),
    address: toStringOrNull(record.address),
  }
}

function mapReplyAttachment(value: unknown): EmailBisonReplyAttachment {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    uuid: toStringOrNull(record.uuid),
    reply_id: toNullableNumber(record.reply_id),
    file_name: toStringOrNull(record.file_name),
    download_url: toStringOrNull(record.download_url),
    created_at: toStringOrNull(record.created_at),
    updated_at: toStringOrNull(record.updated_at),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return String(value)
}

function toStringNumberOrNull(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null
  return toNumber(value)
}

function toNullableBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return null
  return typeof value === 'boolean' ? value : null
}
