import { toBooleanFromInput } from '@sim/utils/coerce'
import { MonacoIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

type FieldKind = 'string' | 'number' | 'boolean' | 'value'

/** One tool param filled from one subBlock, coerced by `kind` at execution time. */
type FieldBinding = readonly [param: string, field: string, kind: FieldKind]

const LIST_FIELDS: readonly FieldBinding[] = [
  ['filters', 'filters', 'value'],
  ['sort', 'sort', 'string'],
  ['page', 'page', 'number'],
  ['pageSize', 'pageSize', 'number'],
]

const PAGE_FIELDS: readonly FieldBinding[] = [
  ['page', 'page', 'number'],
  ['pageSize', 'pageSize', 'number'],
]

const CONTACT_WRITE_FIELDS: readonly FieldBinding[] = [
  ['email', 'email', 'string'],
  ['linkedinUrl', 'linkedinUrl', 'string'],
  ['firstName', 'firstName', 'string'],
  ['lastName', 'lastName', 'string'],
  ['title', 'title', 'string'],
  ['phoneNumber', 'phoneNumber', 'string'],
  ['location', 'location', 'string'],
  ['accountId', 'accountId', 'string'],
  ['domain', 'domain', 'string'],
  ['doNotContact', 'doNotContact', 'boolean'],
  ['notes', 'notes', 'string'],
  ['tags', 'tags', 'value'],
  ['isInbound', 'isInbound', 'boolean'],
  ['customFields', 'customFields', 'value'],
]

const ACCOUNT_WRITE_FIELDS: readonly FieldBinding[] = [
  ['name', 'name', 'string'],
  ['status', 'accountStatus', 'string'],
  ['notes', 'notes', 'string'],
  ['owner', 'owner', 'string'],
  ['parentAccount', 'parentAccount', 'string'],
  ['companyId', 'companyId', 'string'],
  ['replaceEditedFields', 'replaceEditedFields', 'boolean'],
  ['linkedinUrl', 'linkedinUrl', 'string'],
  ['description', 'companyDescription', 'string'],
  ['employeeCount', 'employeeCount', 'number'],
  ['foundedYear', 'foundedYear', 'number'],
  ['estimatedAnnualRevenueUsd', 'estimatedAnnualRevenueUsd', 'number'],
  ['totalFundingUsd', 'totalFundingUsd', 'number'],
  ['lastFundingRound', 'lastFundingRound', 'string'],
  ['lastFundingDate', 'lastFundingDate', 'string'],
  ['industries', 'industries', 'value'],
  ['businessModel', 'businessModel', 'string'],
  ['companyStatus', 'companyStatus', 'string'],
  ['location', 'location', 'string'],
  ['tags', 'tags', 'value'],
  ['domains', 'domains', 'value'],
  ['resetFields', 'resetFields', 'value'],
  ['clearFields', 'clearFields', 'value'],
  ['customFields', 'customFields', 'value'],
]

const OPPORTUNITY_WRITE_FIELDS: readonly FieldBinding[] = [
  ['name', 'name', 'string'],
  ['pipelineId', 'pipelineId', 'string'],
  ['stage', 'stage', 'string'],
  ['stageId', 'stageId', 'string'],
  ['ownerUserId', 'ownerUserId', 'string'],
  ['amount', 'amount', 'number'],
  ['currencyCode', 'currencyCode', 'string'],
  ['estimatedCloseDate', 'estimatedCloseDate', 'string'],
  ['notes', 'notes', 'string'],
  ['tags', 'tags', 'value'],
  ['customFields', 'customFields', 'value'],
]

/**
 * The subBlock each tool param of every operation reads. The executor merges raw subBlock
 * values under the mapped params, so the mapper clears every field and sets only these.
 */
const OPERATION_FIELDS = {
  monaco_list_contacts: [...LIST_FIELDS, ['includeCustomFields', 'includeCustomFields', 'boolean']],
  monaco_get_contact: [
    ['contactId', 'contactId', 'string'],
    ['includeReasoning', 'includeReasoning', 'boolean'],
  ],
  monaco_create_contact: CONTACT_WRITE_FIELDS,
  monaco_update_contact: [
    ['contactId', 'contactId', 'string'],
    ['firstName', 'firstName', 'string'],
    ['lastName', 'lastName', 'string'],
    ['email', 'email', 'string'],
    ['title', 'title', 'string'],
    ['phoneNumber', 'phoneNumber', 'string'],
    ['linkedinUrl', 'linkedinUrl', 'string'],
    ['location', 'location', 'string'],
    ['notes', 'notes', 'string'],
    ['doNotContact', 'doNotContact', 'boolean'],
    ['tags', 'tags', 'value'],
    ['country', 'country', 'string'],
    ['jobStartDate', 'jobStartDate', 'string'],
    ['clearFields', 'clearFields', 'value'],
    ['customFields', 'customFields', 'value'],
  ],
  monaco_upsert_contact: [
    ...CONTACT_WRITE_FIELDS,
    ['id', 'contactId', 'string'],
    ['clearFields', 'clearFields', 'value'],
  ],
  monaco_delete_contact: [['contactId', 'contactId', 'string']],
  monaco_list_accounts: [...LIST_FIELDS, ['includeCustomFields', 'includeCustomFields', 'boolean']],
  monaco_get_account: [
    ['accountId', 'accountId', 'string'],
    ['includeReasoning', 'includeReasoning', 'boolean'],
  ],
  monaco_upsert_account: [
    ['domainLookup', 'domainLookup', 'string'],
    ['id', 'accountId', 'string'],
    ...ACCOUNT_WRITE_FIELDS,
  ],
  monaco_update_account: [['accountId', 'accountId', 'string'], ...ACCOUNT_WRITE_FIELDS],
  monaco_delete_account: [['accountId', 'accountId', 'string']],
  monaco_list_opportunities: [
    ...LIST_FIELDS,
    ['pipelineId', 'pipelineId', 'string'],
    ['includeCustomFields', 'includeCustomFields', 'boolean'],
  ],
  monaco_get_opportunity: [
    ['opportunityId', 'opportunityId', 'string'],
    ['includeReasoning', 'includeReasoning', 'boolean'],
  ],
  monaco_create_opportunity: [
    ...OPPORTUNITY_WRITE_FIELDS,
    ['accountId', 'accountId', 'string'],
    ['idempotencyKey', 'idempotencyKey', 'string'],
  ],
  monaco_update_opportunity: [
    ['opportunityId', 'opportunityId', 'string'],
    ...OPPORTUNITY_WRITE_FIELDS,
    ['actualCloseDate', 'actualCloseDate', 'string'],
  ],
  monaco_delete_opportunity: [['opportunityId', 'opportunityId', 'string']],
  monaco_list_opportunity_contacts: [['opportunityId', 'opportunityId', 'string'], ...PAGE_FIELDS],
  monaco_link_opportunity_contacts: [
    ['opportunityId', 'opportunityId', 'string'],
    ['contactIds', 'contactIds', 'value'],
  ],
  monaco_unlink_opportunity_contacts: [
    ['opportunityId', 'opportunityId', 'string'],
    ['contactIds', 'contactIds', 'value'],
  ],
  monaco_list_pipelines: [],
  monaco_list_tasks: LIST_FIELDS,
  monaco_get_task: [['taskId', 'taskId', 'string']],
  monaco_create_task: [
    ['title', 'taskTitle', 'string'],
    ['description', 'taskDescription', 'string'],
    ['accountId', 'accountId', 'string'],
    ['opportunityId', 'opportunityId', 'string'],
    ['taskType', 'taskType', 'string'],
    ['assigneeId', 'assigneeId', 'string'],
    ['dueAt', 'dueAt', 'string'],
    ['messageDraft', 'messageDraft', 'value'],
  ],
  monaco_update_task: [
    ['taskId', 'taskId', 'string'],
    ['title', 'taskTitle', 'string'],
    ['description', 'taskDescription', 'string'],
    ['status', 'taskStatus', 'string'],
    ['accountId', 'accountId', 'string'],
    ['assigneeId', 'assigneeId', 'string'],
    ['dueAt', 'dueAt', 'string'],
    ['messageDraft', 'messageDraft', 'value'],
  ],
  monaco_list_meetings: LIST_FIELDS,
  monaco_get_meeting: [['meetingId', 'meetingId', 'string']],
  monaco_list_messages: [
    ['contactId', 'contactId', 'string'],
    ['accountId', 'accountId', 'string'],
    ['channels', 'channels', 'value'],
    ['cursor', 'cursor', 'string'],
    ['pageSize', 'pageSize', 'number'],
  ],
  monaco_get_conversation: [
    ['conversationId', 'conversationId', 'string'],
    ['channel', 'channel', 'string'],
    ...PAGE_FIELDS,
  ],
  monaco_list_tags: [['object', 'tagObject', 'string']],
  monaco_create_tag: [
    ['object', 'tagObject', 'string'],
    ['name', 'tagName', 'string'],
    ['color', 'tagColor', 'string'],
  ],
  monaco_list_users: [['query', 'userQuery', 'string']],
  monaco_get_current_user: [],
  monaco_get_field_schemas: [['entity', 'entity', 'string']],
  monaco_list_sequences: LIST_FIELDS,
  monaco_get_sequence: [['sequenceId', 'sequenceId', 'string']],
  monaco_update_sequence: [
    ['sequenceId', 'sequenceId', 'string'],
    ['action', 'sequenceAction', 'string'],
  ],
  monaco_list_audiences: PAGE_FIELDS,
  monaco_get_audience: [['audienceId', 'audienceId', 'string']],
  monaco_list_audience_contacts: [['audienceId', 'audienceId', 'string'], ...PAGE_FIELDS],
  monaco_create_audience: [
    ['name', 'audienceName', 'string'],
    ['contactIds', 'contactIds', 'value'],
    ['filters', 'audienceFilters', 'value'],
    ['excludedIds', 'excludedIds', 'value'],
    ['sourceAudienceId', 'sourceAudienceId', 'string'],
  ],
  monaco_add_audience_contacts: [
    ['audienceId', 'audienceId', 'string'],
    ['contactIds', 'contactIds', 'value'],
  ],
  monaco_remove_audience_contacts: [
    ['audienceId', 'audienceId', 'string'],
    ['contactIds', 'contactIds', 'value'],
  ],
  monaco_list_campaigns: LIST_FIELDS,
  monaco_get_campaign: [['campaignId', 'campaignId', 'string']],
  monaco_enroll_campaign_contacts: [
    ['campaignId', 'campaignId', 'string'],
    ['audienceName', 'audienceName', 'string'],
    ['contactIds', 'contactIds', 'value'],
  ],
  monaco_add_campaign_audiences: [
    ['campaignId', 'campaignId', 'string'],
    ['audienceIds', 'audienceIds', 'value'],
  ],
} as const satisfies Record<string, readonly FieldBinding[]>

type MonacoOperation = keyof typeof OPERATION_FIELDS

/** Every subBlock id and tool param name the mapper may set, cleared before each run. */
const ALL_FIELD_KEYS = [
  ...new Set(
    Object.values(OPERATION_FIELDS).flatMap((bindings: readonly FieldBinding[]) =>
      bindings.flatMap((binding) => [binding[0], binding[1]])
    )
  ),
]

function isMonacoOperation(value: unknown): value is MonacoOperation {
  return typeof value === 'string' && Object.hasOwn(OPERATION_FIELDS, value)
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim())
}

function coerceField(value: unknown, kind: FieldKind, param: string): unknown {
  if (isBlank(value)) return undefined
  if (kind === 'boolean') return toBooleanFromInput(value)
  if (kind === 'number') {
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(parsed)) throw new Error(`${param} must be a number`)
    return parsed
  }
  return value
}

const ops = (...values: MonacoOperation[]) => ({ field: 'operation', value: values })

const LIST_OPERATIONS: MonacoOperation[] = [
  'monaco_list_contacts',
  'monaco_list_accounts',
  'monaco_list_opportunities',
  'monaco_list_tasks',
  'monaco_list_meetings',
  'monaco_list_sequences',
  'monaco_list_campaigns',
]

const PAGED_OPERATIONS: MonacoOperation[] = [
  ...LIST_OPERATIONS,
  'monaco_list_opportunity_contacts',
  'monaco_get_conversation',
  'monaco_list_audiences',
  'monaco_list_audience_contacts',
]

const CONTACT_WRITE_OPERATIONS: MonacoOperation[] = [
  'monaco_create_contact',
  'monaco_update_contact',
  'monaco_upsert_contact',
]

const ACCOUNT_WRITE_OPERATIONS: MonacoOperation[] = [
  'monaco_upsert_account',
  'monaco_update_account',
]

const OPPORTUNITY_WRITE_OPERATIONS: MonacoOperation[] = [
  'monaco_create_opportunity',
  'monaco_update_opportunity',
]

const TASK_WRITE_OPERATIONS: MonacoOperation[] = ['monaco_create_task', 'monaco_update_task']

const BOOLEAN_CHOICES = [
  { label: 'Default', id: '' },
  { label: 'Yes', id: 'true' },
  { label: 'No', id: 'false' },
]

const DATE_WAND = (subject: string) => ({
  enabled: true,
  placeholder: `Describe the ${subject}, e.g. "end of next month"`,
  prompt: `Generate the ${subject} as a calendar date in YYYY-MM-DD format based on the user's description. Return ONLY the date string.`,
  generationType: 'timestamp' as const,
})

const ID_LIST_WAND = (subject: string) => ({
  enabled: true,
  placeholder: `Paste text or data containing the ${subject}`,
  prompt: `Extract the ${subject} from the input. Return ONLY a JSON array of ID strings, with duplicates removed.`,
  generationType: 'json-array' as const,
})

const FILTERS_WAND = {
  enabled: true,
  placeholder:
    'Describe which records to match, e.g. "created this quarter with title containing VP"',
  prompt:
    'Generate a Monaco filter as a JSON array of {"field", "condition", "value"} rules, which are ANDed, or as {"operator": "and" | "or", "filters": [...]} for OR or nested logic. Conditions include is, is_not, equals, contains, not_contains, is_empty, is_not_empty, is_before, and is_after. Use snake_case field keys such as status, created_at, or custom_field_<id>, enum keys rather than display names, and ISO 8601 dates. Return ONLY the JSON.',
  generationType: 'json-value' as const,
}

export const MonacoBlock: BlockConfig = {
  type: 'monaco',
  name: 'Monaco',
  description: 'Manage Monaco CRM records, tasks, meetings, and outreach',
  longDescription:
    'Connect a Monaco API key to read and write contacts, accounts, and opportunities, manage tasks and tags, read meetings, transcripts, and email or LinkedIn conversations, and run outreach by building audiences, enrolling contacts in campaigns, and controlling sequences.',
  docsLink: 'https://docs.sim.ai/integrations/monaco',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#000000',
  icon: MonacoIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Monaco',
    sentences: {
      byOperation: {
        monaco_list_contacts: ['List contacts', { text: 'matching', field: 'filters' }],
        monaco_get_contact: [{ text: 'Get contact', field: 'contactId', core: true }],
        monaco_create_contact: [
          'Create contact',
          { text: 'for', field: 'email' },
          { text: 'or', field: 'linkedinUrl' },
        ],
        monaco_update_contact: [{ text: 'Update contact', field: 'contactId', core: true }],
        monaco_upsert_contact: [
          'Upsert contact',
          { text: 'for', field: 'email' },
          { text: 'or', field: 'linkedinUrl' },
        ],
        monaco_delete_contact: [{ text: 'Delete contact', field: 'contactId', core: true }],
        monaco_list_accounts: ['List accounts', { text: 'matching', field: 'filters' }],
        monaco_get_account: [{ text: 'Get account', field: 'accountId', core: true }],
        monaco_upsert_account: [
          'Upsert account',
          { text: 'for', field: 'domainLookup' },
          { text: 'named', field: 'name' },
        ],
        monaco_update_account: [{ text: 'Update account', field: 'accountId', core: true }],
        monaco_delete_account: [{ text: 'Delete account', field: 'accountId', core: true }],
        monaco_list_opportunities: ['List opportunities', { text: 'matching', field: 'filters' }],
        monaco_get_opportunity: [{ text: 'Get opportunity', field: 'opportunityId', core: true }],
        monaco_create_opportunity: [
          { text: 'Create opportunity', field: 'name', core: true },
          { text: 'on account', field: 'accountId' },
        ],
        monaco_update_opportunity: [
          { text: 'Update opportunity', field: 'opportunityId', core: true },
          { text: 'to stage', field: 'stage' },
        ],
        monaco_delete_opportunity: [
          { text: 'Delete opportunity', field: 'opportunityId', core: true },
        ],
        monaco_list_opportunity_contacts: [
          { text: 'List contacts on opportunity', field: 'opportunityId', core: true },
        ],
        monaco_link_opportunity_contacts: [
          { text: 'Link', field: 'contactIds', core: true },
          { text: 'to opportunity', field: 'opportunityId', core: true },
        ],
        monaco_unlink_opportunity_contacts: [
          { text: 'Unlink', field: 'contactIds', core: true },
          { text: 'from opportunity', field: 'opportunityId', core: true },
        ],
        monaco_list_pipelines: ['List pipelines'],
        monaco_list_tasks: ['List tasks', { text: 'matching', field: 'filters' }],
        monaco_get_task: [{ text: 'Get task', field: 'taskId', core: true }],
        monaco_create_task: [
          { text: 'Create task', field: 'taskTitle', core: true },
          { text: 'due', field: 'dueAt' },
        ],
        monaco_update_task: [
          { text: 'Update task', field: 'taskId', core: true },
          { text: 'to', field: 'taskStatus' },
        ],
        monaco_list_meetings: ['List meetings', { text: 'matching', field: 'filters' }],
        monaco_get_meeting: [{ text: 'Get meeting', field: 'meetingId', core: true }],
        monaco_list_messages: [
          'List messages',
          { text: 'for contact', field: 'contactId' },
          { text: 'for account', field: 'accountId' },
        ],
        monaco_get_conversation: [
          { text: 'Get conversation', field: 'conversationId', core: true },
          { text: 'on', field: 'channel' },
        ],
        monaco_list_tags: [{ text: 'List tags for', field: 'tagObject', core: true }],
        monaco_create_tag: [
          { text: 'Create tag', field: 'tagName', core: true },
          { text: 'for', field: 'tagObject' },
        ],
        monaco_list_users: ['List users', { text: 'matching', field: 'userQuery' }],
        monaco_get_current_user: ['Get the authenticated user'],
        monaco_get_field_schemas: [{ text: 'Get field schemas for', field: 'entity', core: true }],
        monaco_list_sequences: ['List sequences', { text: 'matching', field: 'filters' }],
        monaco_get_sequence: [{ text: 'Get sequence', field: 'sequenceId', core: true }],
        monaco_update_sequence: [
          { text: 'Apply', field: 'sequenceAction', core: true },
          { text: 'to sequence', field: 'sequenceId', core: true },
        ],
        monaco_list_audiences: ['List audiences'],
        monaco_get_audience: [{ text: 'Get audience', field: 'audienceId', core: true }],
        monaco_list_audience_contacts: [
          { text: 'List contacts in audience', field: 'audienceId', core: true },
        ],
        monaco_create_audience: [{ text: 'Create audience', field: 'audienceName', core: true }],
        monaco_add_audience_contacts: [
          { text: 'Add', field: 'contactIds', core: true },
          { text: 'to audience', field: 'audienceId', core: true },
        ],
        monaco_remove_audience_contacts: [
          { text: 'Remove', field: 'contactIds', core: true },
          { text: 'from audience', field: 'audienceId', core: true },
        ],
        monaco_list_campaigns: ['List campaigns', { text: 'matching', field: 'filters' }],
        monaco_get_campaign: [{ text: 'Get campaign', field: 'campaignId', core: true }],
        monaco_enroll_campaign_contacts: [
          { text: 'Enroll', field: 'contactIds', core: true },
          { text: 'in campaign', field: 'campaignId', core: true },
        ],
        monaco_add_campaign_audiences: [
          { text: 'Add', field: 'audienceIds', core: true },
          { text: 'to campaign', field: 'campaignId', core: true },
        ],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Contacts', id: 'monaco_list_contacts' },
        { label: 'Get Contact', id: 'monaco_get_contact' },
        { label: 'Create Contact', id: 'monaco_create_contact' },
        { label: 'Update Contact', id: 'monaco_update_contact' },
        { label: 'Upsert Contact', id: 'monaco_upsert_contact' },
        { label: 'Delete Contact', id: 'monaco_delete_contact' },
        { label: 'List Accounts', id: 'monaco_list_accounts' },
        { label: 'Get Account', id: 'monaco_get_account' },
        { label: 'Upsert Account', id: 'monaco_upsert_account' },
        { label: 'Update Account', id: 'monaco_update_account' },
        { label: 'Delete Account', id: 'monaco_delete_account' },
        { label: 'List Opportunities', id: 'monaco_list_opportunities' },
        { label: 'Get Opportunity', id: 'monaco_get_opportunity' },
        { label: 'Create Opportunity', id: 'monaco_create_opportunity' },
        { label: 'Update Opportunity', id: 'monaco_update_opportunity' },
        { label: 'Delete Opportunity', id: 'monaco_delete_opportunity' },
        { label: 'List Opportunity Contacts', id: 'monaco_list_opportunity_contacts' },
        { label: 'Link Contacts to Opportunity', id: 'monaco_link_opportunity_contacts' },
        { label: 'Unlink Contacts from Opportunity', id: 'monaco_unlink_opportunity_contacts' },
        { label: 'List Pipelines', id: 'monaco_list_pipelines' },
        { label: 'List Tasks', id: 'monaco_list_tasks' },
        { label: 'Get Task', id: 'monaco_get_task' },
        { label: 'Create Task', id: 'monaco_create_task' },
        { label: 'Update Task', id: 'monaco_update_task' },
        { label: 'List Meetings', id: 'monaco_list_meetings' },
        { label: 'Get Meeting', id: 'monaco_get_meeting' },
        { label: 'List Messages', id: 'monaco_list_messages' },
        { label: 'Get Conversation', id: 'monaco_get_conversation' },
        { label: 'List Tags', id: 'monaco_list_tags' },
        { label: 'Create Tag', id: 'monaco_create_tag' },
        { label: 'List Users', id: 'monaco_list_users' },
        { label: 'Get Current User', id: 'monaco_get_current_user' },
        { label: 'Get Field Schemas', id: 'monaco_get_field_schemas' },
        { label: 'List Sequences', id: 'monaco_list_sequences' },
        { label: 'Get Sequence', id: 'monaco_get_sequence' },
        { label: 'Update Sequence', id: 'monaco_update_sequence' },
        { label: 'List Audiences', id: 'monaco_list_audiences' },
        { label: 'Get Audience', id: 'monaco_get_audience' },
        { label: 'List Audience Contacts', id: 'monaco_list_audience_contacts' },
        { label: 'Create Audience', id: 'monaco_create_audience' },
        { label: 'Add Contacts to Audience', id: 'monaco_add_audience_contacts' },
        { label: 'Remove Contacts from Audience', id: 'monaco_remove_audience_contacts' },
        { label: 'List Campaigns', id: 'monaco_list_campaigns' },
        { label: 'Get Campaign', id: 'monaco_get_campaign' },
        { label: 'Enroll Contacts in Campaign', id: 'monaco_enroll_campaign_contacts' },
        { label: 'Add Audiences to Campaign', id: 'monaco_add_campaign_audiences' },
      ],
      value: () => 'monaco_list_contacts',
    },
    {
      id: 'credential',
      title: 'Monaco Account',
      type: 'oauth-input',
      serviceId: 'monaco',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Monaco credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Monaco Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    {
      id: 'contactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Enter contact ID',
      condition: ops(
        'monaco_get_contact',
        'monaco_update_contact',
        'monaco_upsert_contact',
        'monaco_delete_contact',
        'monaco_list_messages'
      ),
      required: ops('monaco_get_contact', 'monaco_update_contact', 'monaco_delete_contact'),
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Enter account ID',
      condition: ops(
        'monaco_get_account',
        'monaco_update_account',
        'monaco_upsert_account',
        'monaco_delete_account',
        'monaco_create_contact',
        'monaco_upsert_contact',
        'monaco_create_opportunity',
        'monaco_create_task',
        'monaco_update_task',
        'monaco_list_messages'
      ),
      required: ops(
        'monaco_get_account',
        'monaco_update_account',
        'monaco_delete_account',
        'monaco_create_opportunity'
      ),
    },
    {
      id: 'opportunityId',
      title: 'Opportunity ID',
      type: 'short-input',
      placeholder: 'Enter opportunity ID',
      condition: ops(
        'monaco_get_opportunity',
        'monaco_update_opportunity',
        'monaco_delete_opportunity',
        'monaco_list_opportunity_contacts',
        'monaco_link_opportunity_contacts',
        'monaco_unlink_opportunity_contacts',
        'monaco_create_task'
      ),
      required: ops(
        'monaco_get_opportunity',
        'monaco_update_opportunity',
        'monaco_delete_opportunity',
        'monaco_list_opportunity_contacts',
        'monaco_link_opportunity_contacts',
        'monaco_unlink_opportunity_contacts'
      ),
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Enter task ID',
      condition: ops('monaco_get_task', 'monaco_update_task'),
      required: true,
    },
    {
      id: 'meetingId',
      title: 'Meeting ID',
      type: 'short-input',
      placeholder: 'Enter meeting ID',
      condition: ops('monaco_get_meeting'),
      required: true,
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'Email thread ID or LinkedIn chat ID from List Messages',
      condition: ops('monaco_get_conversation'),
      required: true,
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'dropdown',
      options: [
        { label: 'Email', id: 'email' },
        { label: 'LinkedIn', id: 'linkedin' },
      ],
      value: () => 'email',
      condition: ops('monaco_get_conversation'),
      required: true,
    },
    {
      id: 'sequenceId',
      title: 'Sequence ID',
      type: 'short-input',
      placeholder: 'Enter sequence ID',
      condition: ops('monaco_get_sequence', 'monaco_update_sequence'),
      required: true,
    },
    {
      id: 'sequenceAction',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Pause', id: 'pause' },
        { label: 'Resume (resumes sending)', id: 'resume' },
        { label: 'Enqueue (queues for sending)', id: 'enqueue' },
        { label: 'Stop (ends as failed)', id: 'stop' },
        { label: 'Exclude (needs review or staged only)', id: 'exclude' },
      ],
      value: () => 'pause',
      condition: ops('monaco_update_sequence'),
      required: true,
    },
    {
      id: 'audienceId',
      title: 'Audience ID',
      type: 'short-input',
      placeholder: 'Enter audience ID',
      condition: ops(
        'monaco_get_audience',
        'monaco_list_audience_contacts',
        'monaco_add_audience_contacts',
        'monaco_remove_audience_contacts'
      ),
      required: true,
    },
    {
      id: 'campaignId',
      title: 'Campaign ID',
      type: 'short-input',
      placeholder: 'Enter campaign ID',
      condition: ops(
        'monaco_get_campaign',
        'monaco_enroll_campaign_contacts',
        'monaco_add_campaign_audiences'
      ),
      required: true,
    },
    {
      id: 'audienceName',
      title: 'Audience Name',
      type: 'short-input',
      placeholder: 'Enter a unique audience name',
      condition: ops('monaco_create_audience', 'monaco_enroll_campaign_contacts'),
      required: true,
    },
    {
      id: 'contactIds',
      title: 'Contact IDs',
      type: 'long-input',
      placeholder: 'Comma-separated contact IDs or a JSON array',
      condition: ops(
        'monaco_link_opportunity_contacts',
        'monaco_unlink_opportunity_contacts',
        'monaco_create_audience',
        'monaco_add_audience_contacts',
        'monaco_remove_audience_contacts',
        'monaco_enroll_campaign_contacts'
      ),
      required: ops(
        'monaco_link_opportunity_contacts',
        'monaco_unlink_opportunity_contacts',
        'monaco_add_audience_contacts',
        'monaco_remove_audience_contacts',
        'monaco_enroll_campaign_contacts'
      ),
      wandConfig: ID_LIST_WAND('Monaco contact IDs'),
    },
    {
      id: 'audienceIds',
      title: 'Audience IDs',
      type: 'long-input',
      placeholder: 'Comma-separated audience IDs or a JSON array',
      condition: ops('monaco_add_campaign_audiences'),
      required: true,
      wandConfig: ID_LIST_WAND('Monaco audience IDs'),
    },
    {
      id: 'audienceFilters',
      title: 'Contact Filters',
      type: 'code',
      language: 'json',
      placeholder: '[{"field": "title", "condition": "contains", "value": "VP"}]',
      condition: ops('monaco_create_audience'),
      wandConfig: FILTERS_WAND,
    },
    {
      id: 'excludedIds',
      title: 'Excluded Contact IDs',
      type: 'long-input',
      placeholder: 'Contact IDs to leave out of the filtered set',
      condition: ops('monaco_create_audience'),
      mode: 'advanced',
      wandConfig: ID_LIST_WAND('Monaco contact IDs to exclude'),
    },
    {
      id: 'sourceAudienceId',
      title: 'Source Audience ID',
      type: 'short-input',
      placeholder: 'Only match contacts already in this audience',
      condition: ops('monaco_create_audience'),
      mode: 'advanced',
    },

    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'name@company.com',
      condition: ops(...CONTACT_WRITE_OPERATIONS),
    },
    {
      id: 'linkedinUrl',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/in/...',
      condition: ops(...CONTACT_WRITE_OPERATIONS, ...ACCOUNT_WRITE_OPERATIONS),
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Enter first name',
      condition: ops(...CONTACT_WRITE_OPERATIONS),
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Enter last name',
      condition: ops(...CONTACT_WRITE_OPERATIONS),
    },
    {
      id: 'title',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Enter job title',
      condition: ops(...CONTACT_WRITE_OPERATIONS),
    },
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+1 555 0100',
      condition: ops(...CONTACT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'company.com',
      condition: ops('monaco_create_contact', 'monaco_upsert_contact'),
      mode: 'advanced',
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'Country name or code',
      condition: ops('monaco_update_contact'),
      mode: 'advanced',
    },
    {
      id: 'jobStartDate',
      title: 'Job Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: ops('monaco_update_contact'),
      mode: 'advanced',
      wandConfig: DATE_WAND("contact's current job start date"),
    },
    {
      id: 'doNotContact',
      title: 'Do Not Contact',
      type: 'dropdown',
      options: BOOLEAN_CHOICES,
      value: () => '',
      condition: ops(...CONTACT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'isInbound',
      title: 'Inbound Lead',
      type: 'switch',
      condition: ops('monaco_create_contact', 'monaco_upsert_contact'),
      mode: 'advanced',
    },

    {
      id: 'domainLookup',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'company.com (finds or creates the account)',
      condition: ops('monaco_upsert_account'),
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Enter name',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS, ...OPPORTUNITY_WRITE_OPERATIONS),
      required: ops('monaco_create_opportunity'),
    },
    {
      id: 'accountStatus',
      title: 'Account Status',
      type: 'short-input',
      placeholder:
        'NEW, PROSPECTING, OPPORTUNITY, CUSTOMER, DISQUALIFIED, NURTURE, INBOUND, CHURNED',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
    },
    {
      id: 'owner',
      title: 'Owner User ID',
      type: 'short-input',
      placeholder: 'User ID from List Users',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'parentAccount',
      title: 'Parent Account ID',
      type: 'short-input',
      placeholder: 'ID of a top-level account',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'ID of the company to link',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'replaceEditedFields',
      title: 'Replace Edited Fields',
      type: 'switch',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'companyDescription',
      title: 'Company Description',
      type: 'long-input',
      placeholder: 'Describe the company',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'employeeCount',
      title: 'Employee Count',
      type: 'short-input',
      placeholder: '250',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'foundedYear',
      title: 'Founded Year',
      type: 'short-input',
      placeholder: '2019',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'estimatedAnnualRevenueUsd',
      title: 'Estimated Annual Revenue (USD)',
      type: 'short-input',
      placeholder: '5000000',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'totalFundingUsd',
      title: 'Total Funding (USD)',
      type: 'short-input',
      placeholder: '12000000',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'lastFundingRound',
      title: 'Last Funding Round',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        ...[
          'pre_seed',
          'seed',
          'angel',
          'series_a',
          'series_b',
          'series_c',
          'series_d',
          'series_e',
          'series_f',
          'series_g',
          'series_h',
          'series_i',
          'series_j',
          'series_unknown',
          'private_equity',
          'debt_financing',
          'convertible_note',
          'grant',
          'non_equity_assistance',
          'corporate_round',
          'equity_crowdfunding',
          'product_crowdfunding',
          'initial_coin_offering',
          'secondary_market',
          'post_ipo_equity',
          'post_ipo_debt',
          'post_ipo_secondary',
          'undisclosed',
        ].map((round) => ({ label: round, id: round })),
      ],
      value: () => '',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'lastFundingDate',
      title: 'Last Funding Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
      wandConfig: DATE_WAND('date of the most recent funding round'),
    },
    {
      id: 'industries',
      title: 'Industries',
      type: 'short-input',
      placeholder: 'Comma-separated industries',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'businessModel',
      title: 'Business Model',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'B2B', id: 'B2B' },
        { label: 'B2C', id: 'B2C' },
      ],
      value: () => '',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'companyStatus',
      title: 'Company Status',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Active', id: 'active' },
        { label: 'Acquired', id: 'acquired' },
        { label: 'Out of Business', id: 'out_of_business' },
        { label: 'IPO', id: 'ipo' },
        { label: 'Unknown', id: 'unknown' },
      ],
      value: () => '',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'domains',
      title: 'Domains',
      type: 'short-input',
      placeholder: 'Complete domain list, primary first (replaces existing)',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'resetFields',
      title: 'Reset Company Fields',
      type: 'short-input',
      placeholder: 'e.g. description, employee_count',
      condition: ops(...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      placeholder: 'City, state, country',
      condition: ops(...CONTACT_WRITE_OPERATIONS, ...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },

    {
      id: 'pipelineId',
      title: 'Pipeline ID',
      type: 'short-input',
      placeholder: 'Pipeline ID from List Pipelines (defaults to the default pipeline)',
      condition: ops('monaco_list_opportunities', ...OPPORTUNITY_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'stage',
      title: 'Stage',
      type: 'short-input',
      placeholder: 'Stage key from List Pipelines',
      condition: ops(...OPPORTUNITY_WRITE_OPERATIONS),
    },
    {
      id: 'stageId',
      title: 'Stage ID',
      type: 'short-input',
      placeholder: 'Stage ID from List Pipelines, instead of a stage key',
      condition: ops(...OPPORTUNITY_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: '50000 (set together with currency)',
      condition: ops(...OPPORTUNITY_WRITE_OPERATIONS),
    },
    {
      id: 'currencyCode',
      title: 'Currency',
      type: 'short-input',
      placeholder: 'USD (set together with amount)',
      condition: ops(...OPPORTUNITY_WRITE_OPERATIONS),
    },
    {
      id: 'estimatedCloseDate',
      title: 'Estimated Close Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: ops(...OPPORTUNITY_WRITE_OPERATIONS),
      wandConfig: DATE_WAND('expected close date'),
    },
    {
      id: 'actualCloseDate',
      title: 'Actual Close Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: ops('monaco_update_opportunity'),
      mode: 'advanced',
      wandConfig: DATE_WAND('date the opportunity closed'),
    },
    {
      id: 'ownerUserId',
      title: 'Owner User ID',
      type: 'short-input',
      placeholder: 'User ID from List Users',
      condition: ops(...OPPORTUNITY_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'idempotencyKey',
      title: 'Idempotency Key',
      type: 'short-input',
      placeholder: 'UUID that prevents duplicate creation',
      condition: ops('monaco_create_opportunity'),
      mode: 'advanced',
    },

    {
      id: 'taskTitle',
      title: 'Task Title',
      type: 'short-input',
      placeholder: 'Enter task title',
      condition: ops(...TASK_WRITE_OPERATIONS),
      required: ops('monaco_create_task'),
    },
    {
      id: 'taskDescription',
      title: 'Task Description',
      type: 'long-input',
      placeholder: 'Describe the task',
      condition: ops(...TASK_WRITE_OPERATIONS),
    },
    {
      id: 'taskType',
      title: 'Task Type',
      type: 'dropdown',
      options: [
        { label: 'Default (General Action Item)', id: '' },
        { label: 'General Action Item', id: 'GENERAL_ACTION_ITEM' },
        { label: 'Email', id: 'EMAIL' },
      ],
      value: () => '',
      condition: ops('monaco_create_task'),
    },
    {
      id: 'taskStatus',
      title: 'Task Status',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'To Do', id: 'TODO' },
        { label: 'Done', id: 'DONE' },
        { label: 'Cancelled', id: 'CANCELLED' },
      ],
      value: () => '',
      condition: ops('monaco_update_task'),
    },
    {
      id: 'dueAt',
      title: 'Due At',
      type: 'short-input',
      placeholder: '2026-01-15T17:00:00Z',
      condition: ops(...TASK_WRITE_OPERATIONS),
      wandConfig: {
        enabled: true,
        placeholder: 'Describe when the task is due, e.g. "Friday at 5pm Pacific"',
        prompt:
          "Generate an ISO 8601 date-time for when the task is due, based on the user's description. Return ONLY the timestamp string.",
        generationType: 'timestamp',
      },
    },
    {
      id: 'assigneeId',
      title: 'Assignee User ID',
      type: 'short-input',
      placeholder: 'User ID from List Users (defaults to the API key owner)',
      condition: ops(...TASK_WRITE_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'messageDraft',
      title: 'Email Draft',
      type: 'code',
      language: 'json',
      placeholder:
        '{"recipients": [{"name": "Ada", "email": "ada@acme.com"}], "subject": "Follow up", "body": "Hi Ada,"}',
      condition: ops(...TASK_WRITE_OPERATIONS),
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the email to draft and who it goes to',
        prompt:
          'Generate a Monaco email task draft as {"recipients": [{"name", "email"}], "cc": [{"name", "email"}], "subject", "body"}. recipients, subject, and body are required; cc is optional; body may be plain text or HTML. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },

    {
      id: 'notes',
      title: 'Notes',
      type: 'long-input',
      placeholder: 'Enter notes',
      condition: ops(
        ...CONTACT_WRITE_OPERATIONS,
        ...ACCOUNT_WRITE_OPERATIONS,
        ...OPPORTUNITY_WRITE_OPERATIONS
      ),
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tag IDs',
      type: 'short-input',
      placeholder: 'Comma-separated tag IDs from List Tags',
      condition: ops(
        ...CONTACT_WRITE_OPERATIONS,
        ...ACCOUNT_WRITE_OPERATIONS,
        ...OPPORTUNITY_WRITE_OPERATIONS
      ),
      mode: 'advanced',
    },
    {
      id: 'customFields',
      title: 'Custom Fields',
      type: 'code',
      language: 'json',
      placeholder: '{"custom_field_<id>": "value"}',
      condition: ops(
        ...CONTACT_WRITE_OPERATIONS,
        ...ACCOUNT_WRITE_OPERATIONS,
        ...OPPORTUNITY_WRITE_OPERATIONS
      ),
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the custom field values to set',
        prompt:
          'Generate a JSON object of Monaco custom field values keyed by their full custom_field_<id> keys from Get Field Schemas. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'clearFields',
      title: 'Clear Fields',
      type: 'short-input',
      placeholder: 'Comma-separated field keys to clear, e.g. title, notes',
      condition: ops('monaco_update_contact', 'monaco_upsert_contact', ...ACCOUNT_WRITE_OPERATIONS),
      mode: 'advanced',
    },

    {
      id: 'tagObject',
      title: 'Object Type',
      type: 'dropdown',
      options: [
        { label: 'Contacts', id: 'contacts' },
        { label: 'Accounts', id: 'accounts' },
        { label: 'Opportunities', id: 'opportunities' },
      ],
      value: () => 'contacts',
      condition: ops('monaco_list_tags', 'monaco_create_tag'),
      required: true,
    },
    {
      id: 'tagName',
      title: 'Tag Name',
      type: 'short-input',
      placeholder: 'Letters, numbers, and spaces only',
      condition: ops('monaco_create_tag'),
      required: true,
    },
    {
      id: 'tagColor',
      title: 'Color',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        ...['green', 'blue', 'red', 'yellow', 'purple', 'berry', 'peach', 'gray'].map((color) => ({
          label: color.charAt(0).toUpperCase() + color.slice(1),
          id: color,
        })),
      ],
      value: () => '',
      condition: ops('monaco_create_tag'),
    },
    {
      id: 'userQuery',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Filter by name or email',
      condition: ops('monaco_list_users'),
    },
    {
      id: 'entity',
      title: 'Entity',
      type: 'dropdown',
      options: [
        { label: 'Contacts', id: 'contacts' },
        { label: 'Accounts', id: 'accounts' },
        { label: 'Opportunities', id: 'opportunities' },
        { label: 'Tasks', id: 'tasks' },
        { label: 'Meetings', id: 'meetings' },
        { label: 'Sequences', id: 'sequences' },
      ],
      value: () => 'contacts',
      condition: ops('monaco_get_field_schemas'),
      required: true,
    },
    {
      id: 'channels',
      title: 'Channels',
      type: 'short-input',
      placeholder: 'email, linkedin (defaults to both)',
      condition: ops('monaco_list_messages'),
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from the previous page',
      condition: ops('monaco_list_messages'),
      mode: 'advanced',
    },

    {
      id: 'filters',
      title: 'Filters',
      type: 'code',
      language: 'json',
      placeholder:
        '[{"field": "created_at", "condition": "is_after", "value": "2026-01-01T00:00:00Z"}]',
      condition: ops(...LIST_OPERATIONS),
      wandConfig: FILTERS_WAND,
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: '-created_at (meetings default to -start_time)',
      condition: ops(...LIST_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'includeCustomFields',
      title: 'Include Custom Fields',
      type: 'dropdown',
      options: BOOLEAN_CHOICES,
      value: () => '',
      condition: ops('monaco_list_contacts', 'monaco_list_accounts', 'monaco_list_opportunities'),
      mode: 'advanced',
    },
    {
      id: 'includeReasoning',
      title: 'Include Custom Field Reasoning',
      type: 'switch',
      condition: ops('monaco_get_contact', 'monaco_get_account', 'monaco_get_opportunity'),
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: ops(...PAGED_OPERATIONS),
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Defaults to the endpoint page size',
      condition: ops(...PAGED_OPERATIONS, 'monaco_list_messages'),
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'monaco_list_contacts',
      'monaco_get_contact',
      'monaco_create_contact',
      'monaco_update_contact',
      'monaco_upsert_contact',
      'monaco_delete_contact',
      'monaco_list_accounts',
      'monaco_get_account',
      'monaco_upsert_account',
      'monaco_update_account',
      'monaco_delete_account',
      'monaco_list_opportunities',
      'monaco_get_opportunity',
      'monaco_create_opportunity',
      'monaco_update_opportunity',
      'monaco_delete_opportunity',
      'monaco_list_opportunity_contacts',
      'monaco_link_opportunity_contacts',
      'monaco_unlink_opportunity_contacts',
      'monaco_list_pipelines',
      'monaco_list_tasks',
      'monaco_get_task',
      'monaco_create_task',
      'monaco_update_task',
      'monaco_list_meetings',
      'monaco_get_meeting',
      'monaco_list_messages',
      'monaco_get_conversation',
      'monaco_list_tags',
      'monaco_create_tag',
      'monaco_list_users',
      'monaco_get_current_user',
      'monaco_get_field_schemas',
      'monaco_list_sequences',
      'monaco_get_sequence',
      'monaco_update_sequence',
      'monaco_list_audiences',
      'monaco_get_audience',
      'monaco_list_audience_contacts',
      'monaco_create_audience',
      'monaco_add_audience_contacts',
      'monaco_remove_audience_contacts',
      'monaco_list_campaigns',
      'monaco_get_campaign',
      'monaco_enroll_campaign_contacts',
      'monaco_add_campaign_audiences',
    ],
    config: {
      tool: (params) => {
        if (!isMonacoOperation(params.operation)) {
          throw new Error(`Invalid Monaco operation: ${String(params.operation)}`)
        }
        return params.operation
      },
      /**
       * Workflow runs pass no context and read subBlock values. Agent tool calls pass the
       * operation in `context` and supply arguments under tool param names, so a param whose
       * subBlock has a different id falls back to the model's value.
       */
      params: (params, context) => {
        const operation = context?.operation ?? params.operation
        const result: Record<string, unknown> = {
          operation: undefined,
          credential: undefined,
          manualCredential: undefined,
          oauthCredential: params.oauthCredential,
        }
        for (const key of ALL_FIELD_KEYS) result[key] = undefined
        if (!isMonacoOperation(operation)) return result
        const bindings: readonly FieldBinding[] = OPERATION_FIELDS[operation]
        for (const [param, field, kind] of bindings) {
          const value = isBlank(params[field]) && context?.operation ? params[param] : params[field]
          result[param] = coerceField(value, kind, param)
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Monaco operation to perform' },
    oauthCredential: { type: 'string', description: 'Saved Monaco API key credential' },
    contactId: { type: 'string', description: 'Contact ID' },
    accountId: { type: 'string', description: 'Account ID' },
    opportunityId: { type: 'string', description: 'Opportunity ID' },
    taskId: { type: 'string', description: 'Task ID' },
    meetingId: { type: 'string', description: 'Meeting ID' },
    conversationId: { type: 'string', description: 'Email thread ID or LinkedIn chat ID' },
    channel: { type: 'string', description: 'Conversation channel (email or linkedin)' },
    sequenceId: { type: 'string', description: 'Sequence ID' },
    sequenceAction: {
      type: 'string',
      description: 'Sequence state transition (pause, resume, enqueue, stop, exclude)',
    },
    audienceId: { type: 'string', description: 'Audience ID' },
    campaignId: { type: 'string', description: 'Campaign ID' },
    audienceName: { type: 'string', description: 'Name of the audience to create' },
    contactIds: { type: 'json', description: 'Contact IDs, as an array or comma-separated list' },
    audienceIds: {
      type: 'json',
      description: 'Audience IDs, as an array or comma-separated list',
    },
    audienceFilters: { type: 'json', description: 'Contact filters that seed a new audience' },
    excludedIds: { type: 'json', description: 'Contact IDs to exclude from the filtered set' },
    sourceAudienceId: {
      type: 'string',
      description: 'Audience whose members the filters are restricted to',
    },
    email: { type: 'string', description: 'Contact email address' },
    linkedinUrl: { type: 'string', description: 'LinkedIn profile or company page URL' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    title: { type: 'string', description: 'Contact job title' },
    phoneNumber: { type: 'string', description: 'Contact phone number' },
    domain: { type: 'string', description: "Domain of the contact's company" },
    country: { type: 'string', description: 'Contact country' },
    jobStartDate: { type: 'string', description: "Start date of the contact's current job" },
    doNotContact: { type: 'string', description: 'Whether the contact opted out of outreach' },
    isInbound: { type: 'boolean', description: 'Whether the contact is an inbound lead' },
    domainLookup: { type: 'string', description: 'Domain used to find or create the account' },
    name: { type: 'string', description: 'Account or opportunity name' },
    accountStatus: { type: 'string', description: 'Account status' },
    owner: { type: 'string', description: 'Account owner user ID' },
    parentAccount: { type: 'string', description: 'Parent account ID' },
    companyId: { type: 'string', description: 'Company ID to link to the account' },
    replaceEditedFields: {
      type: 'boolean',
      description: 'Replace user-edited fields when linking a company',
    },
    companyDescription: { type: 'string', description: 'Company description' },
    employeeCount: { type: 'number', description: 'Number of employees' },
    foundedYear: { type: 'number', description: 'Year the company was founded' },
    estimatedAnnualRevenueUsd: { type: 'number', description: 'Estimated annual revenue in USD' },
    totalFundingUsd: { type: 'number', description: 'Total funding raised in USD' },
    lastFundingRound: { type: 'string', description: 'Most recent funding round type' },
    lastFundingDate: { type: 'string', description: 'Date of the most recent funding round' },
    industries: { type: 'json', description: 'Industries, as an array or comma-separated list' },
    businessModel: { type: 'string', description: 'Business model (B2B or B2C)' },
    companyStatus: { type: 'string', description: 'Company operating status' },
    domains: { type: 'json', description: "The account's complete domain list" },
    resetFields: { type: 'json', description: 'Company fields to reset to the linked company' },
    location: { type: 'string', description: 'Contact location or account headquarters' },
    pipelineId: { type: 'string', description: 'Pipeline ID' },
    stage: { type: 'string', description: 'Opportunity stage key' },
    stageId: { type: 'string', description: 'Opportunity stage ID' },
    amount: { type: 'number', description: 'Opportunity estimated value amount' },
    currencyCode: { type: 'string', description: 'ISO 4217 currency code' },
    estimatedCloseDate: { type: 'string', description: 'Expected close date (YYYY-MM-DD)' },
    actualCloseDate: { type: 'string', description: 'Actual close date (YYYY-MM-DD)' },
    ownerUserId: { type: 'string', description: 'Opportunity owner user ID' },
    idempotencyKey: { type: 'string', description: 'Idempotency key for opportunity creation' },
    taskTitle: { type: 'string', description: 'Task title' },
    taskDescription: { type: 'string', description: 'Task description' },
    taskType: { type: 'string', description: 'Task type (GENERAL_ACTION_ITEM or EMAIL)' },
    taskStatus: { type: 'string', description: 'Task status (TODO, DONE, CANCELLED)' },
    dueAt: { type: 'string', description: 'Task due date and time (ISO 8601)' },
    assigneeId: { type: 'string', description: 'Task assignee user ID' },
    messageDraft: { type: 'json', description: 'Email draft for an EMAIL task' },
    notes: { type: 'string', description: 'Notes on the record' },
    tags: { type: 'json', description: 'Tag IDs, as an array or comma-separated list' },
    customFields: { type: 'json', description: 'Custom field values keyed by custom_field_<id>' },
    clearFields: { type: 'json', description: 'Field keys to clear' },
    tagObject: { type: 'string', description: 'Object type for tags' },
    tagName: { type: 'string', description: 'Tag name' },
    tagColor: { type: 'string', description: 'Tag color' },
    userQuery: { type: 'string', description: 'Name or email substring to filter users' },
    entity: { type: 'string', description: 'Entity to describe field schemas for' },
    channels: { type: 'json', description: 'Message channels to include' },
    cursor: { type: 'string', description: 'Message feed pagination cursor' },
    filters: { type: 'json', description: 'List filters' },
    sort: { type: 'string', description: 'Sort field, prefixed with - for descending' },
    includeCustomFields: { type: 'string', description: 'Include custom fields on list items' },
    includeReasoning: { type: 'boolean', description: 'Return custom field reasoning' },
    page: { type: 'number', description: 'Page number' },
    pageSize: { type: 'number', description: 'Results per page' },
  },

  outputs: {
    contacts: {
      type: 'json',
      description:
        'Contacts [{id, account_id, account_name, first_name, last_name, email, title, phone_number, linkedin_url, location, country, job_start_date, source, do_not_contact, notes, scoring, tags, created_at, updated_at, last_activity_at, last_activity_type, last_outbound_at, last_outbound_type, last_inbound_at, last_inbound_type, custom_fields}]; List Opportunity Contacts returns links instead [{contact_id, source, created_at, email, first_name, last_name, title, account_id}]',
      condition: ops(
        'monaco_list_contacts',
        'monaco_list_audience_contacts',
        'monaco_list_opportunity_contacts'
      ),
    },
    contact: {
      type: 'json',
      description:
        'Contact {id, account_id, account_name, first_name, last_name, email, title, phone_number, linkedin_url, location, country, job_start_date, source, do_not_contact, notes, scoring, tags, created_at, updated_at, last_activity_at, last_activity_type, last_outbound_at, last_outbound_type, last_inbound_at, last_inbound_type, custom_fields}; Get Contact adds heat_score_explanation and Create/Upsert add enrichment_status',
      condition: ops(
        'monaco_get_contact',
        'monaco_create_contact',
        'monaco_update_contact',
        'monaco_upsert_contact'
      ),
    },
    accounts: {
      type: 'json',
      description:
        'Accounts [{id, name, status, owner, parent_account, notes, domains, company, overridden_fields, scoring, tags, created_at, updated_at, last_activity_at, last_activity_type, last_contacted_at, last_contacted_type, last_inbound_at, last_inbound_type, custom_fields}]',
      condition: ops('monaco_list_accounts'),
    },
    account: {
      type: 'json',
      description:
        'Account with the same fields as accounts; Get Account adds heat_score_explanation and Upsert/Update add skipped_domains',
      condition: ops('monaco_get_account', 'monaco_upsert_account', 'monaco_update_account'),
    },
    opportunities: {
      type: 'json',
      description:
        'Opportunities [{id, account_id, name, owner, stage, stage_id, pipeline_id, pipeline_name, estimated_value, estimated_close_date, actual_close_date, summary, risks, notes, tags, contact_ids, last_activity_at, updated_at, created_at, custom_fields}]',
      condition: ops('monaco_list_opportunities'),
    },
    opportunity: {
      type: 'json',
      description: 'Opportunity with the same fields as opportunities',
      condition: ops(
        'monaco_get_opportunity',
        'monaco_create_opportunity',
        'monaco_update_opportunity'
      ),
    },
    pipelines: {
      type: 'json',
      description: 'Pipelines [{id, name, is_default, stages}]',
      condition: ops('monaco_list_pipelines'),
    },
    tasks: {
      type: 'json',
      description:
        'Tasks [{id, account_id, opportunity_id, title, description, task_type, assignee, status, due_at, completed_at, created_at, updated_at, message_draft}]; message_draft is always null in list results',
      condition: ops('monaco_list_tasks'),
    },
    task: {
      type: 'json',
      description:
        'Task {id, account_id, opportunity_id, title, description, task_type, assignee, status, due_at, completed_at, created_at, updated_at, message_draft}',
      condition: ops('monaco_get_task', 'monaco_create_task', 'monaco_update_task'),
    },
    meetings: {
      type: 'json',
      description:
        'Meetings [{id, account_id, account_candidates, opportunity_id, opportunity_candidates, title, description, start_time, end_time, occurred_at, meeting_platform, meeting_url, organizer, attendees, next_actions, created_at, updated_at}]',
      condition: ops('monaco_list_meetings'),
    },
    meeting: {
      type: 'json',
      description:
        'Meeting with the list fields plus ai_premeeting_notes, meeting_summary, video_url, transcript_source, and transcript (speaker-attributed segments; can be very large)',
      condition: ops('monaco_get_meeting'),
    },
    messages: {
      type: 'json',
      description:
        'Messages [{conversation_id, channel, direction, subject, preview, timestamp, contact_id, account_id}], most recent first',
      condition: ops('monaco_list_messages'),
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page of messages, or null on the last page',
      condition: ops('monaco_list_messages'),
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more messages are available',
      condition: ops('monaco_list_messages'),
    },
    conversation: {
      type: 'json',
      description:
        'Conversation {id, channel, subject, participants, account_id, account_candidates, messages, message_pagination}',
      condition: ops('monaco_get_conversation'),
    },
    tags: {
      type: 'json',
      description: 'Tags [{id, name, color}]',
      condition: ops('monaco_list_tags'),
    },
    tag: {
      type: 'json',
      description: 'The created tag {id, name, color}',
      condition: ops('monaco_create_tag'),
    },
    users: {
      type: 'json',
      description: 'Users [{id, first_name, last_name, email, role}]',
      condition: ops('monaco_list_users'),
    },
    currentUser: {
      type: 'json',
      description:
        'Authenticated user {org_id, user_id, user_email, user_first_name, user_last_name, org_name}',
      condition: ops('monaco_get_current_user'),
    },
    fields: {
      type: 'json',
      description:
        'Field schemas [{name, key, type, parent, filterable, sortable, updatable, allowed_operators, custom_field_settings, enum_field_settings}]',
      condition: ops('monaco_get_field_schemas'),
    },
    sequences: {
      type: 'json',
      description:
        'Sequences [{id, contact_id, name, description, status, template_id, created_at, updated_at, last_interaction, enqueued_at, started_at, responded_at, meeting_booked_at, sender_id, sender_name, exclusion_info}]',
      condition: ops('monaco_list_sequences'),
    },
    sequence: {
      type: 'json',
      description: 'Sequence with the list fields plus its ordered tasks (steps)',
      condition: ops('monaco_get_sequence', 'monaco_update_sequence'),
    },
    audiences: {
      type: 'json',
      description: 'Audiences [{id, name, type, status, contact_count, created_at, updated_at}]',
      condition: ops('monaco_list_audiences'),
    },
    audience: {
      type: 'json',
      description: 'Audience {id, name, type, status, contact_count, created_at, updated_at}',
      condition: ops('monaco_get_audience', 'monaco_create_audience'),
    },
    campaigns: {
      type: 'json',
      description:
        'Campaigns [{id, name, status, prioritized, end_date, template_id, template_name, audiences, enrollment_status, created_at, updated_at}]',
      condition: ops('monaco_list_campaigns'),
    },
    campaign: {
      type: 'json',
      description:
        'Campaign with the list fields plus distribution, rules_of_engagement, autopilot_mode, autopilot_settings, and contact_readiness_settings',
      condition: ops('monaco_get_campaign', 'monaco_add_campaign_audiences'),
    },
    pagination: {
      type: 'json',
      description: 'Pagination {page, page_size, total_count, total_pages}',
      condition: ops(...PAGED_OPERATIONS.filter((op) => op !== 'monaco_get_conversation')),
    },
    id: {
      type: 'string',
      description: 'ID of the deleted record',
      condition: ops('monaco_delete_contact', 'monaco_delete_account', 'monaco_delete_opportunity'),
    },
    deleted: {
      type: 'boolean',
      description: 'Whether Monaco deleted the record',
      condition: ops('monaco_delete_contact', 'monaco_delete_account', 'monaco_delete_opportunity'),
    },
    opportunityId: {
      type: 'string',
      description: 'ID of the opportunity the contacts were linked to or unlinked from',
      condition: ops('monaco_link_opportunity_contacts', 'monaco_unlink_opportunity_contacts'),
    },
    contactIds: {
      type: 'json',
      description: 'Contact IDs that were linked or unlinked',
      condition: ops('monaco_link_opportunity_contacts', 'monaco_unlink_opportunity_contacts'),
    },
    audienceId: {
      type: 'string',
      description: 'ID of the audience that was changed',
      condition: ops('monaco_add_audience_contacts', 'monaco_remove_audience_contacts'),
    },
    addedCount: {
      type: 'number',
      description: 'Number of contacts added to the audience',
      condition: ops('monaco_add_audience_contacts'),
    },
    unknownContactIds: {
      type: 'json',
      description: 'Contact IDs Monaco did not recognize',
      condition: ops('monaco_add_audience_contacts'),
    },
    failures: {
      type: 'json',
      description: 'Per-contact failures [{reason, contact_ids}]',
      condition: ops('monaco_add_audience_contacts', 'monaco_remove_audience_contacts'),
    },
    successCount: {
      type: 'number',
      description: 'Number of contacts enrolled',
      condition: ops('monaco_enroll_campaign_contacts'),
    },
    failureCount: {
      type: 'number',
      description: 'Number of contacts that could not be enrolled',
      condition: ops('monaco_enroll_campaign_contacts'),
    },
    failureReasons: {
      type: 'json',
      description: 'Enrollment failure reasons [{code, description, count}]',
      condition: ops('monaco_enroll_campaign_contacts'),
    },
  },
}

export const MonacoBlockMeta = {
  tags: ['sales-engagement', 'automation', 'agentic'],
  url: 'https://www.monaco.com',
  templates: [
    {
      icon: MonacoIcon,
      title: 'Monaco segment outbound',
      prompt:
        'Build a chat workflow that turns a request like "VPs of Sales at Series B fintechs" into Monaco contact filters, lists the matching contacts for my approval, and enrolls the approved contacts in the campaign I name, then reports how many were enrolled and why any failed.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'outreach', 'automation'],
      featured: true,
    },
    {
      icon: MonacoIcon,
      title: 'Monaco meeting prep brief',
      prompt:
        "Create a scheduled workflow that runs each morning, lists today's Monaco meetings, and for each one pulls the account, its open opportunities, and recent email and LinkedIn messages, then posts a prep brief for the meeting owner to Slack.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'meetings', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MonacoIcon,
      title: 'Monaco pipeline hygiene',
      prompt:
        'Build a weekly workflow that finds Monaco opportunities whose estimated close date has passed while they are still open, writes them to a table with owner and stage, and creates a follow-up task for each owner to update or close the deal.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting', 'automation'],
    },
    {
      icon: MonacoIcon,
      title: 'Monaco meeting follow-ups',
      prompt:
        "Create a workflow that reads a finished Monaco meeting's summary, next actions, and transcript, drafts a follow-up email task for the attendees, and records the agreed next step in the opportunity notes.",
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'meetings', 'productivity'],
    },
    {
      icon: MonacoIcon,
      title: 'Monaco inbound lead capture',
      prompt:
        'Build a workflow that takes form submissions, upserts each person as an inbound Monaco contact on the account for their email domain, tags them by source, and opens a task for the account owner to respond within a day.',
      modules: ['workflows'],
      category: 'sales',
      tags: ['sales', 'lead-generation', 'automation'],
    },
    {
      icon: MonacoIcon,
      title: 'Monaco revenue dashboard',
      prompt:
        'Create a scheduled workflow that pages through every Monaco opportunity with its pipeline stages, totals open pipeline value by pipeline and stage, sums estimated value by expected close month, and writes the results to a table for a weekly revenue review.',
      modules: ['scheduled', 'tables', 'agent'],
      category: 'sales',
      tags: ['sales', 'reporting', 'analytics'],
    },
    {
      icon: MonacoIcon,
      title: 'Monaco CRM enrichment sync',
      prompt:
        'Build a workflow that reads companies from a table, upserts each one as a Monaco account by domain with its industry, employee count, and funding details, and records the resulting account IDs and any skipped domains back in the table.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment', 'automation'],
    },
    {
      icon: MonacoIcon,
      title: 'Monaco sequence review',
      prompt:
        'Create an agent that lists Monaco sequences waiting for review, reads each one with its steps and the contact it targets, and excludes the ones that look off-target after the sales lead approves, summarizing each decision.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'outreach', 'review'],
    },
  ],
  skills: [
    {
      name: 'build-outbound-segment',
      description:
        'Turn a target segment description into a Monaco audience and attach it to a campaign.',
      content:
        '# Build Outbound Segment\n\nTarget a new segment from Monaco contacts and start outreach.\n\n## Steps\n1. Run Get Field Schemas for contacts to learn the filterable fields, their conditions, and enum keys.\n2. Translate the segment into a filters array, using enum keys rather than display names.\n3. Run List Contacts with those filters and confirm the match count with the user before sending anything.\n4. Run Create Audience with the same filters and a short, unique name.\n5. Run Add Audiences to Campaign for an active or paused campaign the user named. This starts real outreach, and Monaco enrolls the contacts asynchronously.\n\n## Output\nReturn the filters used, the audience ID and size, the campaign it was attached to, and its enrollment_status. Never enroll contacts the user did not approve.',
    },
    {
      name: 'prepare-account-brief',
      description:
        'Summarize an account before a meeting: open opportunities, engaged contacts, recent meetings, and messages.',
      content:
        "# Prepare Account Brief\n\nGive a seller one view of an account before they meet it.\n\n## Steps\n1. Run Get Account for the account, or find it with List Accounts filtered by domain.\n2. Run List Opportunities filtered by account_id and keep the open ones with their stage, value, close date, summary, and risks.\n3. Run List Meetings filtered to the account and read the latest with Get Meeting for its summary and next actions.\n4. Run List Messages for the account to see the most recent email and LinkedIn exchanges.\n\n## Output\nReturn a short brief: account snapshot, open deals with risks, last meeting's outcome and next actions, recent conversations, and open questions. Quote Monaco's data rather than guessing.",
    },
    {
      name: 'clean-up-pipeline',
      description:
        'Find Monaco opportunities with slipped close dates or stalled stages and fix or flag them.',
      content:
        '# Clean Up Pipeline\n\nKeep the Monaco pipeline accurate.\n\n## Steps\n1. Run List Pipelines to learn each pipeline and its stage keys.\n2. Run List Opportunities filtered by estimated_close_date before today and an open stage.\n3. Confirm the list and the intended change with the user.\n4. Run Update Opportunity for each approved deal to move its stage, close date, or notes. Set amount and currency together.\n5. Create a task for the owner of any deal that needs a human decision.\n\n## Output\nReturn each opportunity reviewed, what changed, and which owners received tasks.',
    },
    {
      name: 'follow-up-after-meeting',
      description:
        'Turn a recorded Monaco meeting into follow-up tasks and an updated opportunity.',
      content:
        '# Follow Up After Meeting\n\nCapture what a meeting decided while it is fresh.\n\n## Steps\n1. Run Get Meeting and read meeting_summary, next_actions, attendees, and opportunity_candidates.\n2. Draft a follow-up email that restates the agreed next steps, and create it with Create Task as an EMAIL task with a message draft.\n3. Run Update Opportunity on the linked opportunity to record the next step in its notes and adjust the stage if the meeting moved it.\n\n## Output\nReturn the task created, the opportunity changes, and any next actions no one owns yet.',
    },
    {
      name: 'capture-inbound-lead',
      description: 'Record an inbound lead in Monaco and route it to the right owner.',
      content:
        "# Capture Inbound Lead\n\nGet a new inbound lead into Monaco without duplicates.\n\n## Steps\n1. Run Upsert Contact with the lead's email, name, title, and company domain, with Inbound Lead set.\n2. Run Get Account on the contact's account_id to find its owner.\n3. Run Create Task assigned to that owner with a due time within one business day.\n\n## Output\nReturn the contact and account IDs, its enrichment status, and the task created for the owner.",
    },
    {
      name: 'compute-revenue-metrics',
      description:
        'Page Monaco opportunities and total pipeline value by stage and by expected close month.',
      content:
        '# Compute Revenue Metrics\n\nBuild revenue metrics from Monaco opportunities.\n\n## Steps\n1. Run List Pipelines for each pipeline and its stage keys.\n2. Page List Opportunities with page_size 500 until page reaches total_pages, keeping pipeline, stage, estimated_value, and close dates.\n3. Total estimated value by pipeline and stage, and by expected close month. Monaco stages carry no win probability or won/lost flag, so ask the user which stages count as won or lost, and for any stage weights, before computing win rate or weighted pipeline.\n\n## Output\nReturn the metric table and the counts it was computed from. Mention opportunities without an estimated value instead of treating them as zero.',
    },
    {
      name: 'review-pending-sequences',
      description:
        'Review Monaco sequences that are waiting for approval and pause or exclude off-target ones.',
      content:
        "# Review Pending Sequences\n\nCheck automated outreach before it sends.\n\n## Steps\n1. Run List Sequences filtered to sequences that need review or are staged.\n2. Run Get Sequence for each to read its steps and the contact it targets, and Get Contact for that contact's title and account.\n3. Recommend excluding any that do not fit the ideal customer profile, and apply only the exclusions the user approves with the exclude action of Update Sequence.\n\n## Output\nReturn each sequence reviewed, the decision, and the reason. Never resume or enqueue a sequence without explicit approval, since that sends messages.",
    },
  ],
} as const satisfies BlockMeta
