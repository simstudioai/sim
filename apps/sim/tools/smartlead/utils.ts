import { filterUndefined, isRecordLike, toRecord } from '@sim/utils/object'
import type {
  SmartleadBaseParams,
  SmartleadCampaign,
  SmartleadCampaignAnalytics,
  SmartleadCampaignAnalyticsByDate,
  SmartleadCampaignLead,
  SmartleadCampaignLeadStats,
  SmartleadEmailAccount,
  SmartleadLead,
  SmartleadLeadCampaignData,
  SmartleadLeadCategory,
  SmartleadLeadDetail,
  SmartleadLeadImportResult,
  SmartleadLeadList,
  SmartleadSavedSequence,
  SmartleadSavedWebhook,
  SmartleadSchedulerCron,
  SmartleadSequence,
  SmartleadWebhook,
} from '@/tools/smartlead/types'
import type { OutputProperty, ToolConfig } from '@/tools/types'

const SMARTLEAD_API_BASE_URL = 'https://server.smartlead.ai/api/v1'

type QueryValue = string | number | boolean | undefined | null

/** Campaign statuses accepted by `POST /campaigns/{id}/status`. */
export const SMARTLEAD_CAMPAIGN_STATUSES = ['START', 'PAUSED', 'STOPPED'] as const

/**
 * Values accepted by `track_settings`. Smartlead reads these back in a different
 * vocabulary (`DONT_EMAIL_OPEN`, `DONT_LINK_CLICK`) which it will not accept on
 * write, so a read value must never be sent straight back.
 */
export const SMARTLEAD_TRACK_SETTINGS = [
  'DONT_TRACK_EMAIL_OPEN',
  'DONT_TRACK_LINK_CLICK',
  'DONT_TRACK_REPLY_TO_AN_EMAIL',
] as const

export const SMARTLEAD_STOP_LEAD_SETTINGS = [
  'REPLY_TO_AN_EMAIL',
  'CLICK_ON_A_LINK',
  'OPEN_AN_EMAIL',
] as const

export const SMARTLEAD_WEBHOOK_EVENT_TYPES = [
  'EMAIL_SENT',
  'EMAIL_OPEN',
  'EMAIL_LINK_CLICK',
  'EMAIL_REPLY',
  'EMAIL_BOUNCE',
  'LEAD_UNSUBSCRIBED',
  'LEAD_CATEGORY_UPDATED',
] as const

export const SMARTLEAD_EMAIL_STATUSES = [
  'opened',
  'clicked',
  'replied',
  'unsubscribed',
  'bounced',
] as const

export const smartleadBaseParamFields = {
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Smartlead API key',
  },
} satisfies ToolConfig['params']

export const smartleadCampaignIdParamField = {
  campaignId: {
    type: 'number',
    required: true,
    visibility: 'user-or-llm',
    description: 'Smartlead campaign ID',
  },
} satisfies ToolConfig['params']

export const smartleadLeadIdParamField = {
  leadId: {
    type: 'number',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Smartlead lead ID — the nested lead.id from List Campaign Leads, NOT campaign_lead_map_id',
  },
} satisfies ToolConfig['params']

/** Smartlead authenticates with an `api_key` query parameter on every request. */
export function smartleadUrl(
  path: string,
  apiKey: string,
  query: Record<string, QueryValue> = {}
): string {
  const url = new URL(`${SMARTLEAD_API_BASE_URL}${path}`)
  url.searchParams.set('api_key', apiKey.trim())

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    url.searchParams.set(key, String(value))
  })

  return url.toString()
}

export function smartleadHeaders(_params: SmartleadBaseParams): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

export function jsonBody(fields: Record<string, unknown>): Record<string, unknown> {
  return filterUndefined(fields)
}

/** Trims and escapes a path id so an LLM-supplied `"123 "` cannot produce a 404. */
export function pathSegment(value: string | number): string {
  return encodeURIComponent(String(value).trim())
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('Smartlead returned a response that was not valid JSON')
  }
}

export async function smartleadArray(response: Response, label: string): Promise<unknown[]> {
  const payload = await readJson(response)
  if (!Array.isArray(payload)) {
    throw new Error(`Smartlead did not return a valid ${label} array`)
  }
  return payload
}

export async function smartleadRecord(
  response: Response,
  label: string
): Promise<Record<string, unknown>> {
  const payload = await readJson(response)
  if (!isRecordLike(payload)) {
    throw new Error(`Smartlead did not return a valid ${label} object`)
  }
  return payload
}

/**
 * Reads a record for a lookup that must resolve to a real resource.
 *
 * Smartlead answers HTTP 200 with `{}` — or a zero-byte body — when a campaign or
 * lead does not exist, so a missing resource has to be rejected here. Mapping it
 * would otherwise produce an all-null payload reported as a success.
 */
export async function smartleadExistingRecord(
  response: Response,
  label: string,
  identifyingKeys: readonly string[] = ['id']
): Promise<Record<string, unknown>> {
  const payload = await readJson(response)
  if (payload === null) throw new Error(`Smartlead ${label} not found`)
  if (!isRecordLike(payload)) {
    throw new Error(`Smartlead did not return a valid ${label} object`)
  }
  const identified = identifyingKeys.some(
    (key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== ''
  )
  if (!identified) throw new Error(`Smartlead ${label} not found`)
  return payload
}

export function mapCampaign(value: unknown): SmartleadCampaign {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    user_id: toNullableNumber(record.user_id),
    name: toStringOrNull(record.name),
    status: toStringOrNull(record.status),
    created_at: toStringOrNull(record.created_at),
    updated_at: toStringOrNull(record.updated_at),
    track_settings: toStringArray(record.track_settings),
    scheduler_cron_value: mapSchedulerCron(record.scheduler_cron_value),
    min_time_btwn_emails: toNullableNumber(record.min_time_btwn_emails),
    max_leads_per_day: toNullableNumber(record.max_leads_per_day),
    stop_lead_settings: toStringOrNull(record.stop_lead_settings),
    schedule_start_time: toStringOrNull(record.schedule_start_time),
    enable_ai_esp_matching: toNullableBoolean(record.enable_ai_esp_matching),
    send_as_plain_text: toNullableBoolean(record.send_as_plain_text),
    follow_up_percentage: toNullableNumber(record.follow_up_percentage),
    unsubscribe_text: toStringOrNull(record.unsubscribe_text),
    parent_campaign_id: toNullableNumber(record.parent_campaign_id),
    client_id: toNullableNumber(record.client_id),
    tags: toArray(record.tags),
  }
}

function mapSchedulerCron(value: unknown): SmartleadSchedulerCron | null {
  if (!isRecordLike(value)) return null
  const record = value

  return {
    tz: toStringOrNull(record.tz),
    days: toArray(record.days)
      .map(toNullableNumber)
      .filter((day): day is number => day !== null),
    startHour: toStringOrNull(record.startHour),
    endHour: toStringOrNull(record.endHour),
  }
}

/**
 * Smartlead nests the delay under `seq_delay_details.delayInDays` on read but
 * accepts `seq_delay_details.delay_in_days` on write; the mapper flattens it.
 */
export function mapSequence(value: unknown): SmartleadSequence {
  const record = toRecord(value)
  const delay = toRecord(record.seq_delay_details)

  return {
    id: toNullableNumber(record.id),
    created_at: toStringOrNull(record.created_at),
    updated_at: toStringOrNull(record.updated_at),
    email_campaign_id: toNullableNumber(record.email_campaign_id),
    seq_number: toNullableNumber(record.seq_number),
    delay_in_days: toNullableNumber(delay.delayInDays ?? delay.delay_in_days),
    subject: toStringOrNull(record.subject),
    email_body: toStringOrNull(record.email_body),
    sequence_variants: toArray(record.sequence_variants),
  }
}

export function mapSavedSequence(value: unknown): SmartleadSavedSequence {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    seq_number: toNullableNumber(record.seqNumber ?? record.seq_number),
  }
}

export function mapLead(value: unknown): SmartleadLead {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    first_name: toStringOrNull(record.first_name),
    last_name: toStringOrNull(record.last_name),
    email: toStringOrNull(record.email),
    phone_number: toStringOrNull(record.phone_number),
    company_name: toStringOrNull(record.company_name),
    website: toStringOrNull(record.website),
    location: toStringOrNull(record.location),
    linkedin_profile: toStringOrNull(record.linkedin_profile),
    company_url: toStringOrNull(record.company_url),
    custom_fields: toRecord(record.custom_fields),
    is_unsubscribed: toNullableBoolean(record.is_unsubscribed),
  }
}

export function mapCampaignLead(value: unknown): SmartleadCampaignLead {
  const record = toRecord(value)

  return {
    campaign_lead_map_id: toNullableNumber(record.campaign_lead_map_id),
    lead_category_id: toNullableNumber(record.lead_category_id),
    status: toStringOrNull(record.status),
    created_at: toStringOrNull(record.created_at),
    lead: mapLead(record.lead),
  }
}

export function mapLeadDetail(value: unknown): SmartleadLeadDetail {
  const record = toRecord(value)

  return {
    ...mapLead(record),
    created_at: toStringOrNull(record.created_at),
    lead_campaign_data: toArray(record.lead_campaign_data).map(mapLeadCampaignData),
  }
}

function mapLeadCampaignData(value: unknown): SmartleadLeadCampaignData {
  const record = toRecord(value)

  return {
    campaign_id: toNullableNumber(record.campaign_id),
    campaign_name: toStringOrNull(record.campaign_name),
    campaign_lead_map_id: toNullableNumber(record.campaign_lead_map_id),
    lead_category_id: toNullableNumber(record.lead_category_id),
    last_sent_at: toStringOrNull(record.last_sent_at),
    last_reply_at: toStringOrNull(record.last_reply_at),
    last_activity_at: toStringOrNull(record.last_activity_at),
    client_id: toNullableNumber(record.client_id),
    client_email: toStringOrNull(record.client_email),
  }
}

export function mapLeadCategory(value: unknown): SmartleadLeadCategory {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    name: toStringOrNull(record.name),
    sentiment_type: toStringOrNull(record.sentiment_type),
    created_at: toStringOrNull(record.created_at),
  }
}

export function mapCampaignAnalytics(value: unknown): SmartleadCampaignAnalytics {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    user_id: toNullableNumber(record.user_id),
    name: toStringOrNull(record.name),
    status: toStringOrNull(record.status),
    created_at: toStringOrNull(record.created_at),
    sent_count: toNullableNumber(record.sent_count),
    unique_sent_count: toNullableNumber(record.unique_sent_count),
    open_count: toNullableNumber(record.open_count),
    unique_open_count: toNullableNumber(record.unique_open_count),
    click_count: toNullableNumber(record.click_count),
    unique_click_count: toNullableNumber(record.unique_click_count),
    reply_count: toNullableNumber(record.reply_count),
    bounce_count: toNullableNumber(record.bounce_count),
    block_count: toNullableNumber(record.block_count),
    unsubscribed_count: toNullableNumber(record.unsubscribed_count),
    total_count: toNullableNumber(record.total_count),
    drafted_count: toNullableNumber(record.drafted_count),
    sequence_count: toNullableNumber(record.sequence_count),
    campaign_lead_stats: mapCampaignLeadStats(record.campaign_lead_stats),
    client_id: toNullableNumber(record.client_id),
    client_name: toStringOrNull(record.client_name),
    client_email: toStringOrNull(record.client_email),
    client_company_name: toStringOrNull(record.client_company_name),
    parent_campaign_id: toNullableNumber(record.parent_campaign_id),
    send_as_plain_text: toNullableBoolean(record.send_as_plain_text),
  }
}

function mapCampaignLeadStats(value: unknown): SmartleadCampaignLeadStats {
  const record = toRecord(value)

  return {
    total: toNullableNumber(record.total),
    notStarted: toNullableNumber(record.notStarted),
    inprogress: toNullableNumber(record.inprogress),
    completed: toNullableNumber(record.completed),
    paused: toNullableNumber(record.paused),
    stopped: toNullableNumber(record.stopped),
    blocked: toNullableNumber(record.blocked),
    interested: toNullableNumber(record.interested),
    revenue: toNullableNumber(record.revenue),
  }
}

export function mapCampaignAnalyticsByDate(value: unknown): SmartleadCampaignAnalyticsByDate {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    user_id: toNullableNumber(record.user_id),
    name: toStringOrNull(record.name),
    status: toStringOrNull(record.status),
    created_at: toStringOrNull(record.created_at),
    start_date: toStringOrNull(record.start_date),
    end_date: toStringOrNull(record.end_date),
    sent_count: toNullableNumber(record.sent_count),
    unique_sent_count: toNullableNumber(record.unique_sent_count),
    open_count: toNullableNumber(record.open_count),
    unique_open_count: toNullableNumber(record.unique_open_count),
    click_count: toNullableNumber(record.click_count),
    unique_click_count: toNullableNumber(record.unique_click_count),
    reply_count: toNullableNumber(record.reply_count),
    bounce_count: toNullableNumber(record.bounce_count),
    block_count: toNullableNumber(record.block_count),
    unsubscribed_count: toNullableNumber(record.unsubscribed_count),
    total_count: toNullableNumber(record.total_count),
    drafted_count: toNullableNumber(record.drafted_count),
  }
}

export function mapLeadImportResult(value: unknown): SmartleadLeadImportResult {
  const record = toRecord(value)

  return {
    upload_count: toNullableNumber(record.upload_count),
    total_leads: toNullableNumber(record.total_leads),
    already_added_to_campaign: toNullableNumber(record.already_added_to_campaign),
    duplicate_count: toNullableNumber(record.duplicate_count),
    invalid_email_count: toNullableNumber(record.invalid_email_count),
    block_count: toNullableNumber(record.block_count),
    bounce_count: toNullableNumber(record.bounce_count),
    lead_import_stopped_count: toNullableNumber(record.lead_import_stopped_count),
    is_lead_limit_exhausted: toNullableBoolean(record.is_lead_limit_exhausted),
    invalid_emails: toArray(record.invalid_emails),
    unsubscribed_leads: toArray(record.unsubscribed_leads),
  }
}

export function mapWebhook(value: unknown): SmartleadWebhook {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    name: toStringOrNull(record.name),
    webhook_url: toStringOrNull(record.webhook_url),
    email_campaign_id: toNullableNumber(record.email_campaign_id),
    event_types: toStringArray(record.event_types),
    categories: toStringArray(record.categories),
    created_at: toStringOrNull(record.created_at),
    updated_at: toStringOrNull(record.updated_at),
  }
}

/**
 * The upsert endpoint echoes the selections as `event_type_map` /
 * `category_id_map` objects while the list endpoint returns plain arrays, so the
 * mapper normalizes both to arrays of the enabled keys.
 */
export function mapSavedWebhook(value: unknown): SmartleadSavedWebhook {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    name: toStringOrNull(record.name),
    webhook_url: toStringOrNull(record.webhook_url),
    email_campaign_id: toNullableNumber(record.email_campaign_id),
    event_types: enabledKeys(record.event_type_map),
    categories: enabledKeys(record.category_id_map),
  }
}

function enabledKeys(value: unknown): string[] {
  if (!isRecordLike(value)) return []
  return Object.entries(value)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key)
}

export function isOk(record: Record<string, unknown>): boolean {
  return record.ok === true
}

/**
 * Selects the email-account fields explicitly rather than passing the record
 * through. Smartlead returns the mailbox credentials on these endpoints —
 * `password` in plaintext on the by-id and campaign routes, base64-encoded on the
 * list route, plus `imap_password` — and a passthrough would surface them in
 * workflow output, logs, and model context.
 */
export function mapEmailAccount(value: unknown): SmartleadEmailAccount {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    from_name: toStringOrNull(record.from_name),
    from_email: toStringOrNull(record.from_email),
    username: toStringOrNull(record.username),
    type: toStringOrNull(record.type),
    smtp_host: toStringOrNull(record.smtp_host),
    smtp_port: toNullableNumber(record.smtp_port),
    smtp_port_type: toStringOrNull(record.smtp_port_type),
    imap_host: toStringOrNull(record.imap_host),
    imap_port: toNullableNumber(record.imap_port),
    imap_port_type: toStringOrNull(record.imap_port_type),
    is_smtp_success: toNullableBoolean(record.is_smtp_success),
    is_imap_success: toNullableBoolean(record.is_imap_success),
    smtp_failure_error: toStringOrNull(record.smtp_failure_error),
    imap_failure_error: toStringOrNull(record.imap_failure_error),
    message_per_day: toNullableNumber(record.message_per_day),
    daily_sent_count: toNullableNumber(record.daily_sent_count),
    campaign_count: toNullableNumber(record.campaign_count),
    signature: toStringOrNull(record.signature),
    custom_tracking_domain: toStringOrNull(record.custom_tracking_domain),
    bcc_email: toStringOrNull(record.bcc_email),
    different_reply_to_address: toStringOrNull(record.different_reply_to_address),
    client_id: toNullableNumber(record.client_id),
    is_suspended: toNullableBoolean(record.is_suspended),
    warmup_status: isRecordLike(record.warmup_details)
      ? toStringOrNull(record.warmup_details.status)
      : null,
    tags: toArray(record.tags),
    created_at: toStringOrNull(record.created_at),
    updated_at: toStringOrNull(record.updated_at),
  }
}

export function mapLeadList(value: unknown): SmartleadLeadList {
  const record = toRecord(value)

  return {
    id: toNullableNumber(record.id),
    list_name: toStringOrNull(record.list_name),
    created_at: toStringOrNull(record.created_at),
    updated_at: toStringOrNull(record.updated_at),
    leads_count: toNullableNumber(record.leads_count),
    active_leads_count: toNullableNumber(record.active_leads_count),
  }
}

export function mapTopLevelAnalytics(record: Record<string, unknown>) {
  return {
    id: toNullableNumber(record.id),
    name: toStringOrNull(record.name),
    status: toStringOrNull(record.status),
    start_date: toStringOrNull(record.start_date),
    end_date: toStringOrNull(record.end_date),
    total_count: toNullableNumber(record.total_count),
    sent_count: toNullableNumber(record.sent_count),
    skipped_count: toNullableNumber(record.skipped_count),
    open_count: toNullableNumber(record.open_count),
    click_count: toNullableNumber(record.click_count),
    reply_count: toNullableNumber(record.reply_count),
    positive_reply_count: toNullableNumber(record.positive_reply_count),
    bounce_count: toNullableNumber(record.bounce_count),
    failed_count: toNullableNumber(record.failed_count),
    stopped_count: toNullableNumber(record.stopped_count),
    unsubscribed_count: toNullableNumber(record.unsubscribed_count),
  }
}

/**
 * Several list endpoints only ever returned an empty collection on the account
 * used to verify this integration, so their rows are passed through untouched
 * rather than mapped against field names that were never observed.
 */
export function opaqueRows(value: unknown): unknown[] {
  return toArray(value)
}

export function mapCreatedCampaign(record: Record<string, unknown>): {
  id: number | null
  name: string | null
  created_at: string | null
} {
  return {
    id: toNullableNumber(record.id),
    name: toStringOrNull(record.name),
    created_at: toStringOrNull(record.created_at),
  }
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function toStringArray(value: unknown): string[] {
  return toArray(value)
    .map((item) => (typeof item === 'string' ? item : null))
    .filter((item): item is string => item !== null)
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** Normalizes Smartlead's string-encoded numbers (`"0"`, `"3499513771"`) to numbers. */
export function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toNullableBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return null
  return typeof value === 'boolean' ? value : null
}

const schedulerCronProperties = {
  tz: { type: 'string', description: 'Scheduler timezone', optional: true },
  days: { type: 'array', description: 'Sending days as ISO weekday numbers' },
  startHour: { type: 'string', description: 'Sending window start (HH:MM)', optional: true },
  endHour: { type: 'string', description: 'Sending window end (HH:MM)', optional: true },
} satisfies Record<string, OutputProperty>

export const campaignOutputs = {
  id: { type: 'number', description: 'Campaign ID' },
  user_id: { type: 'number', description: 'Owning Smartlead user ID', optional: true },
  name: { type: 'string', description: 'Campaign name' },
  status: {
    type: 'string',
    description: 'Campaign status (DRAFTED, ACTIVE, PAUSED, STOPPED, COMPLETED)',
  },
  created_at: { type: 'string', description: 'Creation timestamp', optional: true },
  updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
  track_settings: { type: 'array', description: 'Disabled tracking settings' },
  scheduler_cron_value: {
    type: 'object',
    description: 'Sending schedule, or null when no schedule is set',
    optional: true,
    properties: schedulerCronProperties,
  },
  min_time_btwn_emails: {
    type: 'number',
    description: 'Minimum minutes between emails',
    optional: true,
  },
  max_leads_per_day: { type: 'number', description: 'Maximum new leads per day', optional: true },
  stop_lead_settings: {
    type: 'string',
    description: 'Activity that stops a lead sequence',
    optional: true,
  },
  schedule_start_time: { type: 'string', description: 'Scheduled start time', optional: true },
  enable_ai_esp_matching: { type: 'boolean', description: 'Whether AI ESP matching is enabled' },
  send_as_plain_text: { type: 'boolean', description: 'Whether emails send as plain text' },
  follow_up_percentage: { type: 'number', description: 'Follow-up percentage', optional: true },
  unsubscribe_text: { type: 'string', description: 'Unsubscribe text', optional: true },
  parent_campaign_id: { type: 'number', description: 'Parent campaign ID', optional: true },
  client_id: { type: 'number', description: 'Client ID for agency accounts', optional: true },
  tags: { type: 'array', description: 'Campaign tags (only returned when tags are requested)' },
} satisfies NonNullable<ToolConfig['outputs']>

export const listCampaignsOutputs = {
  campaigns: {
    type: 'array',
    description: 'List of campaigns',
    items: { type: 'object', properties: campaignOutputs },
  },
  count: { type: 'number', description: 'Number of campaigns returned' },
} satisfies NonNullable<ToolConfig['outputs']>

export const createCampaignOutputs = {
  id: { type: 'number', description: 'Created campaign ID' },
  name: { type: 'string', description: 'Created campaign name' },
  created_at: { type: 'string', description: 'Creation timestamp', optional: true },
} satisfies NonNullable<ToolConfig['outputs']>

export const actionOutputs = {
  success: { type: 'boolean', description: 'Whether Smartlead confirmed the change' },
} satisfies NonNullable<ToolConfig['outputs']>

const leadProperties = {
  id: { type: 'number', description: 'Lead ID' },
  first_name: { type: 'string', description: 'Lead first name', optional: true },
  last_name: { type: 'string', description: 'Lead last name', optional: true },
  email: { type: 'string', description: 'Lead email address' },
  phone_number: { type: 'string', description: 'Lead phone number', optional: true },
  company_name: { type: 'string', description: 'Lead company name', optional: true },
  website: { type: 'string', description: 'Lead website', optional: true },
  location: { type: 'string', description: 'Lead location', optional: true },
  linkedin_profile: { type: 'string', description: 'Lead LinkedIn profile URL', optional: true },
  company_url: { type: 'string', description: 'Lead company URL', optional: true },
  custom_fields: { type: 'object', description: 'Lead custom fields' },
  is_unsubscribed: { type: 'boolean', description: 'Whether the lead is unsubscribed' },
} satisfies Record<string, OutputProperty>

const leadCampaignDataProperties = {
  campaign_id: { type: 'number', description: 'Campaign ID' },
  campaign_name: { type: 'string', description: 'Campaign name', optional: true },
  campaign_lead_map_id: { type: 'number', description: 'Campaign-lead association ID' },
  lead_category_id: { type: 'number', description: 'Lead category ID', optional: true },
  last_sent_at: { type: 'string', description: 'Last send timestamp', optional: true },
  last_reply_at: { type: 'string', description: 'Last reply timestamp', optional: true },
  last_activity_at: { type: 'string', description: 'Last activity timestamp', optional: true },
  client_id: { type: 'number', description: 'Client ID', optional: true },
  client_email: { type: 'string', description: 'Client email', optional: true },
} satisfies Record<string, OutputProperty>

/**
 * `GET /leads/{id}` omits `lead_campaign_data` entirely, unlike the lookup by
 * email, so that tool declares this narrower shape rather than an always-empty
 * array.
 */
export const leadRecordOutputs = {
  ...leadProperties,
  created_at: { type: 'string', description: 'Lead creation timestamp', optional: true },
} satisfies NonNullable<ToolConfig['outputs']>

export const leadDetailOutputs = {
  ...leadProperties,
  created_at: { type: 'string', description: 'Lead creation timestamp', optional: true },
  lead_campaign_data: {
    type: 'array',
    description: 'Campaigns this lead belongs to',
    items: { type: 'object', properties: leadCampaignDataProperties },
  },
} satisfies NonNullable<ToolConfig['outputs']>

export const listCampaignLeadsOutputs = {
  leads: {
    type: 'array',
    description: 'Leads in the campaign',
    items: {
      type: 'object',
      properties: {
        campaign_lead_map_id: { type: 'number', description: 'Campaign-lead association ID' },
        lead_category_id: { type: 'number', description: 'Lead category ID', optional: true },
        status: { type: 'string', description: 'Lead status in the campaign' },
        created_at: { type: 'string', description: 'When the lead joined the campaign' },
        lead: { type: 'object', description: 'Lead record', properties: leadProperties },
      },
    },
  },
  total_leads: { type: 'number', description: 'Total leads in the campaign' },
  offset: { type: 'number', description: 'Pagination offset used' },
  limit: { type: 'number', description: 'Pagination limit used' },
  count: { type: 'number', description: 'Number of leads returned in this page' },
} satisfies NonNullable<ToolConfig['outputs']>

export const sequenceOutputs = {
  sequences: {
    type: 'array',
    description: 'Campaign email sequence steps',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Sequence step ID' },
        created_at: { type: 'string', description: 'Creation timestamp', optional: true },
        updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
        email_campaign_id: { type: 'number', description: 'Campaign ID' },
        seq_number: { type: 'number', description: 'Step position in the sequence' },
        delay_in_days: {
          type: 'number',
          description: 'Days to wait before sending this step',
          optional: true,
        },
        subject: {
          type: 'string',
          description: 'Email subject (empty string continues the previous thread)',
          optional: true,
        },
        email_body: { type: 'string', description: 'Email body HTML', optional: true },
        sequence_variants: { type: 'array', description: 'A/B variants for this step' },
      },
    },
  },
  count: { type: 'number', description: 'Number of sequence steps returned' },
} satisfies NonNullable<ToolConfig['outputs']>

export const saveSequencesOutputs = {
  success: { type: 'boolean', description: 'Whether Smartlead saved the sequence' },
  sequences: {
    type: 'array',
    description: 'Saved sequence steps',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Sequence step ID' },
        seq_number: { type: 'number', description: 'Step position in the sequence' },
      },
    },
  },
  count: { type: 'number', description: 'Number of sequence steps saved' },
} satisfies NonNullable<ToolConfig['outputs']>

const campaignLeadStatsProperties = {
  total: { type: 'number', description: 'Total leads' },
  notStarted: { type: 'number', description: 'Leads not yet started' },
  inprogress: { type: 'number', description: 'Leads in progress' },
  completed: { type: 'number', description: 'Leads completed' },
  paused: { type: 'number', description: 'Leads paused' },
  stopped: { type: 'number', description: 'Leads stopped' },
  blocked: { type: 'number', description: 'Leads blocked' },
  interested: { type: 'number', description: 'Leads marked interested' },
  revenue: { type: 'number', description: 'Revenue attributed to the campaign' },
} satisfies Record<string, OutputProperty>

const analyticsCountOutputs = {
  sent_count: { type: 'number', description: 'Emails sent' },
  unique_sent_count: { type: 'number', description: 'Unique leads emailed' },
  open_count: { type: 'number', description: 'Email opens' },
  unique_open_count: { type: 'number', description: 'Unique opens' },
  click_count: { type: 'number', description: 'Link clicks' },
  unique_click_count: { type: 'number', description: 'Unique clicks' },
  reply_count: { type: 'number', description: 'Replies' },
  bounce_count: { type: 'number', description: 'Bounces' },
  block_count: { type: 'number', description: 'Blocked sends' },
  unsubscribed_count: { type: 'number', description: 'Unsubscribes' },
  total_count: { type: 'number', description: 'Total emails in the campaign' },
  drafted_count: { type: 'number', description: 'Drafted emails' },
} satisfies Record<string, OutputProperty>

export const campaignAnalyticsOutputs = {
  id: { type: 'number', description: 'Campaign ID' },
  user_id: { type: 'number', description: 'Owning Smartlead user ID', optional: true },
  name: { type: 'string', description: 'Campaign name' },
  status: { type: 'string', description: 'Campaign status' },
  created_at: { type: 'string', description: 'Creation timestamp', optional: true },
  ...analyticsCountOutputs,
  sequence_count: { type: 'number', description: 'Number of sequence steps' },
  campaign_lead_stats: {
    type: 'object',
    description: 'Lead counts by state',
    properties: campaignLeadStatsProperties,
  },
  client_id: { type: 'number', description: 'Client ID', optional: true },
  client_name: { type: 'string', description: 'Client name', optional: true },
  client_email: { type: 'string', description: 'Client email', optional: true },
  client_company_name: { type: 'string', description: 'Client company name', optional: true },
  parent_campaign_id: { type: 'number', description: 'Parent campaign ID', optional: true },
  send_as_plain_text: { type: 'boolean', description: 'Whether emails send as plain text' },
} satisfies NonNullable<ToolConfig['outputs']>

export const campaignAnalyticsByDateOutputs = {
  id: { type: 'number', description: 'Campaign ID' },
  user_id: { type: 'number', description: 'Owning Smartlead user ID', optional: true },
  name: { type: 'string', description: 'Campaign name' },
  status: { type: 'string', description: 'Campaign status' },
  created_at: { type: 'string', description: 'Creation timestamp', optional: true },
  start_date: { type: 'string', description: 'Start of the reported range' },
  end_date: { type: 'string', description: 'End of the reported range' },
  ...analyticsCountOutputs,
} satisfies NonNullable<ToolConfig['outputs']>

export const addLeadsOutputs = {
  upload_count: { type: 'number', description: 'Leads submitted in the request' },
  total_leads: { type: 'number', description: 'Leads newly added to the campaign' },
  already_added_to_campaign: {
    type: 'number',
    description: 'Leads already present in the campaign',
  },
  duplicate_count: { type: 'number', description: 'Duplicate leads skipped' },
  invalid_email_count: { type: 'number', description: 'Leads skipped for an invalid email' },
  block_count: { type: 'number', description: 'Leads skipped by the block list' },
  bounce_count: { type: 'number', description: 'Leads skipped for prior bounces' },
  lead_import_stopped_count: { type: 'number', description: 'Leads whose import was stopped' },
  is_lead_limit_exhausted: {
    type: 'boolean',
    description: 'Whether the plan lead limit was reached',
  },
  invalid_emails: { type: 'array', description: 'Emails rejected as invalid' },
  unsubscribed_leads: { type: 'array', description: 'Leads skipped because they unsubscribed' },
} satisfies NonNullable<ToolConfig['outputs']>

export const campaignStatisticsOutputs = {
  stats: {
    type: 'array',
    description:
      'Per-email statistics rows returned by Smartlead. Row fields are passed through unchanged.',
  },
  total_stats: { type: 'number', description: 'Total rows matching the filters' },
  offset: { type: 'number', description: 'Pagination offset used' },
  limit: { type: 'number', description: 'Pagination limit used' },
} satisfies NonNullable<ToolConfig['outputs']>

export const leadCategoriesOutputs = {
  categories: {
    type: 'array',
    description: 'Lead categories configured on the account',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Category ID' },
        name: { type: 'string', description: 'Category name' },
        sentiment_type: {
          type: 'string',
          description: 'Category sentiment (positive, negative, neutral)',
          optional: true,
        },
        created_at: { type: 'string', description: 'Creation timestamp', optional: true },
      },
    },
  },
  count: { type: 'number', description: 'Number of categories returned' },
} satisfies NonNullable<ToolConfig['outputs']>

export const messageHistoryOutputs = {
  history: {
    type: 'array',
    description: 'Message history entries for the lead. Entry fields are passed through unchanged.',
  },
  count: { type: 'number', description: 'Number of history entries returned' },
} satisfies NonNullable<ToolConfig['outputs']>

const webhookProperties = {
  id: { type: 'number', description: 'Webhook ID' },
  name: { type: 'string', description: 'Webhook name' },
  webhook_url: { type: 'string', description: 'Destination URL' },
  email_campaign_id: { type: 'number', description: 'Campaign ID' },
  event_types: { type: 'array', description: 'Subscribed event types' },
  categories: { type: 'array', description: 'Lead categories the webhook is scoped to' },
} satisfies Record<string, OutputProperty>

export const listWebhooksOutputs = {
  webhooks: {
    type: 'array',
    description: 'Webhooks registered on the campaign',
    items: {
      type: 'object',
      properties: {
        ...webhookProperties,
        created_at: { type: 'string', description: 'Creation timestamp', optional: true },
        updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
      },
    },
  },
  count: { type: 'number', description: 'Number of webhooks returned' },
} satisfies NonNullable<ToolConfig['outputs']>

export const upsertWebhookOutputs = webhookProperties satisfies NonNullable<ToolConfig['outputs']>

const emailAccountProperties = {
  id: { type: 'number', description: 'Email account ID, used to attach it to a campaign' },
  from_name: { type: 'string', description: 'Sender display name', optional: true },
  from_email: { type: 'string', description: 'Sender email address' },
  username: { type: 'string', description: 'Mailbox username', optional: true },
  type: { type: 'string', description: 'Account type (GMAIL, OUTLOOK, SMTP)', optional: true },
  smtp_host: { type: 'string', description: 'SMTP host', optional: true },
  smtp_port: { type: 'number', description: 'SMTP port', optional: true },
  smtp_port_type: { type: 'string', description: 'SMTP encryption type', optional: true },
  imap_host: { type: 'string', description: 'IMAP host', optional: true },
  imap_port: { type: 'number', description: 'IMAP port', optional: true },
  imap_port_type: { type: 'string', description: 'IMAP encryption type', optional: true },
  is_smtp_success: { type: 'boolean', description: 'Whether SMTP verification succeeded' },
  is_imap_success: { type: 'boolean', description: 'Whether IMAP verification succeeded' },
  smtp_failure_error: { type: 'string', description: 'Last SMTP error', optional: true },
  imap_failure_error: { type: 'string', description: 'Last IMAP error', optional: true },
  message_per_day: { type: 'number', description: 'Daily sending cap', optional: true },
  daily_sent_count: { type: 'number', description: 'Messages sent today', optional: true },
  campaign_count: { type: 'number', description: 'Campaigns using this account', optional: true },
  signature: { type: 'string', description: 'Email signature HTML', optional: true },
  custom_tracking_domain: { type: 'string', description: 'Custom tracking domain', optional: true },
  bcc_email: { type: 'string', description: 'BCC address', optional: true },
  different_reply_to_address: { type: 'string', description: 'Reply-to address', optional: true },
  client_id: { type: 'number', description: 'Owning client ID', optional: true },
  is_suspended: {
    type: 'boolean',
    description: 'Whether the account is suspended',
    optional: true,
  },
  warmup_status: { type: 'string', description: 'Warmup status', optional: true },
  tags: { type: 'array', description: 'Tags applied to the account' },
  created_at: { type: 'string', description: 'Creation timestamp', optional: true },
  updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
} satisfies Record<string, OutputProperty>

/** Credentials are intentionally absent — see `mapEmailAccount`. */
export const emailAccountsOutputs = {
  accounts: {
    type: 'array',
    description: 'Email accounts, excluding their stored mailbox credentials',
    items: { type: 'object', properties: emailAccountProperties },
  },
  count: { type: 'number', description: 'Number of accounts returned' },
} satisfies NonNullable<ToolConfig['outputs']>

export const duplicateCampaignOutputs = {
  success: { type: 'boolean', description: 'Whether Smartlead duplicated the campaign' },
  id: { type: 'number', description: 'ID of the newly created campaign' },
} satisfies NonNullable<ToolConfig['outputs']>

export const exportLeadsOutputs = {
  csv: {
    type: 'string',
    description:
      'Campaign leads as CSV. Columns: id, campaign_lead_map_id, status, category, is_interested, created_at, first_name, last_name, email, phone_number, company_name, website, location, custom_fields, linkedin_profile, company_url, is_unsubscribed, unsubscribed_client_id_map, last_email_sequence_sent, open_count, click_count, reply_count.',
  },
  row_count: { type: 'number', description: 'Number of data rows in the CSV' },
} satisfies NonNullable<ToolConfig['outputs']>

/** Rows are passed through unmapped — see `opaqueRows`. */
export const opaqueListOutputs = {
  items: { type: 'array', description: 'Records returned by Smartlead, passed through unchanged' },
  count: { type: 'number', description: 'Number of records returned' },
} satisfies NonNullable<ToolConfig['outputs']>

export const paginatedRowsOutputs = {
  rows: { type: 'array', description: 'Rows returned by Smartlead, passed through unchanged' },
  count: { type: 'number', description: 'Number of rows returned in this page' },
  has_more: { type: 'boolean', description: 'Whether more rows are available', optional: true },
  offset: { type: 'number', description: 'Pagination offset used', optional: true },
  limit: { type: 'number', description: 'Pagination limit used', optional: true },
} satisfies NonNullable<ToolConfig['outputs']>

export const topLevelAnalyticsOutputs = {
  id: { type: 'number', description: 'Campaign ID' },
  name: { type: 'string', description: 'Campaign name' },
  status: { type: 'string', description: 'Campaign status' },
  start_date: { type: 'string', description: 'Start of the reported range' },
  end_date: { type: 'string', description: 'End of the reported range' },
  total_count: { type: 'number', description: 'Total emails in the range' },
  sent_count: { type: 'number', description: 'Emails sent' },
  skipped_count: { type: 'number', description: 'Emails skipped' },
  open_count: { type: 'number', description: 'Email opens' },
  click_count: { type: 'number', description: 'Link clicks' },
  reply_count: { type: 'number', description: 'Replies' },
  positive_reply_count: { type: 'number', description: 'Replies categorized as positive' },
  bounce_count: { type: 'number', description: 'Bounces' },
  failed_count: { type: 'number', description: 'Failed sends' },
  stopped_count: { type: 'number', description: 'Stopped leads' },
  unsubscribed_count: { type: 'number', description: 'Unsubscribes' },
} satisfies NonNullable<ToolConfig['outputs']>

export const markCompleteOutputs = {
  success: { type: 'boolean', description: 'Whether the lead was marked complete' },
  is_last_sequence: {
    type: 'boolean',
    description: 'Whether the lead was on the final sequence step',
    optional: true,
  },
  next_sequence_id: {
    type: 'number',
    description: 'ID of the next sequence step, or null when none remains',
    optional: true,
  },
  next_sequence_delay_in_days: {
    type: 'number',
    description: 'Days before the next sequence step would have sent',
    optional: true,
  },
} satisfies NonNullable<ToolConfig['outputs']>

export const webhookSummaryOutputs = {
  summary: {
    type: 'array',
    description: 'Per-webhook delivery summary rows, passed through unchanged',
  },
  count: { type: 'number', description: 'Number of summary rows returned' },
  from: { type: 'string', description: 'Start of the reported window', optional: true },
  to: { type: 'string', description: 'End of the reported window', optional: true },
} satisfies NonNullable<ToolConfig['outputs']>

const leadListProperties = {
  id: { type: 'number', description: 'Lead list ID' },
  list_name: { type: 'string', description: 'Lead list name' },
  created_at: { type: 'string', description: 'Creation timestamp', optional: true },
  updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
  leads_count: { type: 'number', description: 'Leads in the list', optional: true },
  active_leads_count: { type: 'number', description: 'Active leads in the list', optional: true },
} satisfies Record<string, OutputProperty>

export const leadListsOutputs = {
  lists: {
    type: 'array',
    description: 'Lead lists on the account',
    items: { type: 'object', properties: leadListProperties },
  },
  total_count: { type: 'number', description: 'Total lead lists on the account', optional: true },
  count: { type: 'number', description: 'Number of lead lists returned' },
} satisfies NonNullable<ToolConfig['outputs']>

export const leadListOutputs = leadListProperties satisfies NonNullable<ToolConfig['outputs']>
