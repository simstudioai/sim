import { InstantlyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { InstantlyResponse } from '@/tools/instantly/types'
import { getTrigger } from '@/triggers'

const LEAD_LIST_OPERATIONS = ['list_leads'] as const
const LEAD_ID_OPERATIONS = ['get_lead'] as const
const LEAD_CREATE_OPERATIONS = ['create_lead'] as const
const LEAD_DELETE_OPERATIONS = ['delete_leads'] as const
const LEAD_INTEREST_OPERATIONS = ['update_lead_interest_status'] as const
const CAMPAIGN_LIST_OPERATIONS = ['list_campaigns'] as const
const CAMPAIGN_MUTATION_OPERATIONS = ['create_campaign', 'patch_campaign'] as const
const CAMPAIGN_ID_OPERATIONS = ['patch_campaign', 'activate_campaign'] as const
const EMAIL_LIST_OPERATIONS = ['list_emails'] as const
const EMAIL_REPLY_OPERATIONS = ['reply_to_email'] as const
const LEAD_LIST_LIST_OPERATIONS = ['list_lead_lists'] as const
const LEAD_LIST_CREATE_OPERATIONS = ['create_lead_list'] as const
const PAGINATED_OPERATIONS = [
  'list_leads',
  'list_campaigns',
  'list_emails',
  'list_lead_lists',
] as const
const INSTANTLY_TRIGGER_IDS = [
  'instantly_webhook',
  'instantly_email_sent',
  'instantly_email_opened',
  'instantly_reply_received',
  'instantly_auto_reply_received',
  'instantly_link_clicked',
  'instantly_email_bounced',
  'instantly_lead_unsubscribed',
  'instantly_account_error',
  'instantly_campaign_completed',
  'instantly_lead_neutral',
  'instantly_lead_interested',
  'instantly_lead_not_interested',
  'instantly_lead_meeting_booked',
  'instantly_lead_meeting_completed',
  'instantly_lead_closed',
  'instantly_lead_out_of_office',
  'instantly_lead_wrong_person',
  'instantly_lead_no_show',
  'instantly_supersearch_enrichment_completed',
] as const

export const InstantlyBlock: BlockConfig<InstantlyResponse> = {
  type: 'instantly',
  name: 'Instantly',
  description: 'Manage Instantly leads, campaigns, emails, and lead lists',
  longDescription:
    'Integrate Instantly API V2 into workflows. Create and list leads, manage lead interest status, delete leads in bulk, list and create campaigns, reply to emails, and manage lead lists.',
  docsLink: 'https://docs.sim.ai/tools/instantly',
  category: 'tools',
  integrationType: IntegrationType.Email,
  tags: ['sales-engagement', 'email-marketing', 'automation'],
  bgColor: '#FF6B35',
  icon: InstantlyIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Leads', id: 'list_leads' },
        { label: 'Get Lead', id: 'get_lead' },
        { label: 'Create Lead', id: 'create_lead' },
        { label: 'Delete Leads', id: 'delete_leads' },
        { label: 'Update Lead Interest Status', id: 'update_lead_interest_status' },
        { label: 'List Campaigns', id: 'list_campaigns' },
        { label: 'Create Campaign', id: 'create_campaign' },
        { label: 'Patch Campaign', id: 'patch_campaign' },
        { label: 'Activate Campaign', id: 'activate_campaign' },
        { label: 'List Emails', id: 'list_emails' },
        { label: 'Reply To Email', id: 'reply_to_email' },
        { label: 'List Lead Lists', id: 'list_lead_lists' },
        { label: 'Create Lead List', id: 'create_lead_list' },
      ],
      value: () => 'list_leads',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Instantly API key',
      password: true,
      required: true,
    },
    {
      id: 'leadId',
      title: 'Lead ID',
      type: 'short-input',
      placeholder: '019e3bd1-b5d9-7b0a-9823-d5382bc9d72b',
      required: { field: 'operation', value: [...LEAD_ID_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_ID_OPERATIONS] },
    },
    {
      id: 'leadDestination',
      title: 'Add Lead To',
      type: 'dropdown',
      options: [
        { label: 'Campaign', id: 'campaign' },
        { label: 'Lead List', id: 'list' },
      ],
      value: () => 'campaign',
      required: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
    },
    {
      id: 'leadDestinationId',
      title: 'Campaign or Lead List ID',
      type: 'short-input',
      placeholder: 'Destination UUID',
      required: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
    },
    {
      id: 'email',
      title: 'Lead Email',
      type: 'short-input',
      placeholder: 'jane@example.com',
      required: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Jane',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
    },
    {
      id: 'companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Acme Inc.',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
    },
    {
      id: 'jobTitle',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Head of Growth',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'phone',
      title: 'Phone',
      type: 'short-input',
      placeholder: '+1234567890',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'website',
      title: 'Website',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'personalization',
      title: 'Personalization',
      type: 'long-input',
      placeholder: 'Personalized opening line',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'customVariables',
      title: 'Custom Variables',
      type: 'long-input',
      placeholder: '{"past_customer": true, "industry": "SaaS"}',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of Instantly custom variables. Values must be strings, numbers, booleans, or null. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
      mode: 'advanced',
    },
    {
      id: 'skipIfInWorkspace',
      title: 'Skip If In Workspace',
      type: 'dropdown',
      options: [
        { label: 'Unspecified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'skipIfInCampaign',
      title: 'Skip If In Campaign',
      type: 'dropdown',
      options: [
        { label: 'Unspecified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'skipIfInList',
      title: 'Skip If In List',
      type: 'dropdown',
      options: [
        { label: 'Unspecified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search term',
      condition: {
        field: 'operation',
        value: [
          ...LEAD_LIST_OPERATIONS,
          ...CAMPAIGN_LIST_OPERATIONS,
          ...EMAIL_LIST_OPERATIONS,
          ...LEAD_LIST_LIST_OPERATIONS,
        ],
      },
    },
    {
      id: 'leadFilter',
      title: 'Lead Filter',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Contacted', id: 'FILTER_VAL_CONTACTED' },
        { label: 'Not Contacted', id: 'FILTER_VAL_NOT_CONTACTED' },
        { label: 'Completed', id: 'FILTER_VAL_COMPLETED' },
        { label: 'Unsubscribed', id: 'FILTER_VAL_UNSUBSCRIBED' },
        { label: 'Active', id: 'FILTER_VAL_ACTIVE' },
        { label: 'Interested', id: 'FILTER_LEAD_INTERESTED' },
        { label: 'Not Interested', id: 'FILTER_LEAD_NOT_INTERESTED' },
        { label: 'Meeting Booked', id: 'FILTER_LEAD_MEETING_BOOKED' },
        { label: 'Replied', id: 'FILTER_VAL_REPLIED' },
        { label: 'Link Clicked', id: 'FILTER_VAL_LINK_CLICKED' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...LEAD_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'campaignId',
      title: 'Campaign ID',
      type: 'short-input',
      placeholder: 'Campaign UUID',
      required: { field: 'operation', value: [...CAMPAIGN_ID_OPERATIONS] },
      condition: {
        field: 'operation',
        value: [
          ...LEAD_LIST_OPERATIONS,
          ...LEAD_INTEREST_OPERATIONS,
          ...CAMPAIGN_ID_OPERATIONS,
          ...EMAIL_LIST_OPERATIONS,
        ],
      },
    },
    {
      id: 'listId',
      title: 'Lead List ID',
      type: 'short-input',
      placeholder: 'Lead list UUID',
      condition: {
        field: 'operation',
        value: [...LEAD_LIST_OPERATIONS, ...LEAD_INTEREST_OPERATIONS, ...EMAIL_LIST_OPERATIONS],
      },
    },
    {
      id: 'leadIds',
      title: 'Lead IDs',
      type: 'long-input',
      placeholder: 'lead-id-1, lead-id-2',
      condition: { field: 'operation', value: [...LEAD_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'contacts',
      title: 'Contacts',
      type: 'long-input',
      placeholder: 'jane@example.com, john@example.com',
      condition: { field: 'operation', value: [...LEAD_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'inCampaign',
      title: 'In Campaign',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...LEAD_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'inList',
      title: 'In List',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...LEAD_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'deleteSource',
      title: 'Delete From',
      type: 'dropdown',
      options: [
        { label: 'Campaign', id: 'campaign' },
        { label: 'Lead List', id: 'list' },
      ],
      value: () => 'campaign',
      required: { field: 'operation', value: [...LEAD_DELETE_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_DELETE_OPERATIONS] },
    },
    {
      id: 'deleteSourceId',
      title: 'Campaign or Lead List ID',
      type: 'short-input',
      placeholder: 'Source UUID',
      required: { field: 'operation', value: [...LEAD_DELETE_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_DELETE_OPERATIONS] },
    },
    {
      id: 'deleteStatus',
      title: 'Delete Status Filter',
      type: 'short-input',
      placeholder: '3',
      condition: { field: 'operation', value: [...LEAD_DELETE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'deleteLeadIds',
      title: 'Delete Lead IDs',
      type: 'long-input',
      placeholder: 'lead-id-1, lead-id-2',
      condition: { field: 'operation', value: [...LEAD_DELETE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'deleteLimit',
      title: 'Delete Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: [...LEAD_DELETE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'leadEmail',
      title: 'Lead Email',
      type: 'short-input',
      placeholder: 'jane@example.com',
      required: { field: 'operation', value: [...LEAD_INTEREST_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_INTEREST_OPERATIONS] },
    },
    {
      id: 'interestValue',
      title: 'Interest Value',
      type: 'short-input',
      placeholder: '1',
      required: { field: 'operation', value: [...LEAD_INTEREST_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_INTEREST_OPERATIONS] },
    },
    {
      id: 'disableAutoInterest',
      title: 'Disable Auto Interest',
      type: 'dropdown',
      options: [
        { label: 'Unspecified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...LEAD_INTEREST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'campaignName',
      title: 'Campaign Name',
      type: 'short-input',
      placeholder: 'My First Campaign',
      required: { field: 'operation', value: 'create_campaign' },
      condition: { field: 'operation', value: [...CAMPAIGN_MUTATION_OPERATIONS] },
    },
    {
      id: 'campaignSchedule',
      title: 'Campaign Schedule',
      type: 'long-input',
      placeholder:
        '{"schedules":[{"name":"Weekdays","timing":{"from":"09:00","to":"17:00"},"days":{"1":true,"2":true,"3":true,"4":true,"5":true},"timezone":"America/Los_Angeles"}]}',
      required: { field: 'operation', value: 'create_campaign' },
      condition: { field: 'operation', value: [...CAMPAIGN_MUTATION_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Instantly API V2 campaign_schedule JSON object with schedules containing name, timing.from, timing.to, days, and timezone. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'sequences',
      title: 'Sequences',
      type: 'long-input',
      placeholder:
        '[{"steps":[{"type":"email","delay":2,"variants":[{"subject":"Hello {{firstName}}","body":"Hey {{firstName}},\\n\\nI hope you are doing well."}]}]}]',
      condition: { field: 'operation', value: [...CAMPAIGN_MUTATION_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Instantly API V2 sequences JSON array. Use one sequence with steps; each step must have type "email", delay, and variants with subject and body. Return ONLY the JSON array.',
        generationType: 'json-object',
      },
      mode: 'advanced',
    },
    {
      id: 'emailList',
      title: 'Sending Accounts',
      type: 'long-input',
      placeholder: 'sender@example.com, sender2@example.com',
      condition: { field: 'operation', value: [...CAMPAIGN_MUTATION_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'dailyLimit',
      title: 'Daily Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: [...CAMPAIGN_MUTATION_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'dailyMaxLeads',
      title: 'Daily Max Leads',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: [...CAMPAIGN_MUTATION_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'openTracking',
      title: 'Open Tracking',
      type: 'dropdown',
      options: [
        { label: 'Unspecified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...CAMPAIGN_MUTATION_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'stopOnReply',
      title: 'Stop On Reply',
      type: 'dropdown',
      options: [
        { label: 'Unspecified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...CAMPAIGN_MUTATION_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'tagIds',
      title: 'Tag IDs',
      type: 'short-input',
      placeholder: 'id1,id2',
      condition: { field: 'operation', value: [...CAMPAIGN_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'campaignStatus',
      title: 'Campaign Status',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: [...CAMPAIGN_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'emailAccount',
      title: 'Email Account',
      type: 'short-input',
      placeholder: 'sender@example.com',
      condition: {
        field: 'operation',
        value: [...EMAIL_LIST_OPERATIONS, ...EMAIL_REPLY_OPERATIONS],
      },
      required: { field: 'operation', value: [...EMAIL_REPLY_OPERATIONS] },
    },
    {
      id: 'emailSearch',
      title: 'Email Search',
      type: 'short-input',
      placeholder: 'lead@example.com or thread:uuid',
      condition: { field: 'operation', value: [...EMAIL_LIST_OPERATIONS] },
    },
    {
      id: 'replyToUuid',
      title: 'Reply To Email ID',
      type: 'short-input',
      placeholder: 'Email UUID',
      required: { field: 'operation', value: [...EMAIL_REPLY_OPERATIONS] },
      condition: { field: 'operation', value: [...EMAIL_REPLY_OPERATIONS] },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Re: Your inquiry',
      required: { field: 'operation', value: [...EMAIL_REPLY_OPERATIONS] },
      condition: { field: 'operation', value: [...EMAIL_REPLY_OPERATIONS] },
    },
    {
      id: 'bodyText',
      title: 'Body Text',
      type: 'long-input',
      placeholder: 'Plain text reply body',
      required: { field: 'operation', value: [...EMAIL_REPLY_OPERATIONS] },
      condition: { field: 'operation', value: [...EMAIL_REPLY_OPERATIONS] },
    },
    {
      id: 'bodyHtml',
      title: 'Body HTML',
      type: 'long-input',
      placeholder: '<p>HTML reply body</p>',
      condition: { field: 'operation', value: [...EMAIL_REPLY_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'leadListName',
      title: 'Lead List Name',
      type: 'short-input',
      placeholder: 'My Lead List',
      required: { field: 'operation', value: [...LEAD_LIST_CREATE_OPERATIONS] },
      condition: { field: 'operation', value: [...LEAD_LIST_CREATE_OPERATIONS] },
    },
    {
      id: 'hasEnrichmentTask',
      title: 'Has Enrichment Task',
      type: 'dropdown',
      options: [
        { label: 'Unspecified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: [...LEAD_LIST_LIST_OPERATIONS, ...LEAD_LIST_CREATE_OPERATIONS],
      },
      mode: 'advanced',
    },
    {
      id: 'ownedBy',
      title: 'Owned By',
      type: 'short-input',
      placeholder: 'User UUID',
      condition: { field: 'operation', value: [...LEAD_LIST_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: [...PAGINATED_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'startingAfter',
      title: 'Starting After',
      type: 'short-input',
      placeholder: 'Cursor from next_starting_after',
      condition: { field: 'operation', value: [...PAGINATED_OPERATIONS] },
      mode: 'advanced',
    },
    ...INSTANTLY_TRIGGER_IDS.flatMap((triggerId) => getTrigger(triggerId).subBlocks),
  ],
  tools: {
    access: [
      'instantly_list_leads',
      'instantly_get_lead',
      'instantly_create_lead',
      'instantly_delete_leads',
      'instantly_update_lead_interest_status',
      'instantly_list_campaigns',
      'instantly_create_campaign',
      'instantly_patch_campaign',
      'instantly_activate_campaign',
      'instantly_list_emails',
      'instantly_reply_to_email',
      'instantly_list_lead_lists',
      'instantly_create_lead_list',
    ],
    config: {
      tool: (params) => `instantly_${params.operation}`,
      params: (params) => ({
        campaign:
          params.leadDestination === 'campaign'
            ? emptyToUndefined(params.leadDestinationId)
            : undefined,
        list_id:
          params.operation === 'delete_leads' && params.deleteSource === 'list'
            ? emptyToUndefined(params.deleteSourceId)
            : params.leadDestination === 'list'
              ? emptyToUndefined(params.leadDestinationId)
              : emptyToUndefined(params.listId),
        campaign_id:
          params.operation === 'delete_leads'
            ? params.deleteSource === 'campaign'
              ? emptyToUndefined(params.deleteSourceId)
              : undefined
            : emptyToUndefined(params.campaignId),
        leadId: params.leadId,
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        company_name: params.companyName,
        job_title: params.jobTitle,
        phone: params.phone,
        website: params.website,
        personalization: params.personalization,
        custom_variables: parseJsonObject(params.customVariables),
        skip_if_in_workspace: toBooleanParam(params.skipIfInWorkspace),
        skip_if_in_campaign: toBooleanParam(params.skipIfInCampaign),
        skip_if_in_list: toBooleanParam(params.skipIfInList),
        filter: emptyToUndefined(params.leadFilter),
        ids:
          params.operation === 'delete_leads'
            ? parseStringList(params.deleteLeadIds)
            : parseStringList(params.leadIds),
        contacts: parseStringList(params.contacts),
        in_campaign: toBooleanParam(params.inCampaign),
        in_list: toBooleanParam(params.inList),
        status:
          params.operation === 'delete_leads'
            ? toNumberParam(params.deleteStatus)
            : toNumberParam(params.campaignStatus),
        limit:
          params.operation === 'delete_leads'
            ? toNumberParam(params.deleteLimit)
            : toNumberParam(params.limit),
        starting_after: params.startingAfter,
        lead_email: params.leadEmail,
        interest_value: toNumberParam(params.interestValue),
        disable_auto_interest: toBooleanParam(params.disableAutoInterest),
        name:
          params.operation === 'create_lead_list'
            ? params.leadListName
            : emptyToUndefined(params.campaignName),
        campaign_schedule: parseJsonObject(params.campaignSchedule),
        sequences: parseJsonArray(params.sequences),
        email_list: parseStringList(params.emailList),
        daily_limit: toNumberParam(params.dailyLimit),
        daily_max_leads: toNumberParam(params.dailyMaxLeads),
        open_tracking: toBooleanParam(params.openTracking),
        stop_on_reply: toBooleanParam(params.stopOnReply),
        tag_ids: emptyToUndefined(params.tagIds),
        search:
          params.operation === 'list_emails'
            ? emptyToUndefined(params.emailSearch)
            : emptyToUndefined(params.search),
        eaccount: params.emailAccount,
        reply_to_uuid: params.replyToUuid,
        subject: params.subject,
        body: {
          text: params.bodyText,
          html: emptyToUndefined(params.bodyHtml),
        },
        has_enrichment_task: toBooleanParam(params.hasEnrichmentTask),
        owned_by: emptyToUndefined(params.ownedBy),
      }),
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Instantly API key' },
    leadId: { type: 'string', description: 'Lead ID' },
    leadDestination: { type: 'string', description: 'Create lead destination type' },
    leadDestinationId: { type: 'string', description: 'Create lead destination ID' },
    email: { type: 'string', description: 'Lead email' },
    firstName: { type: 'string', description: 'Lead first name' },
    lastName: { type: 'string', description: 'Lead last name' },
    companyName: { type: 'string', description: 'Company name' },
    search: { type: 'string', description: 'Search query' },
    campaignId: { type: 'string', description: 'Campaign ID' },
    listId: { type: 'string', description: 'Lead list ID' },
    deleteSource: { type: 'string', description: 'Delete source type' },
    deleteSourceId: { type: 'string', description: 'Delete source ID' },
    leadEmail: { type: 'string', description: 'Lead email for interest update' },
    interestValue: { type: 'number', description: 'Interest status value' },
    campaignName: { type: 'string', description: 'Campaign name' },
    campaignSchedule: { type: 'json', description: 'Campaign schedule object' },
    sequences: { type: 'array', description: 'Campaign sequences' },
    emailAccount: { type: 'string', description: 'Email account' },
    emailSearch: { type: 'string', description: 'Email search query' },
    replyToUuid: { type: 'string', description: 'Email ID to reply to' },
    subject: { type: 'string', description: 'Reply subject' },
    bodyText: { type: 'string', description: 'Reply body text' },
    leadListName: { type: 'string', description: 'Lead list name' },
    limit: { type: 'number', description: 'Page size' },
    startingAfter: { type: 'string', description: 'Pagination cursor' },
  },
  outputs: {
    leads: { type: 'array', description: 'List of leads' },
    lead: { type: 'json', description: 'Lead details' },
    campaigns: { type: 'array', description: 'List of campaigns' },
    campaign: { type: 'json', description: 'Campaign details' },
    emails: { type: 'array', description: 'List of emails' },
    email: { type: 'json', description: 'Email details' },
    lead_lists: { type: 'array', description: 'List of lead lists' },
    lead_list: { type: 'json', description: 'Lead list details' },
    count: { type: 'number', description: 'Returned or affected record count' },
    next_starting_after: { type: 'string', description: 'Cursor for the next page' },
    id: { type: 'string', description: 'Record ID' },
    name: { type: 'string', description: 'Record name' },
    email_address: { type: 'string', description: 'Lead email address' },
    first_name: { type: 'string', description: 'Lead first name' },
    last_name: { type: 'string', description: 'Lead last name' },
    status: { type: 'number', description: 'Lead or campaign status' },
    subject: { type: 'string', description: 'Email subject' },
    thread_id: { type: 'string', description: 'Email thread ID' },
    message: { type: 'string', description: 'Operation message' },
  },
  triggers: {
    enabled: true,
    available: [
      'instantly_webhook',
      'instantly_email_sent',
      'instantly_email_opened',
      'instantly_reply_received',
      'instantly_auto_reply_received',
      'instantly_link_clicked',
      'instantly_email_bounced',
      'instantly_lead_unsubscribed',
      'instantly_account_error',
      'instantly_campaign_completed',
      'instantly_lead_neutral',
      'instantly_lead_interested',
      'instantly_lead_not_interested',
      'instantly_lead_meeting_booked',
      'instantly_lead_meeting_completed',
      'instantly_lead_closed',
      'instantly_lead_out_of_office',
      'instantly_lead_wrong_person',
      'instantly_lead_no_show',
      'instantly_supersearch_enrichment_completed',
    ],
  },
}

function parseStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === 'string' && item !== '')
    return strings.length > 0 ? strings : undefined
  }

  if (typeof value !== 'string' || value.trim() === '') return undefined

  const strings = value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  return strings.length > 0 ? strings : undefined
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (isPlainObject(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return undefined

  try {
    const parsed: unknown = JSON.parse(value)
    return isPlainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
