import { SmartleadIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { SmartleadResponse } from '@/tools/smartlead/types'

const CAMPAIGN_ID_OPERATIONS = [
  'get_campaign',
  'update_campaign_status',
  'update_campaign_schedule',
  'update_campaign_settings',
  'get_campaign_analytics',
  'get_campaign_analytics_by_date',
  'get_campaign_sequences',
  'save_campaign_sequences',
  'get_campaign_statistics',
  'add_leads_to_campaign',
  'list_campaign_leads',
  'update_lead',
  'update_lead_category',
  'pause_lead',
  'resume_lead',
  'get_lead_message_history',
  'list_campaign_webhooks',
  'upsert_campaign_webhook',
] as const

const LEAD_ID_OPERATIONS = [
  'update_lead',
  'update_lead_category',
  'pause_lead',
  'resume_lead',
  'get_lead_message_history',
] as const

export const SmartleadBlock: BlockConfig<SmartleadResponse> = {
  type: 'smartlead',
  name: 'Smartlead',
  description: 'Manage Smartlead cold email campaigns, sequences, and leads',
  longDescription:
    'Integrate Smartlead into workflows. Create campaigns, write multi-step email sequences, import and categorize leads, pull campaign analytics, and register webhooks for engagement events.',
  docsLink: 'https://docs.sim.ai/integrations/smartlead',
  category: 'tools',
  integrationType: IntegrationType.Email,
  bgColor: '#000000',
  icon: SmartleadIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Campaigns', id: 'list_campaigns' },
        { label: 'Get Campaign', id: 'get_campaign' },
        { label: 'Create Campaign', id: 'create_campaign' },
        { label: 'Update Campaign Status', id: 'update_campaign_status' },
        { label: 'Update Campaign Schedule', id: 'update_campaign_schedule' },
        { label: 'Update Campaign Settings', id: 'update_campaign_settings' },
        { label: 'Get Campaign Analytics', id: 'get_campaign_analytics' },
        { label: 'Get Campaign Analytics by Date', id: 'get_campaign_analytics_by_date' },
        { label: 'Get Campaign Sequences', id: 'get_campaign_sequences' },
        { label: 'Save Campaign Sequences', id: 'save_campaign_sequences' },
        { label: 'Get Campaign Statistics', id: 'get_campaign_statistics' },
        { label: 'Add Leads to Campaign', id: 'add_leads_to_campaign' },
        { label: 'List Campaign Leads', id: 'list_campaign_leads' },
        { label: 'Get Lead by Email', id: 'get_lead_by_email' },
        { label: 'Update Lead', id: 'update_lead' },
        { label: 'Update Lead Category', id: 'update_lead_category' },
        { label: 'Pause Lead', id: 'pause_lead' },
        { label: 'Resume Lead', id: 'resume_lead' },
        { label: 'List Lead Categories', id: 'list_lead_categories' },
        { label: 'Get Lead Message History', id: 'get_lead_message_history' },
        { label: 'List Campaign Webhooks', id: 'list_campaign_webhooks' },
        { label: 'Create or Update Webhook', id: 'upsert_campaign_webhook' },
      ],
      value: () => 'list_campaigns',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Smartlead API key',
      required: true,
    },
    {
      id: 'campaignId',
      title: 'Campaign ID',
      type: 'short-input',
      placeholder: '3773713',
      required: { field: 'operation', value: [...CAMPAIGN_ID_OPERATIONS] },
      condition: { field: 'operation', value: [...CAMPAIGN_ID_OPERATIONS] },
    },
    {
      id: 'leadId',
      title: 'Lead ID',
      type: 'short-input',
      placeholder: '4308274706',
      required: { field: 'operation', value: [...LEAD_ID_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_ID_OPERATIONS] },
    },
    {
      id: 'campaignName',
      title: 'Campaign Name',
      type: 'short-input',
      placeholder: 'Q1 Cold Outreach',
      required: { field: 'operation', value: 'create_campaign' },
      condition: { field: 'operation', value: 'create_campaign' },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Start', id: 'START' },
        { label: 'Pause', id: 'PAUSED' },
        { label: 'Stop', id: 'STOPPED' },
      ],
      value: () => 'PAUSED',
      required: { field: 'operation', value: 'update_campaign_status' },
      condition: { field: 'operation', value: 'update_campaign_status' },
    },
    {
      id: 'leadEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'lead@example.com',
      required: { field: 'operation', value: ['get_lead_by_email', 'update_lead'] },
      condition: { field: 'operation', value: ['get_lead_by_email', 'update_lead'] },
    },
    {
      id: 'leads',
      title: 'Leads',
      type: 'long-input',
      placeholder:
        '[{"email":"lead@example.com","first_name":"Ada","company_name":"Acme","custom_fields":{"job_title":"CEO"}}]',
      required: { field: 'operation', value: 'add_leads_to_campaign' },
      condition: { field: 'operation', value: 'add_leads_to_campaign' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Smartlead leads. Each object requires "email" and may include first_name, last_name, phone_number, company_name, website, location, linkedin_profile, company_url, and a custom_fields object. Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },
    {
      id: 'sequences',
      title: 'Sequences',
      type: 'long-input',
      placeholder:
        '[{"seq_number":1,"delay_in_days":1,"subject":"Quick question about {{company_name}}","email_body":"<p>Hi {{first_name}},</p>"}]',
      required: { field: 'operation', value: 'save_campaign_sequences' },
      condition: { field: 'operation', value: 'save_campaign_sequences' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Smartlead email sequence steps. Each object has seq_number (1-based), delay_in_days, subject, and email_body (HTML). Use {{first_name}} and {{company_name}} for personalization. An empty subject makes the step reply in the previous thread. Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },
    {
      id: 'categoryId',
      title: 'Category ID',
      type: 'short-input',
      placeholder: '1',
      required: { field: 'operation', value: 'update_lead_category' },
      condition: { field: 'operation', value: 'update_lead_category' },
    },
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'America/Los_Angeles',
      required: { field: 'operation', value: 'update_campaign_schedule' },
      condition: { field: 'operation', value: 'update_campaign_schedule' },
    },
    {
      id: 'daysOfTheWeek',
      title: 'Sending Days',
      type: 'short-input',
      placeholder: '1,2,3,4,5',
      required: { field: 'operation', value: 'update_campaign_schedule' },
      condition: { field: 'operation', value: 'update_campaign_schedule' },
    },
    {
      id: 'startHour',
      title: 'Start Hour',
      type: 'short-input',
      placeholder: '09:00',
      required: { field: 'operation', value: 'update_campaign_schedule' },
      condition: { field: 'operation', value: 'update_campaign_schedule' },
    },
    {
      id: 'endHour',
      title: 'End Hour',
      type: 'short-input',
      placeholder: '17:00',
      required: { field: 'operation', value: 'update_campaign_schedule' },
      condition: { field: 'operation', value: 'update_campaign_schedule' },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: '2026-08-01',
      required: { field: 'operation', value: 'get_campaign_analytics_by_date' },
      condition: { field: 'operation', value: 'get_campaign_analytics_by_date' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format for the start of the requested reporting range. Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: '2026-08-31',
      required: { field: 'operation', value: 'get_campaign_analytics_by_date' },
      condition: { field: 'operation', value: 'get_campaign_analytics_by_date' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format for the end of the requested reporting range. Smartlead rejects ranges longer than about one month. Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'webhookName',
      title: 'Webhook Name',
      type: 'short-input',
      placeholder: 'Reply notifications',
      required: { field: 'operation', value: 'upsert_campaign_webhook' },
      condition: { field: 'operation', value: 'upsert_campaign_webhook' },
    },
    {
      id: 'webhookUrl',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'https://example.com/hooks/smartlead',
      required: { field: 'operation', value: 'upsert_campaign_webhook' },
      condition: { field: 'operation', value: 'upsert_campaign_webhook' },
    },
    {
      id: 'eventTypes',
      title: 'Event Types',
      type: 'short-input',
      placeholder: 'EMAIL_SENT,EMAIL_REPLY',
      required: { field: 'operation', value: 'upsert_campaign_webhook' },
      condition: { field: 'operation', value: 'upsert_campaign_webhook' },
    },
    {
      id: 'categories',
      title: 'Lead Categories',
      type: 'short-input',
      placeholder: 'Interested',
      required: { field: 'operation', value: 'upsert_campaign_webhook' },
      condition: { field: 'operation', value: 'upsert_campaign_webhook' },
    },
    {
      id: 'webhookId',
      title: 'Webhook ID',
      type: 'short-input',
      placeholder: 'Leave empty to create a new webhook',
      condition: { field: 'operation', value: 'upsert_campaign_webhook' },
      mode: 'advanced',
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'Agency client ID',
      condition: { field: 'operation', value: ['list_campaigns', 'create_campaign'] },
      mode: 'advanced',
    },
    {
      id: 'includeTags',
      title: 'Include Tags',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_campaigns' },
      mode: 'advanced',
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Ada',
      condition: { field: 'operation', value: 'update_lead' },
      mode: 'advanced',
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Lovelace',
      condition: { field: 'operation', value: 'update_lead' },
      mode: 'advanced',
    },
    {
      id: 'companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Acme Corp',
      condition: { field: 'operation', value: 'update_lead' },
      mode: 'advanced',
    },
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+15550100',
      condition: { field: 'operation', value: 'update_lead' },
      mode: 'advanced',
    },
    {
      id: 'website',
      title: 'Website',
      type: 'short-input',
      placeholder: 'https://acme.com',
      condition: { field: 'operation', value: 'update_lead' },
      mode: 'advanced',
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      placeholder: 'San Francisco, CA',
      condition: { field: 'operation', value: 'update_lead' },
      mode: 'advanced',
    },
    {
      id: 'linkedinProfile',
      title: 'LinkedIn Profile',
      type: 'short-input',
      placeholder: 'https://linkedin.com/in/example',
      condition: { field: 'operation', value: 'update_lead' },
      mode: 'advanced',
    },
    {
      id: 'customFields',
      title: 'Custom Fields',
      type: 'long-input',
      placeholder: '{"job_title":"CEO"}',
      condition: { field: 'operation', value: 'update_lead' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a flat JSON object of Smartlead lead custom fields as name/value pairs. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'trackSettings',
      title: 'Disable Tracking',
      type: 'short-input',
      placeholder: 'DONT_TRACK_EMAIL_OPEN,DONT_TRACK_LINK_CLICK',
      condition: { field: 'operation', value: 'update_campaign_settings' },
      mode: 'advanced',
    },
    {
      id: 'stopLeadSettings',
      title: 'Stop Lead On',
      type: 'dropdown',
      options: [
        { label: 'Reply to an Email', id: 'REPLY_TO_AN_EMAIL' },
        { label: 'Click on a Link', id: 'CLICK_ON_A_LINK' },
        { label: 'Open an Email', id: 'OPEN_AN_EMAIL' },
      ],
      value: () => 'REPLY_TO_AN_EMAIL',
      condition: { field: 'operation', value: 'update_campaign_settings' },
      mode: 'advanced',
    },
    {
      id: 'sendAsPlainText',
      title: 'Send as Plain Text',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'update_campaign_settings' },
      mode: 'advanced',
    },
    {
      id: 'minTimeBetweenEmails',
      title: 'Minutes Between Emails',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'update_campaign_schedule' },
      mode: 'advanced',
    },
    {
      id: 'maxNewLeadsPerDay',
      title: 'Max New Leads per Day',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: 'update_campaign_schedule' },
      mode: 'advanced',
    },
    {
      id: 'pauseLead',
      title: 'Pause Lead',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'update_lead_category' },
      mode: 'advanced',
    },
    {
      id: 'resumeLeadWithDelayDays',
      title: 'Resume Delay (Days)',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'resume_lead' },
      mode: 'advanced',
    },
    {
      id: 'emailStatus',
      title: 'Engagement Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Opened', id: 'opened' },
        { label: 'Clicked', id: 'clicked' },
        { label: 'Replied', id: 'replied' },
        { label: 'Unsubscribed', id: 'unsubscribed' },
        { label: 'Bounced', id: 'bounced' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'get_campaign_statistics' },
      mode: 'advanced',
    },
    {
      id: 'emailSequenceNumber',
      title: 'Sequence Step',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'get_campaign_statistics' },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: {
        field: 'operation',
        value: ['list_campaign_leads', 'get_campaign_statistics'],
      },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['list_campaign_leads', 'get_campaign_statistics'],
      },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'smartlead_list_campaigns',
      'smartlead_get_campaign',
      'smartlead_create_campaign',
      'smartlead_update_campaign_status',
      'smartlead_update_campaign_schedule',
      'smartlead_update_campaign_settings',
      'smartlead_get_campaign_analytics',
      'smartlead_get_campaign_analytics_by_date',
      'smartlead_get_campaign_sequences',
      'smartlead_save_campaign_sequences',
      'smartlead_get_campaign_statistics',
      'smartlead_add_leads_to_campaign',
      'smartlead_list_campaign_leads',
      'smartlead_get_lead_by_email',
      'smartlead_update_lead',
      'smartlead_update_lead_category',
      'smartlead_pause_lead',
      'smartlead_resume_lead',
      'smartlead_list_lead_categories',
      'smartlead_get_lead_message_history',
      'smartlead_list_campaign_webhooks',
      'smartlead_upsert_campaign_webhook',
    ],
    config: {
      tool: (params) => `smartlead_${params.operation}`,
      params: (params) => ({
        campaignId: toNumberParam(params.campaignId),
        leadId: toNumberParam(params.leadId),
        clientId: toNumberParam(params.clientId),
        categoryId: toNumberParam(params.categoryId),
        webhookId: toNumberParam(params.webhookId),
        offset: toNumberParam(params.offset),
        limit: toNumberParam(params.limit),
        emailSequenceNumber: toNumberParam(params.emailSequenceNumber),
        minTimeBetweenEmails: toNumberParam(params.minTimeBetweenEmails),
        maxNewLeadsPerDay: toNumberParam(params.maxNewLeadsPerDay),
        resumeLeadWithDelayDays: toNumberParam(params.resumeLeadWithDelayDays),
        includeTags: toBooleanParam(params.includeTags),
        sendAsPlainText: toBooleanParam(params.sendAsPlainText),
        pauseLead: toBooleanParam(params.pauseLead),
        name: params.operation === 'create_campaign' ? params.campaignName : params.webhookName,
        email: emptyToUndefined(params.leadEmail),
        emailStatus: emptyToUndefined(params.emailStatus),
        stopLeadSettings: emptyToUndefined(params.stopLeadSettings),
        daysOfTheWeek: parseNumberList(params.daysOfTheWeek),
        trackSettings: parseStringList(params.trackSettings),
        eventTypes: parseStringList(params.eventTypes),
        categories: parseStringList(params.categories),
        leads: parseJsonArray(params.leads),
        sequences: parseJsonArray(params.sequences),
        customFields: parseJsonObject(params.customFields),
      }),
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Smartlead API key' },
    campaignId: { type: 'number', description: 'Campaign ID' },
    leadId: { type: 'number', description: 'Lead ID' },
    campaignName: { type: 'string', description: 'Campaign name' },
    status: { type: 'string', description: 'Target campaign status' },
    leadEmail: { type: 'string', description: 'Lead email address' },
    leads: { type: 'array', description: 'Leads to add to the campaign' },
    sequences: { type: 'array', description: 'Email sequence steps' },
    categoryId: { type: 'number', description: 'Lead category ID' },
    timezone: { type: 'string', description: 'Sending window timezone' },
    daysOfTheWeek: { type: 'array', description: 'Sending days as ISO weekday numbers' },
    startHour: { type: 'string', description: 'Sending window start (HH:MM)' },
    endHour: { type: 'string', description: 'Sending window end (HH:MM)' },
    startDate: { type: 'string', description: 'Reporting range start (YYYY-MM-DD)' },
    endDate: { type: 'string', description: 'Reporting range end (YYYY-MM-DD)' },
    webhookName: { type: 'string', description: 'Webhook name' },
    webhookUrl: { type: 'string', description: 'Webhook destination URL' },
    eventTypes: { type: 'array', description: 'Webhook event types' },
    categories: { type: 'array', description: 'Lead categories the webhook applies to' },
    webhookId: { type: 'number', description: 'Existing webhook ID to update' },
    clientId: { type: 'number', description: 'Agency client ID' },
    includeTags: { type: 'boolean', description: 'Include campaign tags' },
    firstName: { type: 'string', description: 'Lead first name' },
    lastName: { type: 'string', description: 'Lead last name' },
    companyName: { type: 'string', description: 'Lead company name' },
    phoneNumber: { type: 'string', description: 'Lead phone number' },
    website: { type: 'string', description: 'Lead website' },
    location: { type: 'string', description: 'Lead location' },
    linkedinProfile: { type: 'string', description: 'Lead LinkedIn profile URL' },
    customFields: { type: 'json', description: 'Lead custom fields' },
    trackSettings: { type: 'array', description: 'Tracking settings to disable' },
    stopLeadSettings: { type: 'string', description: 'Lead activity that stops the sequence' },
    sendAsPlainText: { type: 'boolean', description: 'Send campaign emails as plain text' },
    minTimeBetweenEmails: { type: 'number', description: 'Minimum minutes between emails' },
    maxNewLeadsPerDay: { type: 'number', description: 'Maximum new leads per day' },
    pauseLead: { type: 'boolean', description: 'Pause the lead when setting its category' },
    resumeLeadWithDelayDays: { type: 'number', description: 'Days to wait before resuming' },
    emailStatus: { type: 'string', description: 'Engagement status filter' },
    emailSequenceNumber: { type: 'number', description: 'Sequence step filter' },
    offset: { type: 'number', description: 'Pagination offset' },
    limit: { type: 'number', description: 'Pagination limit' },
  },
  outputs: {
    campaigns: { type: 'array', description: 'List of campaigns' },
    leads: { type: 'array', description: 'List of leads' },
    sequences: { type: 'array', description: 'Email sequence steps' },
    categories: { type: 'array', description: 'Lead categories' },
    webhooks: { type: 'array', description: 'Campaign webhooks' },
    stats: { type: 'array', description: 'Per-email statistics rows' },
    history: { type: 'array', description: 'Lead message history' },
    count: { type: 'number', description: 'Number of records returned' },
    total_leads: { type: 'number', description: 'Total leads matching the request' },
    total_stats: { type: 'number', description: 'Total statistics rows matching the filters' },
    id: { type: 'number', description: 'Record ID' },
    name: { type: 'string', description: 'Record name' },
    status: { type: 'string', description: 'Campaign status' },
    email: { type: 'string', description: 'Lead email address' },
    webhook_url: { type: 'string', description: 'Webhook destination URL' },
    event_types: { type: 'array', description: 'Webhook event types' },
    sent_count: { type: 'number', description: 'Emails sent' },
    open_count: { type: 'number', description: 'Email opens' },
    click_count: { type: 'number', description: 'Link clicks' },
    reply_count: { type: 'number', description: 'Replies' },
    bounce_count: { type: 'number', description: 'Bounces' },
    campaign_lead_stats: { type: 'json', description: 'Lead counts by state' },
    upload_count: { type: 'number', description: 'Leads uploaded' },
    success: { type: 'boolean', description: 'Whether the action succeeded' },
  },
}

function parseNumberList(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    const numbers = value.map(toNumberParam).filter((item): item is number => item !== undefined)
    return numbers.length > 0 ? numbers : undefined
  }

  if (typeof value !== 'string' || value.trim() === '') return undefined

  const numbers = value
    .split(/[\s,]+/)
    .map(toNumberParam)
    .filter((item): item is number => item !== undefined)

  return numbers.length > 0 ? numbers : undefined
}

function parseStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter((item) => item !== '')
    return items.length > 0 ? items : undefined
  }

  if (typeof value !== 'string' || value.trim() === '') return undefined

  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')

  return items.length > 0 ? items : undefined
}

function parseJsonArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return undefined

  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined

  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function toNumberParam(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toBooleanParam(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value
}

export const SmartleadBlockMeta = {
  tags: ['sales-engagement', 'email-marketing', 'automation'],
  url: 'https://smartlead.ai',
  templates: [
    {
      icon: SmartleadIcon,
      title: 'Smartlead campaign builder',
      prompt:
        'Build a workflow that takes a target persona and offer, drafts a three-step Smartlead email sequence with {{first_name}} and {{company_name}} personalization, creates the campaign, saves the sequence, sets a weekday 9-to-5 sending schedule, and reports the campaign ID for review before it is started.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: SmartleadIcon,
      title: 'Smartlead reply triage',
      prompt:
        'Create a scheduled workflow that pulls Smartlead campaign statistics filtered to replied, reads each lead message history, classifies the reply as interested, not interested, objection, or out-of-office, sets the matching Smartlead lead category, and posts hot replies to a Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SmartleadIcon,
      title: 'Smartlead lead loader',
      prompt:
        'Build a workflow that reads prospects from a table, normalizes each name, company, and email, adds them to a Smartlead campaign in batches of 400 with the block list respected, and writes back how many were uploaded versus skipped as duplicates, bounces, or invalid emails.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: SmartleadIcon,
      title: 'Smartlead weekly outbound digest',
      prompt:
        'Create a scheduled weekly workflow that lists Smartlead campaigns, pulls analytics by date for the last seven days for each active campaign, computes open, click, and reply rates, ranks best and worst performers, and emails the digest to the sales lead.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SmartleadIcon,
      title: 'Smartlead + HubSpot sync',
      prompt:
        'Build a workflow that reads Smartlead campaign leads and their categories, finds or creates the matching HubSpot contact, mirrors the outreach status onto the contact, and creates a HubSpot task for a rep whenever a lead is categorized as interested.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'sync'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: SmartleadIcon,
      title: 'Smartlead bounce cleanup',
      prompt:
        'Create a scheduled workflow that pulls Smartlead campaign statistics filtered to bounced, pauses each bounced lead, records the suppression in a table with the campaign and bounce date, and reports how many leads were paused so deliverability stays healthy.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'analysis'],
    },
    {
      icon: SmartleadIcon,
      title: 'Smartlead sequence A/B rewriter',
      prompt:
        'Build a workflow that reads a Smartlead campaign sequence and its per-step statistics, identifies the step with the weakest reply rate, drafts two stronger subject and body variants for it, and saves the updated sequence back to the campaign after a human approves.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'analysis'],
    },
    {
      icon: SmartleadIcon,
      title: 'Smartlead engagement webhook wiring',
      prompt:
        'Create a workflow that lists Smartlead campaigns, checks which ones are missing a reply webhook, and registers a webhook on each for EMAIL_REPLY and LEAD_UNSUBSCRIBED scoped to the Interested category so downstream automations receive engagement events.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'webhooks'],
    },
  ],
  skills: [
    {
      name: 'launch-smartlead-campaign',
      description:
        'Create a Smartlead campaign end to end — sequence, schedule, and settings — ready for a human to start.',
      content:
        '# Launch a Smartlead Campaign\n\nStand up a new cold email campaign in Smartlead.\n\n## Steps\n1. Call Create Campaign with the campaign name. It returns the campaign ID and starts in DRAFTED status.\n2. Call Save Campaign Sequences with every step in one array — each step takes seq_number, delay_in_days, subject, and email_body. Leave subject empty on follow-ups so they reply in the same thread. Personalize with {{first_name}} and {{company_name}}.\n3. Call Update Campaign Schedule with the timezone, sending days (1 is Monday), start and end hour, and daily lead cap. A campaign cannot start without a schedule.\n4. Optionally call Update Campaign Settings to disable open or click tracking and choose what stops a lead.\n5. Add leads with Add Leads to Campaign (max 400 per call).\n\n## Output\nReport the campaign ID, number of sequence steps saved, the schedule, and how many leads were added versus skipped. Do NOT start the campaign — Update Campaign Status with START also requires at least one connected email account, so leave that to a human.',
    },
    {
      name: 'triage-smartlead-replies',
      description:
        'Find Smartlead leads who replied, classify intent, and set the matching lead category.',
      content:
        '# Triage Smartlead Replies\n\nRoute inbound replies to an outbound campaign.\n\n## Steps\n1. Call Get Campaign Statistics with emailStatus set to replied to find engaged leads.\n2. For each lead, call Get Lead Message History to read the thread.\n3. Classify the reply as interested, not interested, objection, out-of-office, or auto-reply.\n4. Call List Lead Categories to resolve the category ID, then Update Lead Category. Set pauseLead when the lead should stop receiving follow-ups.\n\n## Output\nReturn each lead with its email, classification, and the category applied. Surface interested replies first so a rep can follow up.',
    },
    {
      name: 'report-smartlead-performance',
      description:
        'Summarize Smartlead campaign performance with open, click, and reply rates over a date range.',
      content:
        '# Report Smartlead Performance\n\nProduce an outbound performance snapshot.\n\n## Steps\n1. Call List Campaigns to get every campaign and its status.\n2. For lifetime totals call Get Campaign Analytics; for a window call Get Campaign Analytics by Date. Keep ranges to about a month — Smartlead rejects longer spans.\n3. Compute rates from the returned counts: opens divided by sends, clicks divided by sends, replies divided by sends. Prefer the unique_* counts for rates so repeat opens do not inflate them.\n4. Rank campaigns by reply rate.\n\n## Output\nReturn a digest with per-campaign sends, unique opens, clicks, replies, and bounces plus the derived rates, calling out the best and worst performers and one takeaway each.',
    },
    {
      name: 'import-smartlead-leads',
      description: 'Load prospects into a Smartlead campaign and report exactly what was skipped.',
      content:
        '# Import Leads to a Smartlead Campaign\n\nBulk-load prospects into an existing campaign.\n\n## Steps\n1. Confirm the campaign ID — resolve it with List Campaigns if only a name is known.\n2. Normalize each prospect to email (required) plus first_name, last_name, company_name, website, location, linkedin_profile, and a custom_fields object for personalization tokens.\n3. Call Add Leads to Campaign in batches of at most 400. Only override the block, unsubscribe, duplicate, or bounce lists when the user explicitly asks.\n4. Verify with List Campaign Leads.\n\n## Output\nReport upload_count against total_leads and break down every skip reason — already_added_to_campaign, duplicate_count, invalid_email_count, block_count, bounce_count — and flag is_lead_limit_exhausted if the plan cap was hit.',
    },
  ],
} as const satisfies BlockMeta
