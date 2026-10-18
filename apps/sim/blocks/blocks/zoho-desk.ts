import { isRecordLike } from '@sim/utils/object'
import { ZohoDeskIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

/** Both members of the `orgId` canonical pair, so the clause survives advanced mode. */
const ORG_FIELD = ['orgId', 'manualOrgId']

/** Operations that require an organization to be selected. */
const OPERATIONS_NEEDING_ORG = [
  'list_tickets',
  'get_ticket',
  'update_ticket',
  'list_comments',
  'add_comment',
  'list_threads',
  'get_thread',
  'get_contact',
  'get_attachment',
  'create_ticket',
  'search_tickets',
  'move_ticket',
  'send_reply',
  'list_contacts',
  'create_contact',
  'update_contact',
  'search_contacts',
  'list_accounts',
  'create_account',
  'update_account',
  'search_accounts',
  'get_account',
  'list_departments',
  'get_department',
  'list_agents',
  'get_agent',
  'get_comment',
  'update_comment',
  'delete_comment',
]

/**
 * Collapse the three "not supplied" shapes to `undefined`. The workflow
 * serializer initializes untouched subBlocks to `null`, and a cleared field
 * arrives as `''`; both mean the same thing as absent.
 */
function orUndefined(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  return value
}

/**
 * Coerce a pagination input to an integer at or above `min`, or `undefined`.
 * Anything out of range is discarded rather than forwarded: Zoho answers a
 * negative or fractional index with an opaque provider error.
 */
function toPaginationValue(value: unknown, min: number): number | undefined {
  const resolved = orUndefined(value)
  if (resolved === undefined) return undefined
  const parsed = Number(resolved)
  return Number.isInteger(parsed) && parsed >= min ? parsed : undefined
}

/**
 * Accept the custom-field map as either an object (an agent supplying it
 * directly) or the JSON text the subBlock stores. Anything unparseable fails
 * loudly rather than reaching Zoho as a string it would silently ignore.
 */
function parseCustomFields(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined
  let parsed = value
  if (typeof value === 'string') {
    if (!value.trim()) return undefined
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('Invalid JSON provided for custom fields')
    }
  }
  if (!isRecordLike(parsed)) throw new Error('Custom fields must be a JSON object')
  return parsed
}

const ADDITIONAL_OPERATION_FIELDS: Record<
  string,
  Record<string, { type: string; omitEmpty?: boolean }>
> = {
  create_ticket: {
    productId: { type: 'string' },
    phone: { type: 'string' },
    subject: { type: 'string' },
    dueDate: { type: 'string' },
    channel: { type: 'string' },
    language: { type: 'string' },
    priority: { type: 'string' },
    assigneeId: { type: 'string' },
    email: { type: 'string' },
    subCategory: { type: 'string' },
    customFields: { type: 'json' },
    description: { type: 'string' },
    classification: { type: 'string' },
    category: { type: 'string' },
    status: { type: 'string' },
    contactId: { type: 'string' },
    departmentId: { type: 'string' },
    contact: { type: 'json' },
    uploads: { type: 'array' },
    resolution: { type: 'string' },
    webUrl: { type: 'string' },
    sharedDepartments: { type: 'array' },
    teamId: { type: 'string' },
    secondaryContacts: { type: 'array' },
    entitySkills: { type: 'array' },
  },
  search_tickets: {
    email: { type: 'string' },
    phone: { type: 'string' },
    ticketNumber: { type: 'string' },
    accountName: { type: 'string' },
    subject: { type: 'string' },
    departmentId: { type: 'string' },
    productName: { type: 'string' },
    _all: { type: 'string' },
    limit: { type: 'number' },
    from: { type: 'number' },
    dueDateRange: { type: 'string' },
    id: { type: 'string' },
    productId: { type: 'string' },
    contactId: { type: 'string' },
    createdTimeRange: { type: 'string' },
    priority: { type: 'string' },
    assigneeId: { type: 'string' },
    accountId: { type: 'string' },
    modifiedTimeRange: { type: 'string' },
    status: { type: 'string' },
    customField1: { type: 'string' },
    customField2: { type: 'string' },
    customField3: { type: 'string' },
    customField4: { type: 'string' },
    customField5: { type: 'string' },
    customField6: { type: 'string' },
    customField7: { type: 'string' },
    customField8: { type: 'string' },
    customField9: { type: 'string' },
    customField10: { type: 'string' },
    channel: { type: 'string' },
    customerResponseTimeRange: { type: 'string' },
    description: { type: 'string' },
    sortBy: { type: 'string' },
    tag: { type: 'string' },
    contactName: { type: 'string' },
    category: { type: 'string' },
  },
  move_ticket: {
    ticketId: { type: 'string' },
    departmentId: { type: 'string' },
    forumId: { type: 'string' },
  },
  send_reply: {
    isPrivate: { type: 'boolean' },
    sendImmediately: { type: 'boolean' },
    ticketId: { type: 'string' },
    content: { type: 'string' },
    contentType: { type: 'string', omitEmpty: true },
    inReplyToThreadId: { type: 'string' },
    direction: { type: 'string', omitEmpty: true },
    cc: { type: 'string' },
    bcc: { type: 'string' },
    hasAttach: { type: 'boolean' },
    ticketStatus: { type: 'string' },
    attachmentIds: { type: 'array' },
    to: { type: 'string' },
    fromEmailAddress: { type: 'string' },
    isForward: { type: 'boolean' },
  },
  list_contacts: {
    fields: { type: 'string' },
    viewId: { type: 'string' },
    limit: { type: 'number' },
    from: { type: 'number' },
    include: { type: 'string' },
    sortBy: { type: 'string' },
  },
  create_contact: {
    lastName: { type: 'string' },
    accountId: { type: 'string' },
    firstName: { type: 'string' },
    secondaryEmail: { type: 'string' },
    phone: { type: 'string' },
    mobile: { type: 'string' },
    ownerId: { type: 'string' },
    type: { type: 'string' },
    email: { type: 'string' },
    zip: { type: 'string' },
    country: { type: 'string' },
    twitter: { type: 'string' },
    customFields: { type: 'json' },
    city: { type: 'string' },
    street: { type: 'string' },
    facebook: { type: 'string' },
    description: { type: 'string' },
    state: { type: 'string' },
    title: { type: 'string' },
    language: { type: 'string' },
  },
  update_contact: {
    contactId: { type: 'string' },
    lastName: { type: 'string' },
    accountId: { type: 'string' },
    firstName: { type: 'string' },
    secondaryEmail: { type: 'string' },
    phone: { type: 'string' },
    mobile: { type: 'string' },
    ownerId: { type: 'string' },
    type: { type: 'string' },
    email: { type: 'string' },
    zip: { type: 'string' },
    country: { type: 'string' },
    twitter: { type: 'string' },
    customFields: { type: 'json' },
    city: { type: 'string' },
    street: { type: 'string' },
    facebook: { type: 'string' },
    description: { type: 'string' },
    state: { type: 'string' },
    title: { type: 'string' },
    language: { type: 'string' },
  },
  search_contacts: {
    email: { type: 'string' },
    phone: { type: 'string' },
    mobile: { type: 'string' },
    accountName: { type: 'string' },
    createdTimeRange: { type: 'string' },
    limit: { type: 'number' },
    from: { type: 'number' },
    modifiedTimeRange: { type: 'string' },
    id: { type: 'string' },
    _all: { type: 'string' },
    customField1: { type: 'string' },
    customField2: { type: 'string' },
    customField3: { type: 'string' },
    customField4: { type: 'string' },
    customField5: { type: 'string' },
    customField6: { type: 'string' },
    customField7: { type: 'string' },
    customField8: { type: 'string' },
    customField9: { type: 'string' },
    customField10: { type: 'string' },
    lastName: { type: 'string' },
    firstName: { type: 'string' },
    fullName: { type: 'string' },
    sortBy: { type: 'string' },
  },
  list_accounts: {
    viewId: { type: 'string' },
    limit: { type: 'number' },
    from: { type: 'number' },
    sortBy: { type: 'string' },
    fields: { type: 'string' },
  },
  create_account: {
    website: { type: 'string' },
    accountName: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string' },
    country: { type: 'string' },
    code: { type: 'string' },
    customFields: { type: 'json' },
    city: { type: 'string' },
    street: { type: 'string' },
    annualrevenue: { type: 'number' },
    description: { type: 'string' },
    industry: { type: 'string' },
    state: { type: 'string' },
    ownerId: { type: 'string' },
    fax: { type: 'string' },
    associatedSLAIds: { type: 'array' },
  },
  update_account: {
    accountId: { type: 'string' },
    website: { type: 'string' },
    accountName: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string' },
    country: { type: 'string' },
    code: { type: 'string' },
    customFields: { type: 'json' },
    city: { type: 'string' },
    street: { type: 'string' },
    annualrevenue: { type: 'number' },
    description: { type: 'string' },
    industry: { type: 'string' },
    state: { type: 'string' },
    ownerId: { type: 'string' },
    fax: { type: 'string' },
    associatedSLAIds: { type: 'array' },
  },
  search_accounts: {
    accountName: { type: 'string' },
    createdTimeRange: { type: 'string' },
    limit: { type: 'number' },
    from: { type: 'number' },
    modifiedTimeRange: { type: 'string' },
    id: { type: 'string' },
    _all: { type: 'string' },
    customField1: { type: 'string' },
    customField2: { type: 'string' },
    customField3: { type: 'string' },
    customField4: { type: 'string' },
    customField5: { type: 'string' },
    customField6: { type: 'string' },
    customField7: { type: 'string' },
    customField8: { type: 'string' },
    customField9: { type: 'string' },
    customField10: { type: 'string' },
    sortBy: { type: 'string' },
  },
  get_account: {
    include: { type: 'string' },
    accountId: { type: 'string' },
  },
  list_departments: {
    chatStatus: { type: 'string' },
    searchStr: { type: 'string' },
    isEnabled: { type: 'boolean' },
    limit: { type: 'number' },
    from: { type: 'number' },
  },
  get_department: { departmentId: { type: 'string' } },
  list_agents: {
    include: { type: 'string' },
    roleIds: { type: 'string' },
    searchStr: { type: 'string' },
    cfSearchStr: { type: 'string' },
    cfFieldName: { type: 'string' },
    fieldName: { type: 'string' },
    isLightAgent: { type: 'boolean' },
    sortOrder: { type: 'string' },
    limit: { type: 'number' },
    rolePermissionType: { type: 'string' },
    profileIds: { type: 'string' },
    from: { type: 'number' },
    isConfirmed: { type: 'boolean' },
    departmentIds: { type: 'string' },
    status: { type: 'string' },
  },
  get_agent: {
    include: { type: 'string' },
    agentId: { type: 'string' },
  },
  get_comment: {
    include: { type: 'string' },
    commentId: { type: 'string' },
    ticketId: { type: 'string' },
  },
  update_comment: {
    commentId: { type: 'string' },
    ticketId: { type: 'string' },
    content: { type: 'string' },
    attachmentIds: { type: 'array' },
    contentType: { type: 'string', omitEmpty: true },
  },
  delete_comment: {
    commentId: { type: 'string' },
    ticketId: { type: 'string' },
  },
}

const LEGACY_AGENT_ALIASES: Record<string, string> = {
  statusFilter: 'status',
  priorityFilter: 'priority',
  assigneeFilter: 'assignee',
  channelFilter: 'channel',
  commentSortBy: 'sortBy',
  threadSortBy: 'sortBy',
  ticketInclude: 'include',
  contactInclude: 'include',
  threadInclude: 'include',
}

const AGENT_PARAM_TYPES: Record<string, { type: string; omitEmpty?: boolean }> = {
  ...Object.assign({}, ...Object.values(ADDITIONAL_OPERATION_FIELDS)),
  isPublic: { type: 'boolean' },
  disableClosureNotification: { type: 'boolean' },
  receivedInDays: { type: 'number' },
}

function normalizeParam(
  name: string,
  value: unknown,
  config: { type: string; omitEmpty?: boolean }
): unknown {
  if (value === undefined || value === null || (config.omitEmpty && value === '')) return undefined
  if (name === 'departmentIds' && Array.isArray(value))
    return value.map(String).join(',') || undefined
  if (config.type === 'number') return value === '' ? undefined : Number(value)
  if (config.type === 'boolean')
    return value === '' ? undefined : value === true || value === 'true'
  return value
}

export const ZohoDeskBlock: BlockConfig = {
  type: 'zoho_desk',
  name: 'Zoho Desk',
  description: 'Manage Zoho Desk tickets, replies, contacts, and accounts',
  authMode: AuthMode.OAuth,
  triggerAllowed: true,
  longDescription:
    'Create, search, and update Zoho Desk tickets, contacts, and accounts; send email replies, manage comments, inspect departments and agents, and download attachments. Trigger workflows from Zoho Desk webhook events.',
  docsLink: 'https://docs.sim.ai/integrations/zoho_desk',
  category: 'tools',
  integrationType: IntegrationType.Support,
  bgColor: '#FFFFFF',
  icon: ZohoDeskIcon,
  canvasPresentation: {
    defaultTitle: 'Zoho Desk',
    sentences: {
      byOperation: {
        /* `orgId` is a canonical pair — naming only the basic-mode selector
           would drop the clause for every advanced-mode user. */
        list_tickets: [
          { text: 'List tickets in', field: ORG_FIELD, core: true },
          { text: ', with status', field: 'statusFilter' },
          { text: ', at priority', field: 'priorityFilter' },
          { text: ', assigned to', field: 'assigneeFilter' },
        ],
        get_ticket: [{ text: 'Get ticket', field: 'ticketId', core: true }],
        update_ticket: [
          { text: 'Update ticket', field: 'ticketId', core: true },
          { text: ', setting subject to', field: 'subject' },
          { text: ', with status', field: 'status' },
          { text: ', at priority', field: 'priority' },
        ],
        list_comments: [{ text: 'List comments on ticket', field: 'ticketId', core: true }],
        add_comment: [
          { text: 'Comment', field: 'content', core: true },
          { text: 'on ticket', field: 'ticketId', core: true },
        ],
        list_threads: [{ text: 'List threads on ticket', field: 'ticketId', core: true }],
        get_thread: [
          { text: 'Get thread', field: 'threadId', core: true },
          { text: 'on ticket', field: 'ticketId', core: true },
        ],
        get_contact: [{ text: 'Get contact', field: 'contactId', core: true }],
        /* Anchored on `href`, not `fileName`: the latter is advanced-only and
           optional, so a basic-mode card would paint an empty sentence. */
        get_attachment: [
          { text: 'Download attachment', field: 'href', core: true },
          { text: 'as', field: 'fileName' },
        ],
        list_organizations: ['List organizations'],
        create_ticket: [{ text: 'Create ticket', field: 'subject', core: true }],
        search_tickets: ['Search Tickets'],
        move_ticket: [
          { text: 'Move ticket', field: 'ticketId', core: true },
          { text: 'to department', field: ['departmentId', 'manualDepartmentId'], core: true },
        ],
        send_reply: [{ text: 'Reply to ticket', field: 'ticketId', core: true }],
        list_contacts: ['List Contacts'],
        create_contact: [{ text: 'Create Contact', field: 'lastName', core: true }],
        update_contact: [{ text: 'Update Contact', field: 'contactId', core: true }],
        search_contacts: ['Search Contacts'],
        list_accounts: ['List Accounts'],
        create_account: [{ text: 'Create Account', field: 'accountName', core: true }],
        update_account: [{ text: 'Update Account', field: 'accountId', core: true }],
        search_accounts: ['Search Accounts'],
        get_account: [{ text: 'Get Account', field: 'accountId', core: true }],
        list_departments: ['List Departments'],
        get_department: [
          { text: 'Get Department', field: ['departmentId', 'manualDepartmentId'], core: true },
        ],
        list_agents: ['List Agents'],
        get_agent: [{ text: 'Get Agent', field: 'agentId', core: true }],
        get_comment: [
          { text: 'Get Comment', field: 'commentId', core: true },
          { text: 'on ticket', field: 'ticketId', core: true },
        ],
        update_comment: [
          { text: 'Update Comment', field: 'commentId', core: true },
          { text: 'on ticket', field: 'ticketId', core: true },
        ],
        delete_comment: [
          { text: 'Delete Comment', field: 'commentId', core: true },
          { text: 'on ticket', field: 'ticketId', core: true },
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
        { label: 'List Tickets', id: 'list_tickets' },
        { label: 'Get Ticket', id: 'get_ticket' },
        { label: 'Update Ticket', id: 'update_ticket' },
        { label: 'List Comments', id: 'list_comments' },
        { label: 'Add Comment', id: 'add_comment' },
        { label: 'List Threads', id: 'list_threads' },
        { label: 'Get Thread', id: 'get_thread' },
        { label: 'Get Contact', id: 'get_contact' },
        { label: 'Get Attachment', id: 'get_attachment' },
        { label: 'List Organizations', id: 'list_organizations' },
        { label: 'Create Ticket', id: 'create_ticket' },
        { label: 'Search Tickets', id: 'search_tickets' },
        { label: 'Move Ticket', id: 'move_ticket' },
        { label: 'Send Reply', id: 'send_reply' },
        { label: 'List Contacts', id: 'list_contacts' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Search Contacts', id: 'search_contacts' },
        { label: 'List Accounts', id: 'list_accounts' },
        { label: 'Create Account', id: 'create_account' },
        { label: 'Update Account', id: 'update_account' },
        { label: 'Search Accounts', id: 'search_accounts' },
        { label: 'Get Account', id: 'get_account' },
        { label: 'List Departments', id: 'list_departments' },
        { label: 'Get Department', id: 'get_department' },
        { label: 'List Agents', id: 'list_agents' },
        { label: 'Get Agent', id: 'get_agent' },
        { label: 'Get Comment', id: 'get_comment' },
        { label: 'Update Comment', id: 'update_comment' },
        { label: 'Delete Comment', id: 'delete_comment' },
      ],
      value: () => 'list_tickets',
    },
    {
      id: 'credential',
      title: 'Zoho Desk Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'zoho-desk',
      requiredScopes: getScopesForService('zoho-desk'),
      placeholder: 'Select Zoho Desk account',
    },
    {
      id: 'manualCredential',
      title: 'Zoho Desk Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'orgId',
      title: 'Organization',
      type: 'project-selector',
      canonicalParamId: 'orgId',
      serviceId: 'zoho-desk',
      selectorKey: 'zoho_desk.organizations',
      placeholder: 'Select an organization',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: OPERATIONS_NEEDING_ORG },
      required: { field: 'operation', value: OPERATIONS_NEEDING_ORG },
    },
    {
      id: 'manualOrgId',
      title: 'Organization ID',
      type: 'short-input',
      canonicalParamId: 'orgId',
      placeholder: 'Enter organization ID',
      mode: 'advanced',
      condition: { field: 'operation', value: OPERATIONS_NEEDING_ORG },
      required: { field: 'operation', value: OPERATIONS_NEEDING_ORG },
    },
    {
      id: 'ticketId',
      title: 'Ticket ID',
      type: 'short-input',
      placeholder: 'Enter ticket ID',
      condition: {
        field: 'operation',
        value: [
          'get_ticket',
          'update_ticket',
          'list_comments',
          'add_comment',
          'list_threads',
          'get_thread',
          'move_ticket',
          'send_reply',
          'get_comment',
          'update_comment',
          'delete_comment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_ticket',
          'update_ticket',
          'list_comments',
          'add_comment',
          'list_threads',
          'get_thread',
          'move_ticket',
          'send_reply',
          'get_comment',
          'update_comment',
          'delete_comment',
        ],
      },
    },
    {
      id: 'threadId',
      title: 'Thread ID',
      type: 'short-input',
      placeholder: 'Enter thread ID',
      condition: { field: 'operation', value: 'get_thread' },
      required: { field: 'operation', value: 'get_thread' },
    },
    {
      id: 'contactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Enter contact ID',
      condition: {
        field: 'operation',
        value: [
          'get_contact',
          'create_ticket',
          'search_tickets',
          'update_contact',
          'update_ticket',
        ],
      },
      required: { field: 'operation', value: ['get_contact', 'update_contact'] },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Comment content',
      condition: { field: 'operation', value: ['add_comment', 'send_reply', 'update_comment'] },
      required: { field: 'operation', value: ['add_comment', 'send_reply'] },
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Plain text', id: 'plainText' },
        { label: 'HTML', id: 'html' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: ['add_comment', 'send_reply', 'update_comment'] },
    },
    {
      id: 'isPublic',
      title: 'Public Comment',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'add_comment' },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Ticket subject',
      condition: {
        field: 'operation',
        value: ['update_ticket', 'create_ticket', 'search_tickets'],
      },
      required: { field: 'operation', value: ['create_ticket'] },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      placeholder: 'Status',
      condition: {
        field: 'operation',
        value: ['update_ticket', 'create_ticket', 'search_tickets', 'list_agents'],
      },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'Priority',
      condition: {
        field: 'operation',
        value: ['update_ticket', 'create_ticket', 'search_tickets'],
      },
    },
    {
      id: 'statusFilter',
      paramVisibility: 'user-or-llm',
      title: 'Status',
      type: 'short-input',
      placeholder: 'Filter, e.g. Open,On Hold',
      condition: { field: 'operation', value: 'list_tickets' },
    },
    {
      id: 'priorityFilter',
      paramVisibility: 'user-or-llm',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'Filter, e.g. High,Urgent',
      condition: { field: 'operation', value: 'list_tickets' },
    },
    {
      id: 'assigneeFilter',
      title: 'Assignee',
      type: 'short-input',
      placeholder: 'Filter, e.g. Unassigned',
      condition: { field: 'operation', value: 'list_tickets' },
      mode: 'advanced',
    },
    {
      id: 'channelFilter',
      paramVisibility: 'user-or-llm',
      title: 'Channel',
      type: 'short-input',
      placeholder: 'Filter, e.g. Email,Web',
      condition: { field: 'operation', value: 'list_tickets' },
      mode: 'advanced',
    },
    {
      id: 'receivedInDays',
      title: 'Customer Responded Within',
      type: 'dropdown',
      // "Any time" is required, not cosmetic: a dropdown with no empty option
      // seeds its first option into the store on mount, so merely opening the
      // advanced fields would pin every List Tickets run to a 15-day
      // customer-response window with no way to clear it.
      options: [
        { label: 'Any time', id: '' },
        { label: 'Last 15 days', id: '15' },
        { label: 'Last 30 days', id: '30' },
        { label: 'Last 90 days', id: '90' },
      ],
      condition: { field: 'operation', value: 'list_tickets' },
      mode: 'advanced',
    },
    {
      id: 'assigneeId',
      title: 'Assignee',
      type: 'project-selector',
      canonicalParamId: 'assigneeId',
      serviceId: 'zoho-desk',
      selectorKey: 'zoho_desk.agents',
      placeholder: 'Assign the ticket to this agent',
      dependsOn: ['credential', 'orgId'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['update_ticket', 'create_ticket', 'search_tickets'],
      },
    },
    {
      id: 'manualAssigneeId',
      title: 'Assignee ID',
      type: 'short-input',
      canonicalParamId: 'assigneeId',
      placeholder: 'Agent ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['update_ticket', 'create_ticket', 'search_tickets'],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Description',
      condition: {
        field: 'operation',
        value: [
          'update_ticket',
          'create_ticket',
          'search_tickets',
          'create_contact',
          'update_contact',
          'create_account',
          'update_account',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'long-input',
      placeholder: 'Resolution notes',
      condition: { field: 'operation', value: ['update_ticket', 'create_ticket'] },
      mode: 'advanced',
    },
    {
      id: 'classification',
      title: 'Classification',
      type: 'short-input',
      placeholder: 'e.g. Problem, Request, Question',
      condition: { field: 'operation', value: ['update_ticket', 'create_ticket'] },
      mode: 'advanced',
    },
    {
      id: 'departmentId',
      title: 'Department',
      type: 'project-selector',
      canonicalParamId: 'departmentId',
      serviceId: 'zoho-desk',
      selectorKey: 'zoho_desk.departments',
      placeholder: 'Move ticket to this department',
      dependsOn: ['credential', 'orgId'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'update_ticket',
          'create_ticket',
          'search_tickets',
          'move_ticket',
          'get_department',
        ],
      },
      required: { field: 'operation', value: ['create_ticket', 'move_ticket', 'get_department'] },
    },
    {
      id: 'manualDepartmentId',
      title: 'Department ID',
      type: 'short-input',
      canonicalParamId: 'departmentId',
      placeholder: 'Move ticket to this department',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'update_ticket',
          'create_ticket',
          'search_tickets',
          'move_ticket',
          'get_department',
        ],
      },
      required: { field: 'operation', value: ['create_ticket', 'move_ticket', 'get_department'] },
    },
    {
      id: 'category',
      title: 'Category',
      type: 'short-input',
      placeholder: 'Ticket category',
      condition: {
        field: 'operation',
        value: ['update_ticket', 'create_ticket', 'search_tickets'],
      },
      mode: 'advanced',
    },
    {
      id: 'subCategory',
      title: 'Sub-category',
      type: 'short-input',
      placeholder: 'Ticket sub-category',
      condition: { field: 'operation', value: ['update_ticket', 'create_ticket'] },
      mode: 'advanced',
    },
    {
      id: 'dueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: { field: 'operation', value: ['update_ticket', 'create_ticket'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'customFields',
      title: 'Custom Fields',
      type: 'long-input',
      placeholder: '{"cf_field": "value"}',
      condition: {
        field: 'operation',
        value: [
          'update_ticket',
          'create_ticket',
          'create_contact',
          'update_contact',
          'create_account',
          'update_account',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object mapping Zoho Desk custom field API names (they start with cf_) to values. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'href',
      title: 'Attachment href',
      type: 'short-input',
      placeholder: 'Attachment download href from a thread or comment',
      condition: { field: 'operation', value: 'get_attachment' },
      required: { field: 'operation', value: 'get_attachment' },
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional file name',
      condition: { field: 'operation', value: 'get_attachment' },
      mode: 'advanced',
    },
    {
      id: 'departmentIds',
      title: 'Departments',
      type: 'project-selector',
      canonicalParamId: 'departmentIds',
      serviceId: 'zoho-desk',
      selectorKey: 'zoho_desk.departments',
      multiSelect: true,
      placeholder: 'Filter by department',
      dependsOn: ['credential', 'orgId'],
      mode: 'basic',
      condition: { field: 'operation', value: ['list_tickets', 'list_agents'] },
    },
    {
      id: 'manualDepartmentIds',
      title: 'Department IDs',
      type: 'short-input',
      canonicalParamId: 'departmentIds',
      placeholder: 'Comma-separated department IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_tickets', 'list_agents'] },
    },
    {
      id: 'include',
      title: 'Include',
      type: 'short-input',
      placeholder: 'Comma-separated related data supported by this operation',
      condition: {
        field: 'operation',
        value: [
          'list_tickets',
          'list_contacts',
          'get_account',
          'list_agents',
          'get_agent',
          'get_comment',
          'list_comments',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'ticketInclude',
      paramVisibility: 'user-or-llm',
      title: 'Include',
      type: 'short-input',
      placeholder: 'e.g. contacts,contract,skills',
      condition: { field: 'operation', value: 'get_ticket' },
      mode: 'advanced',
    },
    {
      id: 'contactInclude',
      paramVisibility: 'user-or-llm',
      title: 'Include',
      type: 'short-input',
      placeholder: 'accounts,owner',
      condition: { field: 'operation', value: 'get_contact' },
      mode: 'advanced',
    },
    {
      id: 'threadInclude',
      paramVisibility: 'user-or-llm',
      title: 'Include',
      type: 'short-input',
      placeholder: 'plainText',
      condition: { field: 'operation', value: 'get_thread' },
      mode: 'advanced',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'Sort field supported by this operation; prefix - for descending',
      condition: {
        field: 'operation',
        value: [
          'list_tickets',
          'search_tickets',
          'list_contacts',
          'search_contacts',
          'list_accounts',
          'search_accounts',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'commentSortBy',
      paramVisibility: 'user-or-llm',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'commentedTime or -commentedTime',
      condition: { field: 'operation', value: 'list_comments' },
      mode: 'advanced',
    },
    {
      id: 'threadSortBy',
      paramVisibility: 'user-or-llm',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'sendDateTime or -sendDateTime',
      condition: { field: 'operation', value: 'list_threads' },
      mode: 'advanced',
    },
    {
      id: 'from',
      title: 'From',
      type: 'short-input',
      placeholder: 'Pagination start index (see operation default)',
      condition: {
        field: 'operation',
        value: [
          'list_tickets',
          'list_comments',
          'list_threads',
          'search_tickets',
          'list_contacts',
          'search_contacts',
          'list_accounts',
          'search_accounts',
          'list_departments',
          'list_agents',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Maximum records for this page',
      condition: {
        field: 'operation',
        value: [
          'list_tickets',
          'list_comments',
          'list_threads',
          'search_tickets',
          'list_contacts',
          'search_contacts',
          'list_accounts',
          'search_accounts',
          'list_departments',
          'list_agents',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'productId',
      title: 'Product ID',
      type: 'short-input',
      placeholder: 'ID of the product to associate the ticket',
      condition: {
        field: 'operation',
        value: ['create_ticket', 'search_tickets', 'update_ticket'],
      },
      mode: 'advanced',
    },
    {
      id: 'phone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Phone number of the ticket',
      condition: {
        field: 'operation',
        value: [
          'create_ticket',
          'search_tickets',
          'create_contact',
          'update_contact',
          'search_contacts',
          'create_account',
          'update_account',
          'update_ticket',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'short-input',
      placeholder: 'Channel through which the ticket is being created.',
      condition: {
        field: 'operation',
        value: ['create_ticket', 'search_tickets', 'update_ticket'],
      },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'Language preference of the ticket',
      condition: {
        field: 'operation',
        value: ['create_ticket', 'create_contact', 'update_contact', 'update_ticket'],
      },
      mode: 'advanced',
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email ID of the ticket',
      condition: {
        field: 'operation',
        value: [
          'create_ticket',
          'search_tickets',
          'create_contact',
          'update_contact',
          'search_contacts',
          'create_account',
          'update_account',
          'update_ticket',
        ],
      },
    },
    {
      id: 'contact',
      title: 'Contact',
      type: 'code',
      placeholder: '{"email": "person@example.com"}',
      condition: { field: 'operation', value: ['create_ticket', 'update_ticket'] },
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        placeholder: 'Describe the contact',
        prompt:
          'New contact JSON: email or lastName is required; firstName is optional. Provide either this or contactId. Return ONLY the JSON object.',
      },
    },
    {
      id: 'uploads',
      title: 'Uploads',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: ['create_ticket', 'update_ticket'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the uploads',
        prompt:
          'File attachments in the ticket. For more information, refer to the Uploads section JSON array. Return ONLY the JSON array.',
      },
    },
    {
      id: 'webUrl',
      title: 'Web Url',
      type: 'short-input',
      placeholder: 'URL to access the resource',
      condition: { field: 'operation', value: ['create_ticket', 'update_ticket'] },
      mode: 'advanced',
    },
    {
      id: 'sharedDepartments',
      title: 'Shared Departments',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: ['create_ticket', 'update_ticket'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the shared departments',
        prompt:
          'List of departments to which the ticket could be shared, along with the access privileges for each department JSON array. Return ONLY the JSON array.',
      },
    },
    {
      id: 'teamId',
      title: 'Team ID',
      type: 'short-input',
      placeholder: 'ID of the team to assign the ticket',
      condition: { field: 'operation', value: ['create_ticket', 'update_ticket'] },
      mode: 'advanced',
    },
    {
      id: 'secondaryContacts',
      title: 'Secondary Contacts',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: ['create_ticket', 'update_ticket'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the secondary contacts',
        prompt: 'List of Secondary contacts JSON array. Return ONLY the JSON array.',
      },
    },
    {
      id: 'entitySkills',
      title: 'Entity Skills',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: ['create_ticket', 'update_ticket'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the entity skills',
        prompt:
          'JSON array of up to 10 skill IDs, ordered from highest to lowest assignment priority. Return ONLY the JSON array.',
      },
    },
    {
      id: 'ticketNumber',
      title: 'Ticket Number',
      type: 'short-input',
      placeholder: "The ticket's serial number exact match Comma-separated values.",
      condition: { field: 'operation', value: ['search_tickets'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          "The ticket's serial number exact match Comma-separated values. Return ONLY the comma-separated values.",
      },
    },
    {
      id: 'accountName',
      title: 'Account Name',
      type: 'short-input',
      placeholder:
        'Name of the account associated with the ticket wildcard search empty check not empty check',
      condition: {
        field: 'operation',
        value: [
          'search_tickets',
          'search_contacts',
          'create_account',
          'update_account',
          'search_accounts',
        ],
      },
      required: { field: 'operation', value: ['create_account'] },
    },
    {
      id: 'productName',
      title: 'Product Name',
      type: 'short-input',
      placeholder:
        'Name of the product associated with the ticket wildcard search empty check not empty check',
      condition: { field: 'operation', value: ['search_tickets'] },
      mode: 'advanced',
    },
    {
      id: '_all',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
    },
    {
      id: 'dueDateRange',
      title: 'Due Date Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: { field: 'operation', value: ['search_tickets'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'id',
      title: 'Id',
      type: 'short-input',
      placeholder: 'ID of the ticket exact match Comma-separated values.',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'ID of the ticket exact match Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'createdTimeRange',
      title: 'Created Time Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder:
        'ID of the account associated with the ticket exact match Comma-separated values.',
      condition: {
        field: 'operation',
        value: [
          'search_tickets',
          'create_contact',
          'update_contact',
          'update_account',
          'get_account',
        ],
      },
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'ID of the account associated with the ticket exact match Comma-separated values. Return ONLY the comma-separated values.',
      },
      required: { field: 'operation', value: ['update_account', 'get_account'] },
    },
    {
      id: 'modifiedTimeRange',
      title: 'Modified Time Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'customField1',
      title: 'Custom Field1',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
    },
    {
      id: 'customField2',
      title: 'Custom Field2',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
    },
    {
      id: 'customField3',
      title: 'Custom Field3',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
    },
    {
      id: 'customField4',
      title: 'Custom Field4',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
    },
    {
      id: 'customField5',
      title: 'Custom Field5',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
    },
    {
      id: 'customField6',
      title: 'Custom Field6',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
    },
    {
      id: 'customField7',
      title: 'Custom Field7',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
    },
    {
      id: 'customField8',
      title: 'Custom Field8',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
    },
    {
      id: 'customField9',
      title: 'Custom Field9',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
    },
    {
      id: 'customField10',
      title: 'Custom Field10',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: {
        field: 'operation',
        value: ['search_tickets', 'search_contacts', 'search_accounts'],
      },
      mode: 'advanced',
    },
    {
      id: 'customerResponseTimeRange',
      title: 'Customer Response Time Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: { field: 'operation', value: ['search_tickets'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'tag',
      title: 'Tag',
      type: 'short-input',
      placeholder: 'The tag associated with the ticket wildcard search empty check not empty check',
      condition: { field: 'operation', value: ['search_tickets'] },
      mode: 'advanced',
    },
    {
      id: 'contactName',
      title: 'Contact Name',
      type: 'short-input',
      placeholder: 'The name of the contact who raised the ticket wildcard search',
      condition: { field: 'operation', value: ['search_tickets'] },
      mode: 'advanced',
    },
    {
      id: 'forumId',
      title: 'Forum ID',
      type: 'short-input',
      placeholder:
        'ID of the community sub-category to move the forum ticket (forum topic converted into a ticket).',
      condition: { field: 'operation', value: ['move_ticket'] },
      mode: 'advanced',
    },
    {
      id: 'isPrivate',
      title: 'Is Private',
      type: 'dropdown',
      condition: { field: 'operation', value: ['send_reply'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'sendImmediately',
      title: 'Send Immediately',
      type: 'dropdown',
      condition: { field: 'operation', value: ['send_reply'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'inReplyToThreadId',
      title: 'In Reply To Thread ID',
      type: 'short-input',
      placeholder:
        'ID of the thread to which current thread is a reply, applicable only for EMAIL channel',
      condition: { field: 'operation', value: ['send_reply'] },
      mode: 'advanced',
    },
    {
      id: 'direction',
      title: 'Direction',
      type: 'dropdown',
      condition: { field: 'operation', value: ['send_reply'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'in', id: 'in' },
        { label: 'out', id: 'out' },
      ],
      value: () => '',
    },
    {
      id: 'cc',
      title: 'Cc',
      type: 'short-input',
      placeholder: 'Email ID to be CC-ed. Applicable only for EMAIL channel',
      condition: { field: 'operation', value: ['send_reply'] },
      mode: 'advanced',
    },
    {
      id: 'bcc',
      title: 'Bcc',
      type: 'short-input',
      placeholder: 'Email ID to be BCC-ed., if any exist. Applicable only for EMAIL channel',
      condition: { field: 'operation', value: ['send_reply'] },
      mode: 'advanced',
    },
    {
      id: 'hasAttach',
      title: 'Has Attach',
      type: 'dropdown',
      condition: { field: 'operation', value: ['send_reply'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'ticketStatus',
      title: 'Ticket Status',
      type: 'short-input',
      placeholder:
        'Status of the ticket. Includes the custom statuses configured in your help desk portal.',
      condition: { field: 'operation', value: ['send_reply'] },
      mode: 'advanced',
    },
    {
      id: 'attachmentIds',
      title: 'Attachment IDs',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: ['send_reply', 'update_comment', 'add_comment'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the attachment ids',
        prompt:
          'List of attachment IDs, applicable only for EMAIL channel. For information on how to retrieve attachment IDs, refer to the Uploads section. JSON array. Return ONLY the JSON array.',
      },
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      placeholder: 'To email ID in the thread, applicable only for EMAIL channel',
      condition: { field: 'operation', value: ['send_reply'] },
      mode: 'advanced',
    },
    {
      id: 'fromEmailAddress',
      title: 'From Email Address',
      type: 'short-input',
      placeholder: 'Sender email address configured in your Zoho Desk portal.',
      condition: { field: 'operation', value: ['send_reply'] },
      required: { field: 'operation', value: ['send_reply'] },
    },
    {
      id: 'isForward',
      title: 'Is Forward',
      type: 'dropdown',
      condition: { field: 'operation', value: ['send_reply'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'fields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'Field names, separated by commas',
      condition: { field: 'operation', value: ['list_contacts', 'list_accounts', 'list_tickets'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Key that returns the values of mentioned fields (both pre-defined and custom) in your portal. All field types except multi-text are supported. Standard, non-editable fields are supported too. These fields include: photoURL, webUrl. Maximum of 30 fields is supported as comma separated values. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'viewId',
      title: 'View ID',
      type: 'short-input',
      placeholder: 'ID of the view to apply while fetching the resources',
      condition: { field: 'operation', value: ['list_contacts', 'list_accounts', 'list_tickets'] },
      mode: 'advanced',
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Last name of the contact',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'search_contacts'],
      },
      required: { field: 'operation', value: ['create_contact'] },
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'First name of the contact',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'search_contacts'],
      },
    },
    {
      id: 'secondaryEmail',
      title: 'Secondary Email',
      type: 'short-input',
      placeholder: 'Secondary email ID of the contact',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      mode: 'advanced',
    },
    {
      id: 'mobile',
      title: 'Mobile',
      type: 'short-input',
      placeholder: 'Mobile number of the contact',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'search_contacts'],
      },
      mode: 'advanced',
    },
    {
      id: 'ownerId',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'ID of the user who creates the contact',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_account', 'update_account'],
      },
      mode: 'advanced',
    },
    {
      id: 'type',
      title: 'Type',
      type: 'short-input',
      placeholder: 'Contact type',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      mode: 'advanced',
    },
    {
      id: 'zip',
      title: 'Zip',
      type: 'short-input',
      placeholder: 'Zip code',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      mode: 'advanced',
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: "Contact's country of residence",
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_account', 'update_account'],
      },
      mode: 'advanced',
    },
    {
      id: 'twitter',
      title: 'Twitter',
      type: 'short-input',
      placeholder: 'Twitter ID of the contact',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      mode: 'advanced',
    },
    {
      id: 'city',
      title: 'City',
      type: 'short-input',
      placeholder: "Contact's city of residence",
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_account', 'update_account'],
      },
      mode: 'advanced',
    },
    {
      id: 'street',
      title: 'Street',
      type: 'short-input',
      placeholder: "Contact's address",
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_account', 'update_account'],
      },
      mode: 'advanced',
    },
    {
      id: 'facebook',
      title: 'Facebook',
      type: 'short-input',
      placeholder: 'Facebook ID of the contact',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      mode: 'advanced',
    },
    {
      id: 'state',
      title: 'State',
      type: 'short-input',
      placeholder: "Contact's state of residence",
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_account', 'update_account'],
      },
      mode: 'advanced',
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Contact title',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      mode: 'advanced',
    },
    {
      id: 'fullName',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'Full name of the contact wildcard search',
      condition: { field: 'operation', value: ['search_contacts'] },
      mode: 'advanced',
    },
    {
      id: 'website',
      title: 'Website',
      type: 'short-input',
      placeholder: 'Website of the account',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
      mode: 'advanced',
    },
    {
      id: 'code',
      title: 'Code',
      type: 'short-input',
      placeholder: 'Zip code',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
      mode: 'advanced',
    },
    {
      id: 'annualrevenue',
      title: 'Annualrevenue',
      type: 'short-input',
      placeholder: 'Annual revenue of the account',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
      mode: 'advanced',
    },
    {
      id: 'industry',
      title: 'Industry',
      type: 'short-input',
      placeholder: 'Industry in which the account operates',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
      mode: 'advanced',
    },
    {
      id: 'fax',
      title: 'Fax',
      type: 'short-input',
      placeholder: 'Fax number of the account',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
      mode: 'advanced',
    },
    {
      id: 'associatedSLAIds',
      title: 'Associated Slaids',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the associated slaids',
        prompt:
          'IDs of the SLAs associated with the account. An account can have multiple SLAs, but only one SLA per department can be mapped to it. JSON array. Return ONLY the JSON array.',
      },
    },
    {
      id: 'chatStatus',
      title: 'Chat Status',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_departments'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'AVAILABLE', id: 'AVAILABLE' },
        { label: 'DISABLED', id: 'DISABLED' },
        { label: 'NOT_CREATED', id: 'NOT_CREATED' },
        { label: `\${UNAVAILABLE}`, id: `\${UNAVAILABLE}` },
      ],
      value: () => '',
    },
    {
      id: 'searchStr',
      title: 'Search Str',
      type: 'short-input',
      placeholder: 'Search text; use * for wildcards',
      condition: { field: 'operation', value: ['list_departments', 'list_agents'] },
      mode: 'advanced',
    },
    {
      id: 'isEnabled',
      title: 'Is Enabled',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_departments'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'roleIds',
      title: 'Role IDs',
      type: 'short-input',
      placeholder:
        'Comma-separated array of role IDs. Maximum number of IDs allowed is 50. Comma-separated values.',
      condition: { field: 'operation', value: ['list_agents'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Comma-separated array of role IDs. Maximum number of IDs allowed is 50. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'cfSearchStr',
      title: 'Cf Search Str',
      type: 'short-input',
      placeholder:
        'String to search for agents by custom field. The string must contain at least one character',
      condition: { field: 'operation', value: ['list_agents'] },
      mode: 'advanced',
    },
    {
      id: 'cfFieldName',
      title: 'Cf Field Name',
      type: 'short-input',
      placeholder:
        'API name of the custom field that must be used for searching and listing agents',
      condition: { field: 'operation', value: ['list_agents'] },
      mode: 'advanced',
    },
    {
      id: 'fieldName',
      title: 'Field Name',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_agents'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'firstName', id: 'firstName' },
        { label: 'lastName', id: 'lastName' },
        { label: 'emailId', id: 'emailId' },
        { label: 'name', id: 'name' },
      ],
      value: () => '',
    },
    {
      id: 'isLightAgent',
      title: 'Is Light Agent',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_agents'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_agents'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'asc', id: 'asc' },
        { label: 'desc', id: 'desc' },
      ],
      value: () => '',
    },
    {
      id: 'rolePermissionType',
      title: 'Role Permission Type',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_agents'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'AgentPublic', id: 'AgentPublic' },
        { label: 'AgentPersonal', id: 'AgentPersonal' },
        { label: 'AgentTeamPersonal', id: 'AgentTeamPersonal' },
        { label: 'Admin', id: 'Admin' },
        { label: 'Custom', id: 'Custom' },
        { label: 'Light', id: 'Light' },
        { label: `\${NON_LIGHT}`, id: `\${NON_LIGHT}` },
      ],
      value: () => '',
    },
    {
      id: 'profileIds',
      title: 'Profile IDs',
      type: 'short-input',
      placeholder: 'Enter profile ids',
      condition: { field: 'operation', value: ['list_agents'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Comma-separated array of profile IDs. Maximum number of IDs allowed is 50. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'isConfirmed',
      title: 'Is Confirmed',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_agents'] },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'agentId',
      title: 'Agent ID',
      type: 'short-input',
      placeholder: 'Agent ID',
      condition: { field: 'operation', value: ['get_agent'] },
      required: { field: 'operation', value: ['get_agent'] },
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Comment ID',
      condition: { field: 'operation', value: ['get_comment', 'update_comment', 'delete_comment'] },
      required: { field: 'operation', value: ['get_comment', 'update_comment', 'delete_comment'] },
    },
    {
      id: 'teamIds',
      title: 'Team Ids',
      type: 'short-input',
      placeholder: 'Comma-separated team IDs or Unassigned',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_tickets'] },
    },
    {
      id: 'disableClosureNotification',
      title: 'Disable Closure Notification',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: ['update_ticket'] },
      options: [
        { label: 'Provider default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    ...getTrigger('zoho_desk').subBlocks,
  ],
  tools: {
    access: [
      'zoho_desk_list_tickets',
      'zoho_desk_get_ticket',
      'zoho_desk_update_ticket',
      'zoho_desk_list_comments',
      'zoho_desk_add_comment',
      'zoho_desk_list_threads',
      'zoho_desk_get_thread',
      'zoho_desk_get_contact',
      'zoho_desk_get_attachment',
      'zoho_desk_list_organizations',
      'zoho_desk_create_ticket',
      'zoho_desk_search_tickets',
      'zoho_desk_move_ticket',
      'zoho_desk_send_reply',
      'zoho_desk_list_contacts',
      'zoho_desk_create_contact',
      'zoho_desk_update_contact',
      'zoho_desk_search_contacts',
      'zoho_desk_list_accounts',
      'zoho_desk_create_account',
      'zoho_desk_update_account',
      'zoho_desk_search_accounts',
      'zoho_desk_get_account',
      'zoho_desk_list_departments',
      'zoho_desk_get_department',
      'zoho_desk_list_agents',
      'zoho_desk_get_agent',
      'zoho_desk_get_comment',
      'zoho_desk_update_comment',
      'zoho_desk_delete_comment',
    ],
    config: {
      tool: (params) => `zoho_desk_${params.operation}`,
      params: (params) => {
        const fields =
          typeof params.operation === 'string'
            ? ADDITIONAL_OPERATION_FIELDS[params.operation]
            : undefined
        if (fields) {
          const result: Record<string, unknown> = { orgId: params.orgId }
          for (const [name, config] of Object.entries(fields)) {
            const value = params[name]
            result[name] = normalizeParam(name, value, config)
          }
          return result
        }
        // Agent tools select the operation outside params; retain model args and map only configured aliases.
        if (typeof params.operation !== 'string') {
          const result: Record<string, unknown> = { ...params }
          for (const [alias, name] of Object.entries(LEGACY_AGENT_ALIASES)) {
            const value = orUndefined(params[alias])
            if (value !== undefined) result[name] = value
          }
          for (const [name, config] of Object.entries(AGENT_PARAM_TYPES)) {
            if (Object.hasOwn(result, name))
              result[name] = normalizeParam(name, result[name], config)
          }
          result.customFields = parseCustomFields(result.customFields)
          return result
        }
        // IMPORTANT: destructuring a key out of `rest` does NOT keep it from the
        // tool. Both call sites merge this function's return value on top of the
        // original inputs (`{ ...inputs, ...transformedParams }` in
        // executor/handlers/generic/handler.ts, and the same shape in
        // providers/utils.ts), so a key left out of `result` is simply restored
        // from `inputs`. The only way to scope a param to an operation is to
        // OVERWRITE it with `undefined`, which every tool then treats as unset.
        //
        // This matters because a `mode: 'advanced'` subBlock with a retained
        // value is serialized for every operation when the block's advanced
        // toggle is off - serializer/index.ts returns on `isNonEmptyValue`
        // without evaluating the subBlock's `condition` - so stale advanced
        // values genuinely do arrive here under an unrelated operation.
        const {
          oauthCredential,
          from: rawFrom,
          limit: rawLimit,
          contentType,
          isPublic,
          status: rawStatus,
          priority: rawPriority,
          statusFilter: rawStatusFilter,
          priorityFilter: rawPriorityFilter,
          customFields: rawCustomFields,
          departmentIds: rawDepartmentIds,
          sortBy: rawSortBy,
          commentSortBy: rawCommentSortBy,
          threadSortBy: rawThreadSortBy,
          include: rawInclude,
          ticketInclude: rawTicketInclude,
          contactInclude: rawContactInclude,
          threadInclude: rawThreadInclude,
          assigneeFilter: rawAssigneeFilter,
          channelFilter: rawChannelFilter,
          receivedInDays: rawReceivedInDays,
          ...rest
        } = params
        const result: Record<string, unknown> = { ...rest, oauthCredential }

        // The basic-mode department picker is multi-select, so it stores an
        // array while the advanced manual field stores the raw comma-separated
        // string Zoho's `departmentIds` query param expects. Normalize both to
        // that string so the wire format never depends on which mode was used.
        const departmentIds = Array.isArray(rawDepartmentIds)
          ? rawDepartmentIds
              .map((id) => String(id).trim())
              .filter(Boolean)
              .join(',')
          : typeof rawDepartmentIds === 'string'
            ? rawDepartmentIds.trim()
            : ''
        // Always assigned, never conditionally: an emptied multi-select stores
        // `[]`, and leaving the key unset would let that array through to the
        // tool, where the comma-list normalizer would throw on `.split`.
        result.departmentIds = departmentIds || undefined

        // contentType is the comment's content type; its default would otherwise
        // serialize for every operation (e.g. get_attachment, which has no such
        // param). Only forward it for add_comment so the UI can't imply an option
        // that has no effect elsewhere.
        result.contentType =
          params.operation === 'add_comment' && typeof contentType === 'string' && contentType
            ? contentType
            : undefined

        // Zoho documents from >= 0 and limit >= 1 as integers; a negative or
        // fractional value reaches the API as an opaque provider error, so drop
        // anything outside those bounds here rather than round-tripping it.
        // `null` is checked explicitly: the serializer initializes untouched
        // subBlocks to null, and Number(null) is 0 — which would otherwise inject
        // from=0 on every operation instead of leaving the param unset.
        result.from = toPaginationValue(rawFrom, 0)
        result.limit = toPaginationValue(rawLimit, 1)
        // Gated for the same reason as contentType above: isPublic carries a
        // defaultValue, so forwarding it unconditionally would serialize a
        // comment-only field onto every other operation's params. Destructured
        // out of `rest` so the default never reaches non-comment operations.
        result.isPublic =
          params.operation === 'add_comment' && isPublic !== undefined
            ? isPublic === true || isPublic === 'true'
            : undefined
        // Gated to update_ticket for the same reason as contentType and isPublic
        // above: the subBlock keeps its value when the operation changes, so
        // stale (or half-typed) JSON left behind after switching away from
        // Update Ticket would otherwise fail every unrelated operation with
        // "Invalid JSON provided for custom fields" - on runs that never send it.
        // Only list_tickets and update_ticket declare status/priority. The other
        // eight operations must receive neither - a ternary with a bare `else`
        // would forward a stale Update Ticket value into e.g. get_ticket.
        const activeStatus =
          params.operation === 'list_tickets'
            ? rawStatusFilter
            : params.operation === 'update_ticket'
              ? rawStatus
              : undefined
        const activePriority =
          params.operation === 'list_tickets'
            ? rawPriorityFilter
            : params.operation === 'update_ticket'
              ? rawPriority
              : undefined
        result.status = orUndefined(activeStatus)
        result.priority = orUndefined(activePriority)

        // sortBy and include are per-operation for the same reason: three list
        // endpoints accept three different sort fields, and get_contact accepts a
        // different `include` vocabulary than the ticket endpoints. A subBlock
        // keeps its value across an operation change, so an ungated spread would
        // send list_tickets' `createdTime` to list_comments, which Zoho rejects.
        const activeSortBy =
          params.operation === 'list_tickets'
            ? rawSortBy
            : params.operation === 'list_comments'
              ? rawCommentSortBy
              : params.operation === 'list_threads'
                ? rawThreadSortBy
                : undefined
        result.sortBy = orUndefined(activeSortBy)

        // Get Ticket falls back to the legacy shared `include`: workflows saved
        // before the split stored their value there, and dropping it would
        // silently stop embedding what they asked for. The fallback is one-way
        // and safe - Get Ticket accepts every value List Tickets does, plus
        // `contract` and `skills` - while List Tickets never reads
        // `ticketInclude`, so those two extra tokens can still never reach it.
        const activeInclude =
          params.operation === 'list_tickets'
            ? rawInclude
            : params.operation === 'get_ticket'
              ? (orUndefined(rawTicketInclude) ?? rawInclude)
              : params.operation === 'get_contact'
                ? rawContactInclude
                : params.operation === 'list_comments'
                  ? params.include
                  : params.operation === 'get_thread'
                    ? rawThreadInclude
                    : undefined
        result.include = orUndefined(activeInclude)

        // Gated for the same stale-value reason as the filters above: these three
        // are list_tickets-only query params, and no other operation declares them.
        const isListTickets = params.operation === 'list_tickets'
        result.assignee = isListTickets ? orUndefined(rawAssigneeFilter) : undefined
        result.channel = isListTickets ? orUndefined(rawChannelFilter) : undefined
        // Forward whatever was supplied and let the tool judge it. Filtering here
        // on shape would swallow 30.5 or a non-numeric value, and the tool would
        // then run without the filter and return the entire queue as though the
        // requested window had applied. Only the empty "Any time" option is
        // dropped, because that genuinely means no filter.
        const receivedInDays = isListTickets ? orUndefined(rawReceivedInDays) : undefined
        result.receivedInDays = receivedInDays === undefined ? undefined : Number(receivedInDays)

        result.customFields =
          params.operation === 'update_ticket' ? parseCustomFields(rawCustomFields) : undefined
        result.viewId = params.operation === 'list_tickets' ? params.viewId : undefined
        result.teamIds = params.operation === 'list_tickets' ? params.teamIds : undefined
        result.fields = params.operation === 'list_tickets' ? params.fields : undefined
        result.contact = params.operation === 'update_ticket' ? params.contact : undefined
        result.productId = params.operation === 'update_ticket' ? params.productId : undefined
        result.uploads = params.operation === 'update_ticket' ? params.uploads : undefined
        result.email = params.operation === 'update_ticket' ? params.email : undefined
        result.phone = params.operation === 'update_ticket' ? params.phone : undefined
        result.language = params.operation === 'update_ticket' ? params.language : undefined
        result.channel = params.operation === 'update_ticket' ? params.channel : result.channel
        result.webUrl = params.operation === 'update_ticket' ? params.webUrl : undefined
        result.sharedDepartments =
          params.operation === 'update_ticket' ? params.sharedDepartments : undefined
        result.teamId = params.operation === 'update_ticket' ? params.teamId : undefined
        result.secondaryContacts =
          params.operation === 'update_ticket' ? params.secondaryContacts : undefined
        result.entitySkills = params.operation === 'update_ticket' ? params.entitySkills : undefined
        result.disableClosureNotification =
          params.operation === 'update_ticket'
            ? params.disableClosureNotification === '' || params.disableClosureNotification == null
              ? undefined
              : params.disableClosureNotification === true ||
                params.disableClosureNotification === 'true'
            : undefined
        result.attachmentIds = params.operation === 'add_comment' ? params.attachmentIds : undefined
        return result
      },
    },
  },
  inputs: {
    include: { type: 'string', description: 'Related data to include when listing tickets' },
    attachmentIds: {
      type: 'array',
      description: 'JSON array of previously uploaded attachment IDs',
    },
    disableClosureNotification: {
      type: 'boolean',
      description: 'Suppress the contact notification when closing the ticket',
    },
    entitySkills: {
      type: 'array',
      description: 'JSON array of skill IDs in priority order; at most 10',
    },
    secondaryContacts: {
      type: 'array',
      description: 'JSON array of secondary contact IDs',
    },
    teamId: { type: 'string', description: 'Team ID' },
    sharedDepartments: {
      type: 'array',
      description: 'JSON array of shared departments and access privileges',
    },
    webUrl: { type: 'string', description: 'URL to access the ticket' },
    channel: { type: 'string', description: 'Ticket origin channel' },
    language: { type: 'string', description: 'Ticket language' },
    phone: { type: 'string', description: 'Ticket phone number' },
    email: { type: 'string', description: 'Ticket email address' },
    uploads: {
      type: 'array',
      description: 'JSON array of previously uploaded attachment IDs',
    },
    productId: { type: 'string', description: 'Product ID' },
    contact: {
      type: 'json',
      description: 'Contact JSON with email or lastName; use instead of contactId',
    },
    contactId: { type: 'string', description: 'Contact ID' },
    fields: {
      type: 'string',
      description: 'Comma-separated fields to return; at most 30 system or custom fields',
    },
    teamIds: { type: 'string', description: 'Comma-separated team IDs or Unassigned' },
    viewId: { type: 'string', description: 'Saved view ID' },
    operation: { type: 'string', description: 'Operation to perform' },
    subject: { type: 'string', description: 'Ticket subject' },
    dueDate: { type: 'string', description: 'Ticket due date' },
    priority: { type: 'string', description: 'Ticket priority' },
    assigneeId: { type: 'string', description: 'Assignee (agent) ID' },
    subCategory: { type: 'string', description: 'Ticket sub-category' },
    customFields: { type: 'json', description: 'Custom field values' },
    description: { type: 'string', description: 'Ticket description' },
    classification: { type: 'string', description: 'Ticket classification' },
    category: { type: 'string', description: 'Ticket category' },
    status: { type: 'string', description: 'Ticket status to set' },
    departmentId: { type: 'string', description: 'Department ID to move a ticket to' },
    resolution: { type: 'string', description: 'Resolution notes' },
    ticketNumber: {
      type: 'string',
      description: "The ticket's serial number. Exact match. Comma-separated values.",
    },
    accountName: {
      type: 'string',
      description:
        'Name of the account associated with the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    productName: {
      type: 'string',
      description:
        'Name of the product associated with the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    _all: {
      type: 'string',
      description: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
    },
    limit: { type: 'number', description: 'Maximum results' },
    from: { type: 'number', description: 'Pagination start index' },
    dueDateRange: {
      type: 'string',
      description: 'Due date range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    id: {
      type: 'string',
      description: 'ID of the ticket. Exact match. Comma-separated values.',
    },
    createdTimeRange: {
      type: 'string',
      description: 'Created time range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    accountId: {
      type: 'string',
      description:
        'ID of the account associated with the ticket. Exact match. Comma-separated values.',
    },
    modifiedTimeRange: {
      type: 'string',
      description: 'Modified time range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    customField1: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField2: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField3: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField4: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField5: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField6: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField7: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField8: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField9: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customField10: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    customerResponseTimeRange: {
      type: 'string',
      description:
        'Customer response time range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    sortBy: { type: 'string', description: 'Sort field for listing tickets' },
    tag: {
      type: 'string',
      description:
        'The tag associated with the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    contactName: {
      type: 'string',
      description: 'The name of the contact who raised the ticket. Supports * wildcards.',
    },
    ticketId: { type: 'string', description: 'Ticket ID' },
    forumId: {
      type: 'string',
      description:
        'ID of the community sub-category to move the forum ticket (forum topic converted into a ticket).',
    },
    isPrivate: {
      type: 'boolean',
      description:
        'Specifies whether the thread is Private or Public. Forwarded threads are always private.',
    },
    sendImmediately: {
      type: 'boolean',
      description: 'Specify whether the reply has to sent immediately',
    },
    content: { type: 'string', description: 'Comment content' },
    contentType: { type: 'string', description: 'Comment content type (plainText/html)' },
    inReplyToThreadId: {
      type: 'string',
      description:
        'ID of the thread to which current thread is a reply, applicable only for EMAIL channel',
    },
    direction: {
      type: 'string',
      description: 'Key that returns whether the thread is incoming or outgoing',
    },
    cc: {
      type: 'string',
      description: 'Email ID to be CC-ed. Applicable only for EMAIL channel',
    },
    bcc: {
      type: 'string',
      description: 'Email ID to be BCC-ed., if any exist. Applicable only for EMAIL channel',
    },
    hasAttach: {
      type: 'boolean',
      description: 'States whether the thread has attachments',
    },
    ticketStatus: {
      type: 'string',
      description:
        'Status of the ticket. Includes the custom statuses configured in your help desk portal.',
    },
    to: {
      type: 'string',
      description: 'To email ID in the thread, applicable only for EMAIL channel',
    },
    fromEmailAddress: {
      type: 'string',
      description: 'Sender email address configured in your Zoho Desk portal.',
    },
    isForward: {
      type: 'boolean',
      description:
        'Key that returns if the thread was sent as a forward. Applicable only for the EMAIL channel.',
    },
    lastName: { type: 'string', description: 'Last name of the contact' },
    firstName: { type: 'string', description: 'First name of the contact' },
    secondaryEmail: {
      type: 'string',
      description: 'Secondary email ID of the contact',
    },
    mobile: { type: 'string', description: 'Mobile number of the contact' },
    ownerId: { type: 'string', description: 'ID of the user who creates the contact' },
    type: { type: 'string', description: 'Contact type' },
    zip: { type: 'string', description: 'Zip code' },
    country: { type: 'string', description: "Contact's country of residence" },
    twitter: { type: 'string', description: 'Twitter ID of the contact' },
    city: { type: 'string', description: "Contact's city of residence" },
    street: { type: 'string', description: "Contact's address" },
    facebook: { type: 'string', description: 'Facebook ID of the contact' },
    state: { type: 'string', description: "Contact's state of residence" },
    title: { type: 'string', description: 'Contact title' },
    fullName: {
      type: 'string',
      description: 'Full name of the contact. Supports * wildcards.',
    },
    website: { type: 'string', description: 'Website of the account' },
    code: { type: 'string', description: 'Zip code' },
    annualrevenue: { type: 'number', description: 'Annual revenue of the account' },
    industry: {
      type: 'string',
      description: 'Industry in which the account operates',
    },
    fax: { type: 'string', description: 'Fax number of the account' },
    associatedSLAIds: {
      type: 'array',
      description:
        'IDs of the SLAs associated with the account. An account can have multiple SLAs, but only one SLA per department can be mapped to it. JSON array.',
    },
    chatStatus: {
      type: 'string',
      description: `Key that filters departments based on their chat status. Values allowed are AVAILABLE, DISABLED, NOT_CREATED, and \${UNAVAILABLE}. \${UNAVAILABLE} refers to departments which are not available for chat.`,
    },
    searchStr: {
      type: 'string',
      description:
        'String to search for departments by name, help center name, or description. The string must contain at least one character. Three search methods are supported: 1) string* - Searches for departments whose name, help center name, or description start with the string, 2) *string* - Searches for departments whose name, help center name, or description contain the string, 3) string - Searches for departments whose name, help center name, or description is an. Exact match. for the string',
    },
    isEnabled: {
      type: 'boolean',
      description: 'Key that filters departments based on their enabled status',
    },
    roleIds: {
      type: 'string',
      description:
        'Comma-separated array of role IDs. Maximum number of IDs allowed is 50. Comma-separated values.',
    },
    cfSearchStr: {
      type: 'string',
      description:
        'String to search for agents by custom field. The string must contain at least one character',
    },
    cfFieldName: {
      type: 'string',
      description:
        'API name of the custom field that must be used for searching and listing agents',
    },
    fieldName: {
      type: 'string',
      description:
        'Name of the field that must be used for searching and listing agents. The allowed values are: firstName, lastName, name, and emailId',
    },
    isLightAgent: {
      type: 'boolean',
      description: 'Key that denotes if the agents must be light or non light.',
    },
    sortOrder: {
      type: 'string',
      description:
        'To sort the available list of agents in either ascending or descending order. The allowed values are: asc or desc',
    },
    rolePermissionType: {
      type: 'string',
      description: `Types of roles and permissions of the agents to list. The allowed values are AgentPublic, AgentPersonal,AgentTeamPersonal, Admin, Light, Custom, and \${NON_LIGHT}. \${NON_LIGHT} refers to agents who are not associated with the light agent profile.`,
    },
    profileIds: {
      type: 'string',
      description:
        'Comma-separated array of profile IDs. Maximum number of IDs allowed is 50. Comma-separated values.',
    },
    isConfirmed: {
      type: 'boolean',
      description: 'Key that denotes if the agents must be confirmed or unconfirmed.',
    },
    departmentIds: { type: 'string', description: 'Department IDs to filter by (comma-separated)' },
    agentId: { type: 'string', description: 'Agent ID' },
    commentId: { type: 'string', description: 'Comment ID' },
    oauthCredential: { type: 'string', description: 'Zoho Desk credential' },
    orgId: { type: 'string', description: 'Zoho Desk organization ID' },
    threadId: { type: 'string', description: 'Thread ID' },
    isPublic: { type: 'boolean', description: 'Whether a comment is public' },
    statusFilter: { type: 'string', description: 'Status filter for listing tickets' },
    priorityFilter: { type: 'string', description: 'Priority filter for listing tickets' },
    assigneeFilter: { type: 'string', description: 'Assignee filter for listing tickets' },
    channelFilter: { type: 'string', description: 'Channel filter for listing tickets' },
    receivedInDays: {
      type: 'number',
      description: 'Only tickets with a customer response in the last N days',
    },
    href: { type: 'string', description: 'Attachment download href' },
    fileName: { type: 'string', description: 'Downloaded file name' },
    ticketInclude: { type: 'string', description: 'Related data to include on a single ticket' },
    contactInclude: { type: 'string', description: 'Related data to include on a contact' },
    threadInclude: { type: 'string', description: 'Related data to include on a thread' },
    commentSortBy: { type: 'string', description: 'Sort field for listing comments' },
    threadSortBy: { type: 'string', description: 'Sort field for listing threads' },
  },
  outputs: {
    tickets: { type: 'array', description: 'List of tickets' },
    ticket: {
      type: 'json',
      description: 'Ticket (id, ticketNumber, subject, description, status, priority, contactId)',
    },
    comments: { type: 'array', description: 'List of comments' },
    comment: {
      type: 'json',
      description: 'Comment (id, content, contentText, isPublic, commenter, attachments)',
    },
    threads: { type: 'array', description: 'List of threads' },
    thread: {
      type: 'json',
      description: 'Thread (id, content, contentText, to, fromEmailAddress, attachments)',
    },
    contact: {
      type: 'json',
      description: 'Contact (id, firstName, lastName, email, accountId, custom fields)',
    },
    organizations: { type: 'array', description: 'Accessible organizations' },
    file: { type: 'file', description: 'Downloaded attachment file' },
    count: { type: 'number', description: 'Number of items returned in this page' },
    totalCount: { type: 'number', description: 'Total matches reported by search operations' },
    nextFrom: {
      type: 'number',
      description:
        'Next page index for the new list and search operations; null after an empty page',
    },
    completed: { type: 'boolean', description: 'Whether Move Ticket or Delete Comment completed' },
    accounts: {
      type: 'json',
      description: 'Accounts (id, accountName, email, ownerId, custom fields)',
    },
    account: {
      type: 'json',
      description: 'Account (id, accountName, email, ownerId, custom fields)',
    },
    contacts: { type: 'json', description: 'Contacts (id, firstName, lastName, email, accountId)' },
    departments: { type: 'json', description: 'Departments (id, name, isEnabled, description)' },
    department: {
      type: 'json',
      description: 'Department (id, name, isEnabled, associatedAgentIds)',
    },
    agents: { type: 'json', description: 'Agents (id, firstName, lastName, emailId, status)' },
    agent: { type: 'json', description: 'Agent (id, firstName, lastName, emailId, role, profile)' },
  },
  triggers: {
    enabled: true,
    available: ['zoho_desk'],
  },
}

export const ZohoDeskBlockMeta = {
  tags: ['customer-support', 'ticketing', 'automation'],
  url: 'https://www.zoho.com/desk/',
  templates: [
    {
      icon: ZohoDeskIcon,
      title: 'Zoho Desk new-ticket Slack alert',
      prompt:
        'When a new ticket is created in Zoho Desk, send a formatted Slack message to my support channel with the subject, priority, requester, and a link to the ticket.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['automation', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ZohoDeskIcon,
      title: 'Zoho Desk AI ticket triage',
      prompt:
        'When a Zoho Desk ticket is created, read the subject and description, classify the priority and category, and update the ticket with the suggested priority and a triage comment.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['automation', 'ai'],
    },
    {
      icon: ZohoDeskIcon,
      title: 'Zoho Desk AI draft reply',
      prompt:
        'When a customer adds a new thread to a Zoho Desk ticket, fetch the full thread, draft a helpful reply grounded in my knowledge base, and post it as a private comment for an agent to review.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'support',
      tags: ['ai', 'automation'],
    },
    {
      icon: ZohoDeskIcon,
      title: 'Zoho Desk escalation watcher',
      prompt:
        'Create a scheduled workflow that lists open high-priority Zoho Desk tickets with no agent response, and pings the on-call engineer in Slack with the ticket details.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ZohoDeskIcon,
      title: 'Zoho Desk daily support digest',
      prompt:
        'Build a scheduled workflow that searches Zoho Desk tickets using modifiedTimeRange for the last 24 hours, summarizes volume by status and priority, and emails a digest to the support lead.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['reporting', 'automation'],
    },
    {
      icon: ZohoDeskIcon,
      title: 'Zoho Desk contact enrichment',
      prompt:
        'When a Zoho Desk ticket is created, look up the contact, enrich it with data from our CRM, and add a comment summarizing the customer context for the agent.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['automation', 'ai'],
    },
    {
      icon: ZohoDeskIcon,
      title: 'Zoho Desk knowledge search',
      prompt:
        'Create a knowledge base from my resolved Zoho Desk tickets and threads so I can ask an agent questions like "how did we resolve the billing sync issue?" and get answers with ticket citations.',
      modules: ['knowledge-base', 'agent'],
      category: 'support',
      tags: ['research', 'ai'],
    },
    {
      icon: ZohoDeskIcon,
      title: 'Zoho Desk attachment archiver',
      prompt:
        'When a Zoho Desk ticket thread includes an attachment, download the file and upload it to Google Drive in a folder named after the ticket number.',
      modules: ['agent', 'files', 'workflows'],
      category: 'support',
      tags: ['automation', 'files'],
      alsoIntegrations: ['google_drive'],
    },
  ],
  skills: [
    {
      name: 'triage-new-ticket',
      description:
        'Read an incoming Zoho Desk ticket, classify it, and set priority, classification, category, and assignee.',
      content:
        "# Triage a Zoho Desk Ticket\n\nClassify a newly created ticket and route it to the right owner.\n\n## Steps\n1. If the organization ID is unknown, List Organizations and pick the portal to work in.\n2. Get Ticket for the ticket ID and read subject, descriptionText, channel, and status.\n3. Decide the urgency and the owning team from the content, and pick a classification — Problem, Request and Question are Zoho's system-defined values, but the portal may define its own.\n4. Update Ticket to set priority, classification, category and subCategory, and the assigneeId or departmentId that should own it.\n5. Add Comment as an internal note explaining the triage decision so the agent who picks it up has the reasoning.\n\n## Output\nReport the ticket ID and number, the classification and priority set, the assignee or department it was routed to, and anything ambiguous that needs a human decision.",
    },
    {
      name: 'escalate-overdue-tickets',
      description:
        'Find Zoho Desk tickets past or near their response due date and escalate them with a higher priority and an owner.',
      content:
        '# Escalate Overdue Tickets\n\nCatch tickets that are breaching or about to breach their response commitment.\n\n## Steps\n1. List Tickets filtered to open statuses, sorted by responseDueDate so the soonest-due tickets come first. Page with from and limit if the queue is large.\n2. Compare responseDueDate and dueDate against the current time to separate already-breached tickets from ones due shortly.\n3. For each breached ticket, Update Ticket to raise priority and reassign to the escalation owner via assigneeId or departmentId.\n4. Add Comment as an internal note recording that the ticket was escalated, how overdue it was, and who now owns it.\n\n## Output\nA list of escalated tickets with ticket number, how far past due each was, the new priority, and the new owner. Include a separate at-risk list of tickets due soon but not yet breached.',
    },
    {
      name: 'daily-ticket-digest',
      description:
        'Summarize the current Zoho Desk queue by status, priority, and age into a digest for the support team.',
      content:
        '# Daily Ticket Digest\n\nProduce a morning read on where the support queue stands.\n\n## Steps\n1. List Tickets for the department, filtering by the statuses you care about such as "Open,On Hold". Page with from and limit until the queue is covered.\n2. Group the results by status, priority, and assignee, and compute counts for each group.\n3. Flag unassigned tickets, tickets past responseDueDate, and anything that has sat untouched since createdTime.\n4. Write a short narrative of what changed and what needs attention today.\n\n## Output\nA digest with counts by status and priority, load per assignee, and a callout list of unassigned and overdue tickets by ticket number. State the filters used so the numbers are reproducible.',
    },
    {
      name: 'draft-reply-as-internal-note',
      description:
        'Read a Zoho Desk ticket conversation and post a suggested reply as a private comment for an agent to review.',
      content:
        '# Draft a Reply as an Internal Note\n\nPrepare a response an agent can review and send, without messaging the customer directly.\n\n## Steps\n1. Get Ticket to read the subject, descriptionText, status, and priority.\n2. List Threads for the ticket and Get Thread on the most recent customer message to read its full content.\n3. List Comments to check what has already been discussed internally so the draft does not repeat prior advice.\n4. Write a reply that answers the latest customer message, and Add Comment with isPublic set to false so it posts as an internal draft. Use plainText unless the draft genuinely contains markup.\n\n## Output\nThe ticket number, the comment ID of the posted draft, and a note on any facts the draft assumes that an agent must verify before sending. This posts an internal note only, never a reply to the customer.',
    },
    {
      name: 'enrich-ticket-with-customer-context',
      description:
        'Pull the contact behind a Zoho Desk ticket and post a customer context summary as an internal note.',
      content:
        '# Enrich a Ticket With Customer Context\n\nGive the assigned agent the customer background before they start working the ticket.\n\n## Steps\n1. Get Ticket with include set to contacts so the related contact record comes back with the ticket.\n2. Get Contact for the ticket contactId to read the full contact record, including accountId, job title, email, and phone.\n3. Search Tickets filtered by contactId or accountId to find related tickets, paging within the documented search limit.\n4. Add Comment as an internal note summarizing who the customer is, their account, and any related open or recent tickets.\n\n## Output\nThe ticket number, the contact and account identified, a list of related tickets by number, and the internal note that was posted. Say explicitly if no contact is linked to the ticket.',
    },
    {
      name: 'package-ticket-for-engineering',
      description:
        'Assemble a Zoho Desk ticket conversation and its attachments into a bug report, then record the escalation on the ticket.',
      content:
        '# Package a Ticket for Engineering\n\nTurn a support ticket into a developer-ready bug report.\n\n## Steps\n1. Get Ticket to read the subject, descriptionText, priority, and classification.\n2. List Threads and Get Thread on the relevant messages to extract reproduction steps, error text, and environment details.\n3. For each attachment referenced on a thread or comment, Get Attachment with its href to download the screenshot or log.\n4. Write the bug report with a summary, steps to reproduce, expected versus actual behavior, and the attached evidence.\n5. Update Ticket to set classification to Problem and record the tracker key in a custom field via customFields, then Add Comment as an internal note linking the escalation.\n\n## Output\nThe assembled bug report, the ticket number it came from, the attachments downloaded, and confirmation of the custom field and internal note written back to the ticket.',
    },
    {
      name: 'ticket-knowledge-gap-report',
      description:
        'Scan recent Zoho Desk tickets for recurring themes and propose the knowledge base articles that would deflect them.',
      content:
        '# Ticket Knowledge Gap Report\n\nFind the questions customers keep asking that no article answers.\n\n## Steps\n1. List Tickets across the statuses and departments in scope, paging with from and limit to cover a meaningful window.\n2. Read each subject, category, and subCategory, and Get Ticket for descriptionText when needed to group recurring themes.\n3. Rank themes by ticket volume, and for the top ones Get Ticket and List Threads on a couple of examples to understand what the customer actually needed.\n4. For each theme, propose a knowledge base article with a working title and the questions it must answer.\n\n## Output\nA ranked table of themes with ticket counts and example ticket numbers, plus the proposed article titles and outlines. Note which themes are one-off incidents rather than genuine documentation gaps.',
    },
  ],
} as const satisfies BlockMeta
