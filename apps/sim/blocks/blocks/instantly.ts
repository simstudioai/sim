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
  bgColor: '#FFFFFF',
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
      paramVisibility: 'user-only',
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
      required: {
        field: 'operation',
        value: [...LEAD_CREATE_OPERATIONS],
        and: { field: 'leadDestination', value: 'campaign' },
      },
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
          'Generate a JSON object of Instantly custom variables. Values must be strings, numbers, booleans, or null. Return ONLY the JSON object - no explanations, no extra text.',
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
      id: 'verifyLeadsForLeadFinder',
      title: 'Verify Leads For Lead Finder',
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
      id: 'verifyLeadsOnImport',
      title: 'Verify Leads On Import',
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
      id: 'leadInterestStatus',
      title: 'Lead Interest Status',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'potentialLeadValue',
      title: 'Potential Lead Value',
      type: 'short-input',
      placeholder: 'High',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'assignedTo',
      title: 'Assigned To',
      type: 'short-input',
      placeholder: 'Organization user UUID',
      condition: { field: 'operation', value: [...LEAD_CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'blocklistId',
      title: 'Blocklist ID',
      type: 'short-input',
      placeholder: 'Blocklist UUID',
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
        value: [...LEAD_LIST_OPERATIONS, ...CAMPAIGN_LIST_OPERATIONS, ...LEAD_LIST_LIST_OPERATIONS],
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
      id: 'excludedLeadIds',
      title: 'Excluded Lead IDs',
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
      id: 'organizationUserIds',
      title: 'Organization User IDs',
      type: 'long-input',
      placeholder: 'user-id-1, user-id-2',
      condition: { field: 'operation', value: [...LEAD_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'smartViewId',
      title: 'Smart View ID',
      type: 'short-input',
      placeholder: 'Smart view UUID',
      condition: { field: 'operation', value: [...LEAD_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'websiteVisitor',
      title: 'Website Visitor',
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
      id: 'distinctContacts',
      title: 'Distinct Contacts',
      type: 'dropdown',
      options: [
        { label: 'Unspecified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...LEAD_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'enrichmentStatus',
      title: 'Enrichment Status',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: [...LEAD_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'esgCode',
      title: 'ESG Code',
      type: 'short-input',
      placeholder: '0',
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
      placeholder: '1 or null',
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
      id: 'aiInterestValue',
      title: 'AI Interest Value',
      type: 'short-input',
      placeholder: '1',
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
          'Generate an Instantly API V2 campaign_schedule JSON object with schedules containing name, timing.from, timing.to, days, and timezone. Return ONLY the JSON object - no explanations, no extra text.',
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
          'Generate an Instantly API V2 sequences JSON array. Use one sequence with steps; each step must have type "email", delay, and variants with subject and body. Return ONLY the JSON array - no explanations, no extra text.',
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
      id: 'positiveLeadValue',
      title: 'Positive Lead Value',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: [...CAMPAIGN_MUTATION_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'emailGap',
      title: 'Email Gap',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: [...CAMPAIGN_MUTATION_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'linkTracking',
      title: 'Link Tracking',
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
      id: 'textOnly',
      title: 'Text Only',
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
      id: 'aiSalesAgentId',
      title: 'AI Sales Agent ID',
      type: 'short-input',
      placeholder: 'AI Sales Agent UUID',
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
      id: 'emailStatus',
      title: 'Email Status',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: [...EMAIL_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'emailLead',
      title: 'Lead Email Filter',
      type: 'short-input',
      placeholder: 'lead@example.com',
      condition: { field: 'operation', value: [...EMAIL_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'emailIsUnread',
      title: 'Unread',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...EMAIL_LIST_OPERATIONS] },
      mode: 'advanced',
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
      id: 'ccRecipients',
      title: 'CC Recipients',
      type: 'short-input',
      placeholder: 'cc@example.com',
      condition: { field: 'operation', value: [...EMAIL_REPLY_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'bccRecipients',
      title: 'BCC Recipients',
      type: 'short-input',
      placeholder: 'bcc@example.com',
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
        campaign: mapCampaignParam(params),
        list_id: mapListIdParam(params),
        campaign_id: mapCampaignIdParam(params),
        leadId: params.leadId,
        email: emptyToUndefined(params.email),
        first_name: emptyToUndefined(params.firstName),
        last_name: emptyToUndefined(params.lastName),
        company_name: emptyToUndefined(params.companyName),
        job_title: emptyToUndefined(params.jobTitle),
        phone: emptyToUndefined(params.phone),
        website: emptyToUndefined(params.website),
        personalization: emptyToUndefined(params.personalization),
        custom_variables: parseJsonObject(params.customVariables),
        lt_interest_status: toNumberParam(params.leadInterestStatus),
        pl_value_lead: emptyToUndefined(params.potentialLeadValue),
        assigned_to: optionalIdParam(params.assignedTo),
        blocklist_id: optionalIdParam(params.blocklistId),
        skip_if_in_workspace: toBooleanParam(params.skipIfInWorkspace),
        skip_if_in_campaign: toBooleanParam(params.skipIfInCampaign),
        skip_if_in_list: toBooleanParam(params.skipIfInList),
        verify_leads_for_lead_finder: toBooleanParam(params.verifyLeadsForLeadFinder),
        verify_leads_on_import: toBooleanParam(params.verifyLeadsOnImport),
        filter: emptyToUndefined(params.leadFilter),
        ids: mapIdsParam(params),
        excluded_ids: parseStringList(params.excludedLeadIds),
        contacts: parseStringList(params.contacts),
        organization_user_ids: parseStringList(params.organizationUserIds),
        smart_view_id: optionalIdParam(params.smartViewId),
        is_website_visitor: toBooleanParam(params.websiteVisitor),
        distinct_contacts: toBooleanParam(params.distinctContacts),
        enrichment_status: toNumberParam(params.enrichmentStatus),
        esg_code: emptyToUndefined(params.esgCode),
        in_campaign: toBooleanParam(params.inCampaign),
        in_list: toBooleanParam(params.inList),
        status: mapStatusParam(params),
        limit: mapLimitParam(params),
        starting_after: mapStartingAfterParam(params),
        lead_email: emptyToUndefined(params.leadEmail),
        interest_value:
          params.operation === 'update_lead_interest_status'
            ? toNullableNumberParam(params.interestValue, true)
            : undefined,
        ai_interest_value: toNumberParam(params.aiInterestValue),
        disable_auto_interest: toBooleanParam(params.disableAutoInterest),
        name: mapNameParam(params),
        campaign_schedule: parseJsonObject(params.campaignSchedule),
        sequences: parseJsonArray(params.sequences),
        email_list: parseStringList(params.emailList),
        daily_limit: toNumberParam(params.dailyLimit),
        daily_max_leads: toNumberParam(params.dailyMaxLeads),
        open_tracking: toBooleanParam(params.openTracking),
        stop_on_reply: toBooleanParam(params.stopOnReply),
        pl_value: toNumberParam(params.positiveLeadValue),
        email_gap: toNumberParam(params.emailGap),
        link_tracking: toBooleanParam(params.linkTracking),
        text_only: toBooleanParam(params.textOnly),
        tag_ids: emptyToUndefined(params.tagIds),
        ai_sales_agent_id: optionalIdParam(params.aiSalesAgentId),
        search: mapSearchParam(params),
        eaccount: emptyToUndefined(params.emailAccount),
        i_status: toNumberParam(params.emailStatus),
        lead: emptyToUndefined(params.emailLead),
        is_unread: toBooleanParam(params.emailIsUnread),
        reply_to_uuid: emptyToUndefined(params.replyToUuid),
        subject: emptyToUndefined(params.subject),
        body: {
          text: emptyToUndefined(params.bodyText),
          html: emptyToUndefined(params.bodyHtml),
        },
        cc_address_email_list: emptyToUndefined(params.ccRecipients),
        bcc_address_email_list: emptyToUndefined(params.bccRecipients),
        has_enrichment_task: toBooleanParam(params.hasEnrichmentTask),
        owned_by: optionalIdParam(params.ownedBy),
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
    leadInterestStatus: { type: 'number', description: 'Lead interest status value' },
    potentialLeadValue: { type: 'string', description: 'Potential value of the lead' },
    assignedTo: { type: 'string', description: 'Organization user ID assigned to the lead' },
    blocklistId: { type: 'string', description: 'Blocklist ID' },
    verifyLeadsForLeadFinder: {
      type: 'boolean',
      description: 'Whether to verify leads imported from Lead Finder',
    },
    verifyLeadsOnImport: { type: 'boolean', description: 'Whether to verify leads on import' },
    search: { type: 'string', description: 'Search query' },
    excludedLeadIds: { type: 'string', description: 'Lead IDs to exclude' },
    contacts: { type: 'string', description: 'Lead email addresses to include' },
    organizationUserIds: { type: 'string', description: 'Organization user IDs to filter leads' },
    smartViewId: { type: 'string', description: 'Smart view ID to filter leads' },
    websiteVisitor: { type: 'boolean', description: 'Whether the lead is a website visitor' },
    distinctContacts: { type: 'boolean', description: 'Whether to return distinct contacts' },
    enrichmentStatus: { type: 'number', description: 'Enrichment status filter' },
    esgCode: { type: 'string', description: 'Email security gateway code filter' },
    campaignId: { type: 'string', description: 'Campaign ID' },
    listId: { type: 'string', description: 'Lead list ID' },
    leadIds: { type: 'string', description: 'Lead IDs' },
    inCampaign: { type: 'boolean', description: 'Whether the lead is in a campaign' },
    inList: { type: 'boolean', description: 'Whether the lead is in a list' },
    deleteSource: { type: 'string', description: 'Delete source type' },
    deleteSourceId: { type: 'string', description: 'Delete source ID' },
    deleteStatus: { type: 'number', description: 'Delete status filter' },
    deleteLeadIds: { type: 'string', description: 'Lead IDs to delete' },
    deleteLimit: { type: 'number', description: 'Maximum number of leads to delete' },
    leadEmail: { type: 'string', description: 'Lead email for interest update' },
    interestValue: { type: 'number', description: 'Interest status value' },
    disableAutoInterest: { type: 'boolean', description: 'Whether to disable auto interest' },
    aiInterestValue: { type: 'number', description: 'AI interest value' },
    campaignName: { type: 'string', description: 'Campaign name' },
    campaignSchedule: { type: 'json', description: 'Campaign schedule object' },
    sequences: { type: 'array', description: 'Campaign sequences' },
    emailList: { type: 'string', description: 'Sending email accounts' },
    dailyLimit: { type: 'number', description: 'Daily sending limit' },
    dailyMaxLeads: { type: 'number', description: 'Daily maximum new leads' },
    openTracking: { type: 'boolean', description: 'Whether to track opens' },
    stopOnReply: { type: 'boolean', description: 'Whether to stop on replies' },
    positiveLeadValue: { type: 'number', description: 'Value of every positive lead' },
    emailGap: { type: 'number', description: 'Gap between emails in minutes' },
    linkTracking: { type: 'boolean', description: 'Whether to track links' },
    textOnly: { type: 'boolean', description: 'Whether the campaign is text only' },
    tagIds: { type: 'string', description: 'Campaign tag IDs' },
    aiSalesAgentId: { type: 'string', description: 'AI Sales Agent ID' },
    campaignStatus: { type: 'number', description: 'Campaign status filter' },
    emailAccount: { type: 'string', description: 'Email account' },
    emailSearch: { type: 'string', description: 'Email search query' },
    emailStatus: { type: 'number', description: 'Email interest status filter' },
    emailLead: { type: 'string', description: 'Lead email filter' },
    emailIsUnread: { type: 'boolean', description: 'Whether the email is unread' },
    replyToUuid: { type: 'string', description: 'Email ID to reply to' },
    subject: { type: 'string', description: 'Reply subject' },
    bodyText: { type: 'string', description: 'Reply body text' },
    bodyHtml: { type: 'string', description: 'Reply body HTML' },
    ccRecipients: { type: 'string', description: 'CC email recipients' },
    bccRecipients: { type: 'string', description: 'BCC email recipients' },
    leadListName: { type: 'string', description: 'Lead list name' },
    hasEnrichmentTask: { type: 'boolean', description: 'Whether the lead list has enrichment' },
    ownedBy: { type: 'string', description: 'Owner user ID' },
    limit: { type: 'number', description: 'Page size' },
    startingAfter: { type: 'string', description: 'Pagination cursor' },
  },
  outputs: {
    leads: {
      type: 'array',
      description: 'List of leads (id, email, first_name, last_name, campaign, status)',
    },
    lead: {
      type: 'json',
      description:
        'Lead details (id, email, first_name, last_name, company_name, job_title, campaign, status, payload)',
    },
    campaigns: { type: 'array', description: 'List of campaigns (id, name, status, daily_limit)' },
    campaign: {
      type: 'json',
      description:
        'Campaign details (id, name, status, daily_limit, daily_max_leads, open_tracking)',
    },
    emails: {
      type: 'array',
      description: 'List of emails (id, subject, from_address_email, lead, thread_id)',
    },
    email: {
      type: 'json',
      description:
        'Email details (id, subject, from_address_email, to_address_email_list, thread_id, content_preview)',
    },
    lead_lists: {
      type: 'array',
      description: 'List of lead lists (id, name, has_enrichment_task, timestamp_created)',
    },
    lead_list: {
      type: 'json',
      description:
        'Lead list details (id, organization_id, has_enrichment_task, owned_by, name, timestamp_created)',
    },
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
    const strings = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item !== '' && item !== '-')
    return strings.length > 0 ? strings : undefined
  }

  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '-') return undefined

  const strings = trimmed
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '' && item !== '-')

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

function toNullableNumberParam(value: unknown, emptyAsNull = false): number | null | undefined {
  if (value === null) return null
  if (emptyAsNull && value === undefined) return null
  if (emptyAsNull && typeof value === 'string' && value.trim() === '-') return null
  if (typeof value === 'string' && value.trim().toLowerCase() === 'null') return null
  if (emptyAsNull && typeof value === 'string' && value.trim() === '') return null
  return toNumberParam(value)
}

function toBooleanParam(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string' || value.trim() === '') return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' || trimmed === '-' ? undefined : trimmed
}

function mapCampaignParam(params: Record<string, unknown>): string | undefined {
  if (params.operation === 'list_leads') return optionalIdParam(params.campaignId)
  if (params.operation !== 'create_lead' || params.leadDestination !== 'campaign') return undefined
  return optionalIdParam(params.leadDestinationId)
}

function mapListIdParam(params: Record<string, unknown>): string | undefined {
  switch (params.operation) {
    case 'delete_leads':
      return params.deleteSource === 'list' ? optionalIdParam(params.deleteSourceId) : undefined
    case 'create_lead':
      return params.leadDestination === 'list'
        ? optionalIdParam(params.leadDestinationId)
        : undefined
    case 'list_leads':
    case 'update_lead_interest_status':
    case 'list_emails':
      return optionalIdParam(params.listId)
    default:
      return undefined
  }
}

function mapCampaignIdParam(params: Record<string, unknown>): string | undefined {
  if (params.operation === 'delete_leads') {
    return params.deleteSource === 'campaign' ? optionalIdParam(params.deleteSourceId) : undefined
  }

  if (params.operation === 'update_lead_interest_status' || params.operation === 'list_emails') {
    return optionalIdParam(params.campaignId)
  }

  return undefined
}

function mapIdsParam(params: Record<string, unknown>): string[] | undefined {
  if (params.operation === 'delete_leads') return parseStringList(params.deleteLeadIds)
  if (params.operation === 'list_leads') return parseStringList(params.leadIds)
  return undefined
}

function mapStatusParam(params: Record<string, unknown>): number | undefined {
  if (params.operation === 'delete_leads') return toNumberParam(params.deleteStatus)
  if (params.operation === 'list_campaigns') return toNumberParam(params.campaignStatus)
  return undefined
}

function mapLimitParam(params: Record<string, unknown>): number | undefined {
  if (params.operation === 'delete_leads') return toNumberParam(params.deleteLimit)
  if (isPaginatedOperation(params.operation)) return toNumberParam(params.limit)
  return undefined
}

function mapStartingAfterParam(params: Record<string, unknown>): unknown {
  return isPaginatedOperation(params.operation) ? emptyToUndefined(params.startingAfter) : undefined
}

function mapNameParam(params: Record<string, unknown>): unknown {
  switch (params.operation) {
    case 'create_lead_list':
      return emptyToUndefined(params.leadListName)
    case 'create_campaign':
    case 'patch_campaign':
      return emptyToUndefined(params.campaignName)
    default:
      return undefined
  }
}

function mapSearchParam(params: Record<string, unknown>): unknown {
  if (params.operation === 'list_emails') return emptyToUndefined(params.emailSearch)
  if (isSearchOperation(params.operation)) return emptyToUndefined(params.search)
  return undefined
}

function isPaginatedOperation(value: unknown): boolean {
  return (
    value === 'list_leads' ||
    value === 'list_campaigns' ||
    value === 'list_emails' ||
    value === 'list_lead_lists'
  )
}

function isSearchOperation(value: unknown): boolean {
  return value === 'list_leads' || value === 'list_campaigns' || value === 'list_lead_lists'
}

function optionalIdParam(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '-') return undefined
  return trimmed
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
