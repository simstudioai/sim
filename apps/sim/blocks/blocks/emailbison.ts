import { EmailBisonIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { EmailBisonResponse } from '@/tools/emailbison/types'
import { getTrigger } from '@/triggers'

const LEAD_MUTATION_OPERATIONS = ['create_lead', 'update_lead'] as const
const LEAD_LIST_OPERATIONS = ['list_leads'] as const
const CAMPAIGN_ID_OPERATIONS = [
  'update_campaign',
  'update_campaign_status',
  'attach_leads_to_campaign',
] as const
const REPLY_FILTER_OPERATIONS = ['list_replies'] as const
const TAG_FILTER_OPERATIONS = ['list_leads', 'list_replies'] as const
const EMAILBISON_TRIGGER_IDS = [
  'emailbison_email_sent',
  'emailbison_lead_first_contacted',
  'emailbison_lead_replied',
  'emailbison_lead_interested',
  'emailbison_lead_unsubscribed',
  'emailbison_untracked_reply_received',
  'emailbison_email_opened',
  'emailbison_email_bounced',
  'emailbison_email_account_added',
  'emailbison_email_account_removed',
  'emailbison_email_account_disconnected',
  'emailbison_email_account_reconnected',
  'emailbison_manual_email_sent',
  'emailbison_tag_attached',
  'emailbison_tag_removed',
  'emailbison_warmup_disabled_receiving_bounces',
  'emailbison_warmup_disabled_causing_bounces',
] as const

export const EmailBisonBlock: BlockConfig<EmailBisonResponse> = {
  type: 'emailbison',
  name: 'Email Bison',
  description: 'Manage Email Bison leads, campaigns, replies, and tags',
  longDescription:
    'Integrate Email Bison into workflows. Create and update leads, manage campaigns, attach leads to campaigns, list replies, and organize leads with tags.',
  docsLink: 'https://docs.sim.ai/tools/emailbison',
  category: 'tools',
  integrationType: IntegrationType.Email,
  tags: ['sales-engagement', 'email-marketing', 'automation'],
  bgColor: '#FB7A22',
  icon: EmailBisonIcon,
  authMode: AuthMode.ApiKey,
  triggers: {
    enabled: true,
    available: [...EMAILBISON_TRIGGER_IDS],
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Leads', id: 'list_leads' },
        { label: 'Get Lead', id: 'get_lead' },
        { label: 'Create Lead', id: 'create_lead' },
        { label: 'Update Lead', id: 'update_lead' },
        { label: 'List Campaigns', id: 'list_campaigns' },
        { label: 'Create Campaign', id: 'create_campaign' },
        { label: 'Update Campaign', id: 'update_campaign' },
        { label: 'Update Campaign Status', id: 'update_campaign_status' },
        { label: 'Attach Leads to Campaign', id: 'attach_leads_to_campaign' },
        { label: 'List Replies', id: 'list_replies' },
        { label: 'List Tags', id: 'list_tags' },
        { label: 'Create Tag', id: 'create_tag' },
        { label: 'Attach Tags to Leads', id: 'attach_tags_to_leads' },
      ],
      value: () => 'list_leads',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Email Bison API token',
      required: true,
    },
    {
      id: 'apiBaseUrl',
      title: 'Instance URL',
      type: 'short-input',
      placeholder: 'https://your-emailbison-workspace.com',
      required: true,
    },
    {
      id: 'leadId',
      title: 'Lead ID or Email',
      type: 'short-input',
      placeholder: 'Lead ID or email address',
      required: { field: 'operation', value: ['get_lead', 'update_lead'] },
      condition: { field: 'operation', value: ['get_lead', 'update_lead'] },
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search term',
      condition: {
        field: 'operation',
        value: [...LEAD_LIST_OPERATIONS, ...REPLY_FILTER_OPERATIONS],
      },
    },
    {
      id: 'campaignStatus',
      title: 'Lead Campaign Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'In Sequence', id: 'in_sequence' },
        { label: 'Sequence Finished', id: 'sequence_finished' },
        { label: 'Sequence Stopped', id: 'sequence_stopped' },
        { label: 'Never Contacted', id: 'never_contacted' },
        { label: 'Replied', id: 'replied' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_leads' },
      mode: 'advanced',
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      required: { field: 'operation', value: [...LEAD_MUTATION_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_MUTATION_OPERATIONS] },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      required: { field: 'operation', value: [...LEAD_MUTATION_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_MUTATION_OPERATIONS] },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'john@example.com',
      required: { field: 'operation', value: [...LEAD_MUTATION_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_MUTATION_OPERATIONS] },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Engineer',
      condition: { field: 'operation', value: [...LEAD_MUTATION_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'company',
      title: 'Company',
      type: 'short-input',
      placeholder: 'Acme Inc.',
      condition: { field: 'operation', value: [...LEAD_MUTATION_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'notes',
      title: 'Notes',
      type: 'long-input',
      placeholder: 'Additional notes',
      condition: { field: 'operation', value: [...LEAD_MUTATION_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'customVariables',
      title: 'Custom Variables',
      type: 'long-input',
      placeholder: '[{"name":"linkedin_url","value":"https://linkedin.com/in/john"}]',
      condition: { field: 'operation', value: [...LEAD_MUTATION_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Email Bison custom variables. Each item must have name and value. Return ONLY the JSON array.',
        generationType: 'json-object',
      },
      mode: 'advanced',
    },
    {
      id: 'campaignId',
      title: 'Campaign ID',
      type: 'short-input',
      placeholder: '123',
      required: { field: 'operation', value: [...CAMPAIGN_ID_OPERATIONS] },
      condition: {
        field: 'operation',
        value: [...CAMPAIGN_ID_OPERATIONS, ...REPLY_FILTER_OPERATIONS],
      },
    },
    {
      id: 'campaignName',
      title: 'Campaign Name',
      type: 'short-input',
      placeholder: 'Outbound Campaign',
      required: { field: 'operation', value: 'create_campaign' },
      condition: { field: 'operation', value: ['create_campaign', 'update_campaign'] },
    },
    {
      id: 'campaignType',
      title: 'Campaign Type',
      type: 'dropdown',
      options: [
        { label: 'Outbound', id: 'outbound' },
        { label: 'Reply Follow-up', id: 'reply_followup' },
      ],
      value: () => 'outbound',
      condition: { field: 'operation', value: 'create_campaign' },
      mode: 'advanced',
    },
    {
      id: 'action',
      title: 'Status Action',
      type: 'dropdown',
      options: [
        { label: 'Pause', id: 'pause' },
        { label: 'Resume', id: 'resume' },
        { label: 'Archive', id: 'archive' },
      ],
      value: () => 'pause',
      required: { field: 'operation', value: 'update_campaign_status' },
      condition: { field: 'operation', value: 'update_campaign_status' },
    },
    {
      id: 'maxEmailsPerDay',
      title: 'Max Emails Per Day',
      type: 'short-input',
      placeholder: '500',
      condition: { field: 'operation', value: 'update_campaign' },
      mode: 'advanced',
    },
    {
      id: 'maxNewLeadsPerDay',
      title: 'Max New Leads Per Day',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'update_campaign' },
      mode: 'advanced',
    },
    {
      id: 'sequencePrioritization',
      title: 'Sequence Prioritization',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Follow-ups', id: 'followups' },
        { label: 'New Leads', id: 'new_leads' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_campaign' },
      mode: 'advanced',
    },
    {
      id: 'plainText',
      title: 'Plain Text',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_campaign' },
      mode: 'advanced',
    },
    {
      id: 'openTracking',
      title: 'Open Tracking',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_campaign' },
      mode: 'advanced',
    },
    {
      id: 'reputationBuilding',
      title: 'Reputation Building',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_campaign' },
      mode: 'advanced',
    },
    {
      id: 'canUnsubscribe',
      title: 'Can Unsubscribe',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_campaign' },
      mode: 'advanced',
    },
    {
      id: 'includeAutoRepliesInStats',
      title: 'Include Auto Replies in Stats',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_campaign' },
      mode: 'advanced',
    },
    {
      id: 'leadIds',
      title: 'Lead IDs',
      type: 'short-input',
      placeholder: '1,2,3',
      required: { field: 'operation', value: ['attach_leads_to_campaign', 'attach_tags_to_leads'] },
      condition: {
        field: 'operation',
        value: ['attach_leads_to_campaign', 'attach_tags_to_leads'],
      },
    },
    {
      id: 'allowParallelSending',
      title: 'Allow Parallel Sending',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'attach_leads_to_campaign' },
      mode: 'advanced',
    },
    {
      id: 'replyStatus',
      title: 'Reply Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Interested', id: 'interested' },
        { label: 'Automated Reply', id: 'automated_reply' },
        { label: 'Not Automated Reply', id: 'not_automated_reply' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_replies' },
      mode: 'advanced',
    },
    {
      id: 'folder',
      title: 'Folder',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Inbox', id: 'inbox' },
        { label: 'Sent', id: 'sent' },
        { label: 'Spam', id: 'spam' },
        { label: 'Bounced', id: 'bounced' },
        { label: 'All', id: 'all' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_replies' },
      mode: 'advanced',
    },
    {
      id: 'read',
      title: 'Read',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Read', id: 'true' },
        { label: 'Unread', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_replies' },
      mode: 'advanced',
    },
    {
      id: 'senderEmailId',
      title: 'Sender Email ID',
      type: 'short-input',
      placeholder: '243',
      condition: { field: 'operation', value: 'list_replies' },
      mode: 'advanced',
    },
    {
      id: 'replyLeadId',
      title: 'Lead ID',
      type: 'short-input',
      placeholder: '14',
      condition: { field: 'operation', value: 'list_replies' },
      mode: 'advanced',
    },
    {
      id: 'tagName',
      title: 'Tag Name',
      type: 'short-input',
      placeholder: 'Interested',
      required: { field: 'operation', value: 'create_tag' },
      condition: { field: 'operation', value: 'create_tag' },
    },
    {
      id: 'tagIds',
      title: 'Tag IDs',
      type: 'short-input',
      placeholder: '1,2,3',
      required: { field: 'operation', value: 'attach_tags_to_leads' },
      condition: { field: 'operation', value: 'attach_tags_to_leads' },
    },
    {
      id: 'filterTagIds',
      title: 'Filter Tag IDs',
      type: 'short-input',
      placeholder: '1,2,3',
      condition: { field: 'operation', value: [...TAG_FILTER_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'excludedTagIds',
      title: 'Excluded Tag IDs',
      type: 'short-input',
      placeholder: '4,5,6',
      condition: { field: 'operation', value: 'list_leads' },
      mode: 'advanced',
    },
    {
      id: 'withoutTags',
      title: 'Without Tags',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_leads' },
      mode: 'advanced',
    },
    {
      id: 'skipWebhooks',
      title: 'Skip Webhooks',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'attach_tags_to_leads' },
      mode: 'advanced',
    },
    ...EMAILBISON_TRIGGER_IDS.flatMap((triggerId) => getTrigger(triggerId).subBlocks),
  ],
  tools: {
    access: [
      'emailbison_list_leads',
      'emailbison_get_lead',
      'emailbison_create_lead',
      'emailbison_update_lead',
      'emailbison_list_campaigns',
      'emailbison_create_campaign',
      'emailbison_update_campaign',
      'emailbison_update_campaign_status',
      'emailbison_attach_leads_to_campaign',
      'emailbison_list_replies',
      'emailbison_list_tags',
      'emailbison_create_tag',
      'emailbison_attach_tags_to_leads',
    ],
    config: {
      tool: (params) => `emailbison_${params.operation}`,
      params: (params) => ({
        apiBaseUrl: params.apiBaseUrl,
        leadId:
          params.operation === 'list_replies' ? toNumberParam(params.replyLeadId) : params.leadId,
        leadIds: parseNumberList(params.leadIds),
        tagIds: parseNumberList(
          params.operation === 'attach_tags_to_leads' ? params.tagIds : params.filterTagIds
        ),
        excludedTagIds: parseNumberList(params.excludedTagIds),
        customVariables: parseJsonArray(params.customVariables),
        campaignId: toNumberParam(params.campaignId),
        campaignType: emptyToUndefined(params.campaignType),
        name:
          params.operation === 'create_tag' || params.operation === 'create_campaign'
            ? params.operation === 'create_tag'
              ? params.tagName
              : params.campaignName
            : emptyToUndefined(params.campaignName),
        action: params.action,
        maxEmailsPerDay: toNumberParam(params.maxEmailsPerDay),
        maxNewLeadsPerDay: toNumberParam(params.maxNewLeadsPerDay),
        sequencePrioritization: emptyToUndefined(params.sequencePrioritization),
        plainText: toBooleanParam(params.plainText),
        openTracking: toBooleanParam(params.openTracking),
        reputationBuilding: toBooleanParam(params.reputationBuilding),
        canUnsubscribe: toBooleanParam(params.canUnsubscribe),
        includeAutoRepliesInStats: toBooleanParam(params.includeAutoRepliesInStats),
        allowParallelSending: toBooleanParam(params.allowParallelSending),
        skipWebhooks: toBooleanParam(params.skipWebhooks),
        withoutTags: toBooleanParam(params.withoutTags),
        read: toBooleanParam(params.read),
        senderEmailId: toNumberParam(params.senderEmailId),
        campaignStatus: emptyToUndefined(params.campaignStatus),
        status:
          params.operation === 'list_replies' ? emptyToUndefined(params.replyStatus) : undefined,
      }),
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Email Bison API token' },
    apiBaseUrl: { type: 'string', description: 'Email Bison instance URL' },
    leadId: { type: 'string', description: 'Lead ID or email address' },
    search: { type: 'string', description: 'Search term' },
    campaignStatus: { type: 'string', description: 'Lead campaign status filter' },
    firstName: { type: 'string', description: 'Lead first name' },
    lastName: { type: 'string', description: 'Lead last name' },
    email: { type: 'string', description: 'Lead email address' },
    title: { type: 'string', description: 'Lead title' },
    company: { type: 'string', description: 'Lead company' },
    notes: { type: 'string', description: 'Lead notes' },
    customVariables: { type: 'array', description: 'Lead custom variables' },
    campaignId: { type: 'number', description: 'Campaign ID' },
    campaignName: { type: 'string', description: 'Campaign name' },
    campaignType: { type: 'string', description: 'Campaign type' },
    action: { type: 'string', description: 'Campaign status action' },
    maxEmailsPerDay: { type: 'number', description: 'Maximum emails per day' },
    maxNewLeadsPerDay: { type: 'number', description: 'Maximum new leads per day' },
    sequencePrioritization: { type: 'string', description: 'Campaign sequence prioritization' },
    plainText: { type: 'boolean', description: 'Whether campaign emails should be plain text' },
    openTracking: { type: 'boolean', description: 'Whether open tracking should be enabled' },
    reputationBuilding: { type: 'boolean', description: 'Whether reputation building is enabled' },
    canUnsubscribe: { type: 'boolean', description: 'Whether recipients can unsubscribe' },
    includeAutoRepliesInStats: {
      type: 'boolean',
      description: 'Whether auto replies are included in campaign stats',
    },
    leadIds: { type: 'array', description: 'Lead IDs' },
    allowParallelSending: { type: 'boolean', description: 'Allow parallel sending' },
    replyStatus: { type: 'string', description: 'Reply status filter' },
    folder: { type: 'string', description: 'Reply folder filter' },
    read: { type: 'boolean', description: 'Reply read filter' },
    senderEmailId: { type: 'number', description: 'Sender email ID' },
    replyLeadId: { type: 'number', description: 'Reply lead ID filter' },
    tagName: { type: 'string', description: 'Tag name' },
    tagIds: { type: 'array', description: 'Tag IDs' },
    filterTagIds: { type: 'array', description: 'Tag IDs to filter by' },
    excludedTagIds: { type: 'array', description: 'Excluded tag IDs' },
    withoutTags: { type: 'boolean', description: 'Only include leads without tags' },
    skipWebhooks: { type: 'boolean', description: 'Skip Email Bison webhooks' },
  },
  outputs: {
    leads: { type: 'array', description: 'List of leads' },
    campaigns: { type: 'array', description: 'List of campaigns' },
    replies: { type: 'array', description: 'List of replies' },
    tags: { type: 'array', description: 'List of tags' },
    count: { type: 'number', description: 'Number of returned records' },
    id: { type: 'number', description: 'Record ID' },
    uuid: { type: 'string', description: 'Record UUID' },
    name: { type: 'string', description: 'Campaign or tag name' },
    first_name: { type: 'string', description: 'Lead first name' },
    last_name: { type: 'string', description: 'Lead last name' },
    email: { type: 'string', description: 'Lead email address' },
    status: { type: 'string', description: 'Record status' },
    success: { type: 'boolean', description: 'Whether the action succeeded' },
    message: { type: 'string', description: 'Action message' },
  },
}

function parseNumberList(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    const numbers = value.map(toNumberParam).filter((number) => number !== undefined)
    return numbers.length > 0 ? numbers : undefined
  }

  if (typeof value !== 'string') return undefined

  const numbers = value
    .split(/[\s,]+/)
    .map(toNumberParam)
    .filter((number) => number !== undefined)

  return numbers.length > 0 ? numbers : undefined
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

function toNumberParam(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toBooleanParam(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string' || value.trim() === '') return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value
}
