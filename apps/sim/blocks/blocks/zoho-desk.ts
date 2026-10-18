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
  Record<string, { field: string; type: string; omitEmpty?: boolean }>
> = {
  create_ticket: {
    productId: { field: 'createTicketProductId', type: 'string' },
    phone: { field: 'createTicketPhone', type: 'string' },
    subject: { field: 'createTicketSubject', type: 'string' },
    dueDate: { field: 'createTicketDueDate', type: 'string' },
    channel: { field: 'createTicketChannel', type: 'string' },
    language: { field: 'createTicketLanguage', type: 'string' },
    priority: { field: 'createTicketPriority', type: 'string' },
    assigneeId: { field: 'createTicketAssigneeId', type: 'string' },
    email: { field: 'createTicketEmail', type: 'string' },
    subCategory: { field: 'createTicketSubCategory', type: 'string' },
    customFields: { field: 'createTicketCustomFields', type: 'json' },
    description: { field: 'createTicketDescription', type: 'string' },
    classification: { field: 'createTicketClassification', type: 'string' },
    category: { field: 'createTicketCategory', type: 'string' },
    status: { field: 'createTicketStatus', type: 'string' },
    contactId: { field: 'createTicketContactId', type: 'string' },
    departmentId: { field: 'createTicketDepartmentId', type: 'string' },
    contact: { field: 'createTicketContact', type: 'json' },
    uploads: { field: 'createTicketUploads', type: 'json' },
    resolution: { field: 'createTicketResolution', type: 'string' },
    webUrl: { field: 'createTicketWebUrl', type: 'string' },
    sharedDepartments: { field: 'createTicketSharedDepartments', type: 'json' },
    teamId: { field: 'createTicketTeamId', type: 'string' },
    secondaryContacts: { field: 'createTicketSecondaryContacts', type: 'json' },
    entitySkills: { field: 'createTicketEntitySkills', type: 'json' },
  },
  search_tickets: {
    email: { field: 'searchTicketsEmail', type: 'string' },
    phone: { field: 'searchTicketsPhone', type: 'string' },
    ticketNumber: { field: 'searchTicketsTicketNumber', type: 'string' },
    accountName: { field: 'searchTicketsAccountName', type: 'string' },
    subject: { field: 'searchTicketsSubject', type: 'string' },
    departmentId: { field: 'searchTicketsDepartmentId', type: 'string' },
    productName: { field: 'searchTicketsProductName', type: 'string' },
    _all: { field: 'searchTicketsQuery', type: 'string' },
    limit: { field: 'searchTicketsLimit', type: 'number' },
    from: { field: 'searchTicketsFrom', type: 'number' },
    dueDateRange: { field: 'searchTicketsDueDateRange', type: 'string' },
    id: { field: 'searchTicketsId', type: 'string' },
    productId: { field: 'searchTicketsProductId', type: 'string' },
    contactId: { field: 'searchTicketsContactId', type: 'string' },
    createdTimeRange: { field: 'searchTicketsCreatedTimeRange', type: 'string' },
    priority: { field: 'searchTicketsPriority', type: 'string' },
    assigneeId: { field: 'searchTicketsAssigneeId', type: 'string' },
    accountId: { field: 'searchTicketsAccountId', type: 'string' },
    modifiedTimeRange: { field: 'searchTicketsModifiedTimeRange', type: 'string' },
    status: { field: 'searchTicketsStatus', type: 'string' },
    customField1: { field: 'searchTicketsCustomField1', type: 'string' },
    customField2: { field: 'searchTicketsCustomField2', type: 'string' },
    customField3: { field: 'searchTicketsCustomField3', type: 'string' },
    customField4: { field: 'searchTicketsCustomField4', type: 'string' },
    customField5: { field: 'searchTicketsCustomField5', type: 'string' },
    customField6: { field: 'searchTicketsCustomField6', type: 'string' },
    customField7: { field: 'searchTicketsCustomField7', type: 'string' },
    customField8: { field: 'searchTicketsCustomField8', type: 'string' },
    customField9: { field: 'searchTicketsCustomField9', type: 'string' },
    customField10: { field: 'searchTicketsCustomField10', type: 'string' },
    channel: { field: 'searchTicketsChannel', type: 'string' },
    customerResponseTimeRange: { field: 'searchTicketsCustomerResponseTimeRange', type: 'string' },
    description: { field: 'searchTicketsDescription', type: 'string' },
    sortBy: { field: 'searchTicketsSortBy', type: 'string' },
    tag: { field: 'searchTicketsTag', type: 'string' },
    contactName: { field: 'searchTicketsContactName', type: 'string' },
    category: { field: 'searchTicketsCategory', type: 'string' },
  },
  move_ticket: {
    ticketId: { field: 'moveTicketTicketId', type: 'string' },
    departmentId: { field: 'moveTicketDepartmentId', type: 'string' },
    forumId: { field: 'moveTicketForumId', type: 'string' },
  },
  send_reply: {
    isPrivate: { field: 'sendReplyIsPrivate', type: 'boolean' },
    sendImmediately: { field: 'sendReplySendImmediately', type: 'boolean' },
    ticketId: { field: 'sendReplyTicketId', type: 'string' },
    content: { field: 'sendReplyContent', type: 'string' },
    contentType: { field: 'sendReplyContentType', type: 'string', omitEmpty: true },
    inReplyToThreadId: { field: 'sendReplyInReplyToThreadId', type: 'string' },
    direction: { field: 'sendReplyDirection', type: 'string', omitEmpty: true },
    cc: { field: 'sendReplyCc', type: 'string' },
    bcc: { field: 'sendReplyBcc', type: 'string' },
    hasAttach: { field: 'sendReplyHasAttach', type: 'boolean' },
    ticketStatus: { field: 'sendReplyTicketStatus', type: 'string' },
    attachmentIds: { field: 'sendReplyAttachmentIds', type: 'json' },
    to: { field: 'sendReplyTo', type: 'string' },
    fromEmailAddress: { field: 'sendReplyFromEmailAddress', type: 'string' },
    isForward: { field: 'sendReplyIsForward', type: 'boolean' },
  },
  list_contacts: {
    fields: { field: 'listContactsFields', type: 'string' },
    viewId: { field: 'listContactsViewId', type: 'string' },
    limit: { field: 'listContactsLimit', type: 'number' },
    from: { field: 'listContactsFrom', type: 'number' },
    include: { field: 'listContactsInclude', type: 'string' },
    sortBy: { field: 'listContactsSortBy', type: 'string' },
  },
  create_contact: {
    lastName: { field: 'createContactLastName', type: 'string' },
    accountId: { field: 'createContactAccountId', type: 'string' },
    firstName: { field: 'createContactFirstName', type: 'string' },
    secondaryEmail: { field: 'createContactSecondaryEmail', type: 'string' },
    phone: { field: 'createContactPhone', type: 'string' },
    mobile: { field: 'createContactMobile', type: 'string' },
    ownerId: { field: 'createContactOwnerId', type: 'string' },
    type: { field: 'createContactType', type: 'string' },
    email: { field: 'createContactEmail', type: 'string' },
    zip: { field: 'createContactZip', type: 'string' },
    country: { field: 'createContactCountry', type: 'string' },
    twitter: { field: 'createContactTwitter', type: 'string' },
    customFields: { field: 'createContactCustomFields', type: 'json' },
    city: { field: 'createContactCity', type: 'string' },
    street: { field: 'createContactStreet', type: 'string' },
    facebook: { field: 'createContactFacebook', type: 'string' },
    description: { field: 'createContactDescription', type: 'string' },
    state: { field: 'createContactState', type: 'string' },
    title: { field: 'createContactTitle', type: 'string' },
    language: { field: 'createContactLanguage', type: 'string' },
  },
  update_contact: {
    contactId: { field: 'updateContactContactId', type: 'string' },
    lastName: { field: 'updateContactLastName', type: 'string' },
    accountId: { field: 'updateContactAccountId', type: 'string' },
    firstName: { field: 'updateContactFirstName', type: 'string' },
    secondaryEmail: { field: 'updateContactSecondaryEmail', type: 'string' },
    phone: { field: 'updateContactPhone', type: 'string' },
    mobile: { field: 'updateContactMobile', type: 'string' },
    ownerId: { field: 'updateContactOwnerId', type: 'string' },
    type: { field: 'updateContactType', type: 'string' },
    email: { field: 'updateContactEmail', type: 'string' },
    zip: { field: 'updateContactZip', type: 'string' },
    country: { field: 'updateContactCountry', type: 'string' },
    twitter: { field: 'updateContactTwitter', type: 'string' },
    customFields: { field: 'updateContactCustomFields', type: 'json' },
    city: { field: 'updateContactCity', type: 'string' },
    street: { field: 'updateContactStreet', type: 'string' },
    facebook: { field: 'updateContactFacebook', type: 'string' },
    description: { field: 'updateContactDescription', type: 'string' },
    state: { field: 'updateContactState', type: 'string' },
    title: { field: 'updateContactTitle', type: 'string' },
    language: { field: 'updateContactLanguage', type: 'string' },
  },
  search_contacts: {
    email: { field: 'searchContactsEmail', type: 'string' },
    phone: { field: 'searchContactsPhone', type: 'string' },
    mobile: { field: 'searchContactsMobile', type: 'string' },
    accountName: { field: 'searchContactsAccountName', type: 'string' },
    createdTimeRange: { field: 'searchContactsCreatedTimeRange', type: 'string' },
    limit: { field: 'searchContactsLimit', type: 'number' },
    from: { field: 'searchContactsFrom', type: 'number' },
    modifiedTimeRange: { field: 'searchContactsModifiedTimeRange', type: 'string' },
    id: { field: 'searchContactsId', type: 'string' },
    _all: { field: 'searchContactsQuery', type: 'string' },
    customField1: { field: 'searchContactsCustomField1', type: 'string' },
    customField2: { field: 'searchContactsCustomField2', type: 'string' },
    customField3: { field: 'searchContactsCustomField3', type: 'string' },
    customField4: { field: 'searchContactsCustomField4', type: 'string' },
    customField5: { field: 'searchContactsCustomField5', type: 'string' },
    customField6: { field: 'searchContactsCustomField6', type: 'string' },
    customField7: { field: 'searchContactsCustomField7', type: 'string' },
    customField8: { field: 'searchContactsCustomField8', type: 'string' },
    customField9: { field: 'searchContactsCustomField9', type: 'string' },
    customField10: { field: 'searchContactsCustomField10', type: 'string' },
    lastName: { field: 'searchContactsLastName', type: 'string' },
    firstName: { field: 'searchContactsFirstName', type: 'string' },
    fullName: { field: 'searchContactsFullName', type: 'string' },
    sortBy: { field: 'searchContactsSortBy', type: 'string' },
  },
  list_accounts: {
    viewId: { field: 'listAccountsViewId', type: 'string' },
    limit: { field: 'listAccountsLimit', type: 'number' },
    from: { field: 'listAccountsFrom', type: 'number' },
    sortBy: { field: 'listAccountsSortBy', type: 'string' },
    fields: { field: 'listAccountsFields', type: 'string' },
  },
  create_account: {
    website: { field: 'createAccountWebsite', type: 'string' },
    accountName: { field: 'createAccountAccountName', type: 'string' },
    phone: { field: 'createAccountPhone', type: 'string' },
    email: { field: 'createAccountEmail', type: 'string' },
    country: { field: 'createAccountCountry', type: 'string' },
    code: { field: 'createAccountCode', type: 'string' },
    customFields: { field: 'createAccountCustomFields', type: 'json' },
    city: { field: 'createAccountCity', type: 'string' },
    street: { field: 'createAccountStreet', type: 'string' },
    annualrevenue: { field: 'createAccountAnnualrevenue', type: 'number' },
    description: { field: 'createAccountDescription', type: 'string' },
    industry: { field: 'createAccountIndustry', type: 'string' },
    state: { field: 'createAccountState', type: 'string' },
    ownerId: { field: 'createAccountOwnerId', type: 'string' },
    fax: { field: 'createAccountFax', type: 'string' },
    associatedSLAIds: { field: 'createAccountAssociatedSLAIds', type: 'json' },
  },
  update_account: {
    accountId: { field: 'updateAccountAccountId', type: 'string' },
    website: { field: 'updateAccountWebsite', type: 'string' },
    accountName: { field: 'updateAccountAccountName', type: 'string' },
    phone: { field: 'updateAccountPhone', type: 'string' },
    email: { field: 'updateAccountEmail', type: 'string' },
    country: { field: 'updateAccountCountry', type: 'string' },
    code: { field: 'updateAccountCode', type: 'string' },
    customFields: { field: 'updateAccountCustomFields', type: 'json' },
    city: { field: 'updateAccountCity', type: 'string' },
    street: { field: 'updateAccountStreet', type: 'string' },
    annualrevenue: { field: 'updateAccountAnnualrevenue', type: 'number' },
    description: { field: 'updateAccountDescription', type: 'string' },
    industry: { field: 'updateAccountIndustry', type: 'string' },
    state: { field: 'updateAccountState', type: 'string' },
    ownerId: { field: 'updateAccountOwnerId', type: 'string' },
    fax: { field: 'updateAccountFax', type: 'string' },
    associatedSLAIds: { field: 'updateAccountAssociatedSLAIds', type: 'json' },
  },
  search_accounts: {
    accountName: { field: 'searchAccountsAccountName', type: 'string' },
    createdTimeRange: { field: 'searchAccountsCreatedTimeRange', type: 'string' },
    limit: { field: 'searchAccountsLimit', type: 'number' },
    from: { field: 'searchAccountsFrom', type: 'number' },
    modifiedTimeRange: { field: 'searchAccountsModifiedTimeRange', type: 'string' },
    id: { field: 'searchAccountsId', type: 'string' },
    _all: { field: 'searchAccountsQuery', type: 'string' },
    customField1: { field: 'searchAccountsCustomField1', type: 'string' },
    customField2: { field: 'searchAccountsCustomField2', type: 'string' },
    customField3: { field: 'searchAccountsCustomField3', type: 'string' },
    customField4: { field: 'searchAccountsCustomField4', type: 'string' },
    customField5: { field: 'searchAccountsCustomField5', type: 'string' },
    customField6: { field: 'searchAccountsCustomField6', type: 'string' },
    customField7: { field: 'searchAccountsCustomField7', type: 'string' },
    customField8: { field: 'searchAccountsCustomField8', type: 'string' },
    customField9: { field: 'searchAccountsCustomField9', type: 'string' },
    customField10: { field: 'searchAccountsCustomField10', type: 'string' },
    sortBy: { field: 'searchAccountsSortBy', type: 'string' },
  },
  get_account: {
    include: { field: 'getAccountInclude', type: 'string' },
    accountId: { field: 'getAccountAccountId', type: 'string' },
  },
  list_departments: {
    chatStatus: { field: 'listDepartmentsChatStatus', type: 'string' },
    searchStr: { field: 'listDepartmentsSearchStr', type: 'string' },
    isEnabled: { field: 'listDepartmentsIsEnabled', type: 'boolean' },
    limit: { field: 'listDepartmentsLimit', type: 'number' },
    from: { field: 'listDepartmentsFrom', type: 'number' },
  },
  get_department: { departmentId: { field: 'getDepartmentDepartmentId', type: 'string' } },
  list_agents: {
    include: { field: 'listAgentsInclude', type: 'string' },
    roleIds: { field: 'listAgentsRoleIds', type: 'string' },
    searchStr: { field: 'listAgentsSearchStr', type: 'string' },
    cfSearchStr: { field: 'listAgentsCfSearchStr', type: 'string' },
    cfFieldName: { field: 'listAgentsCfFieldName', type: 'string' },
    fieldName: { field: 'listAgentsFieldName', type: 'string' },
    isLightAgent: { field: 'listAgentsIsLightAgent', type: 'boolean' },
    sortOrder: { field: 'listAgentsSortOrder', type: 'string' },
    limit: { field: 'listAgentsLimit', type: 'number' },
    rolePermissionType: { field: 'listAgentsRolePermissionType', type: 'string' },
    profileIds: { field: 'listAgentsProfileIds', type: 'string' },
    from: { field: 'listAgentsFrom', type: 'number' },
    isConfirmed: { field: 'listAgentsIsConfirmed', type: 'boolean' },
    departmentIds: { field: 'listAgentsDepartmentIds', type: 'string' },
    status: { field: 'listAgentsStatus', type: 'string' },
  },
  get_agent: {
    include: { field: 'getAgentInclude', type: 'string' },
    agentId: { field: 'getAgentAgentId', type: 'string' },
  },
  get_comment: {
    include: { field: 'getCommentInclude', type: 'string' },
    commentId: { field: 'getCommentCommentId', type: 'string' },
    ticketId: { field: 'getCommentTicketId', type: 'string' },
  },
  update_comment: {
    commentId: { field: 'updateCommentCommentId', type: 'string' },
    ticketId: { field: 'updateCommentTicketId', type: 'string' },
    content: { field: 'updateCommentContent', type: 'string' },
    attachmentIds: { field: 'updateCommentAttachmentIds', type: 'json' },
    contentType: { field: 'updateCommentContentType', type: 'string', omitEmpty: true },
  },
  delete_comment: {
    commentId: { field: 'deleteCommentCommentId', type: 'string' },
    ticketId: { field: 'deleteCommentTicketId', type: 'string' },
  },
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
        create_ticket: [{ text: 'Create ticket', field: 'createTicketSubject', core: true }],
        search_tickets: ['Search Tickets'],
        move_ticket: [
          { text: 'Move ticket', field: 'moveTicketTicketId', core: true },
          { text: 'to department', field: 'moveTicketDepartmentId', core: true },
        ],
        send_reply: [{ text: 'Reply to ticket', field: 'sendReplyTicketId', core: true }],
        list_contacts: ['List Contacts'],
        create_contact: [{ text: 'Create Contact', field: 'createContactLastName', core: true }],
        update_contact: [{ text: 'Update Contact', field: 'updateContactContactId', core: true }],
        search_contacts: ['Search Contacts'],
        list_accounts: ['List Accounts'],
        create_account: [{ text: 'Create Account', field: 'createAccountAccountName', core: true }],
        update_account: [{ text: 'Update Account', field: 'updateAccountAccountId', core: true }],
        search_accounts: ['Search Accounts'],
        get_account: [{ text: 'Get Account', field: 'getAccountAccountId', core: true }],
        list_departments: ['List Departments'],
        get_department: [
          { text: 'Get Department', field: 'getDepartmentDepartmentId', core: true },
        ],
        list_agents: ['List Agents'],
        get_agent: [{ text: 'Get Agent', field: 'getAgentAgentId', core: true }],
        get_comment: [
          { text: 'Get Comment', field: 'getCommentCommentId', core: true },
          { text: 'on ticket', field: 'getCommentTicketId', core: true },
        ],
        update_comment: [
          { text: 'Update Comment', field: 'updateCommentCommentId', core: true },
          { text: 'on ticket', field: 'updateCommentTicketId', core: true },
        ],
        delete_comment: [
          { text: 'Delete Comment', field: 'deleteCommentCommentId', core: true },
          { text: 'on ticket', field: 'deleteCommentTicketId', core: true },
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
    // Ticket ID (shared by several operations)
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
      condition: { field: 'operation', value: 'get_contact' },
      required: { field: 'operation', value: 'get_contact' },
    },
    // Add comment
    {
      id: 'content',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Comment content',
      condition: { field: 'operation', value: 'add_comment' },
      required: { field: 'operation', value: 'add_comment' },
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'Plain text', id: 'plainText' },
        { label: 'HTML', id: 'html' },
      ],
      value: () => 'plainText',
      mode: 'advanced',
      condition: { field: 'operation', value: 'add_comment' },
    },
    {
      id: 'isPublic',
      title: 'Public Comment',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'add_comment' },
    },
    // Update ticket
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'New subject',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    // status/priority are deliberately split per operation rather than shared.
    // A subBlock keeps its value when the operation changes, and the two uses are
    // semantically opposite: on list_tickets they are filters (comma-separated,
    // matching), on update_ticket they are the new value written to the ticket.
    // Sharing one field meant a filter of "Open,On Hold" could be PATCHed onto a
    // ticket, and an update value of "Closed" could silently filter a later list.
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      placeholder: 'e.g. Closed',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'e.g. High',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'statusFilter',
      title: 'Status',
      type: 'short-input',
      placeholder: 'Filter, e.g. Open,On Hold',
      condition: { field: 'operation', value: 'list_tickets' },
    },
    {
      id: 'priorityFilter',
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
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'manualAssigneeId',
      title: 'Assignee ID',
      type: 'short-input',
      canonicalParamId: 'assigneeId',
      placeholder: 'Agent ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Replace the ticket description',
      condition: { field: 'operation', value: 'update_ticket' },
      mode: 'advanced',
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'long-input',
      placeholder: 'Resolution notes',
      condition: { field: 'operation', value: 'update_ticket' },
      mode: 'advanced',
    },
    // Zoho marks classification `x-dynamic-enum` and documents "Custom values
    // are also supported", so the picklist is portal-editable — a closed
    // dropdown would lock out any portal that renamed or replaced the
    // system-defined values. Free text, with those values as the placeholder.
    {
      id: 'classification',
      title: 'Classification',
      type: 'short-input',
      placeholder: 'e.g. Problem, Request, Question',
      condition: { field: 'operation', value: 'update_ticket' },
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
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'manualDepartmentId',
      title: 'Department ID',
      type: 'short-input',
      canonicalParamId: 'departmentId',
      placeholder: 'Move ticket to this department',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'category',
      title: 'Category',
      type: 'short-input',
      placeholder: 'Ticket category',
      condition: { field: 'operation', value: 'update_ticket' },
      mode: 'advanced',
    },
    {
      id: 'subCategory',
      title: 'Sub-category',
      type: 'short-input',
      placeholder: 'Ticket sub-category',
      condition: { field: 'operation', value: 'update_ticket' },
      mode: 'advanced',
    },
    {
      id: 'dueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: { field: 'operation', value: 'update_ticket' },
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
      placeholder: '{"cf_severity": "High"}',
      condition: { field: 'operation', value: 'update_ticket' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object mapping Zoho Desk custom field API names (they start with cf_) to values. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    // Get attachment
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
    // Shared filters / options
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
      condition: { field: 'operation', value: 'list_tickets' },
    },
    {
      id: 'manualDepartmentIds',
      title: 'Department IDs',
      type: 'short-input',
      canonicalParamId: 'departmentIds',
      placeholder: 'Comma-separated department IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tickets' },
    },
    {
      id: 'include',
      title: 'Include',
      type: 'short-input',
      placeholder: 'e.g. contacts,assignee',
      condition: { field: 'operation', value: 'list_tickets' },
      mode: 'advanced',
    },
    // Split from the list_tickets `include` above rather than shared: Get Ticket
    // additionally accepts `contract` and `skills`, which List Tickets does not
    // document. A shared subBlock keeps its value across an operation change, so
    // `skills` set here would follow the user to List Tickets and put an
    // undocumented token on the wire.
    {
      id: 'ticketInclude',
      title: 'Include',
      type: 'short-input',
      placeholder: 'e.g. contacts,contract,skills',
      condition: { field: 'operation', value: 'get_ticket' },
      mode: 'advanced',
    },
    {
      id: 'contactInclude',
      title: 'Include',
      type: 'short-input',
      placeholder: 'accounts,owner',
      condition: { field: 'operation', value: 'get_contact' },
      mode: 'advanced',
    },
    {
      id: 'threadInclude',
      title: 'Include',
      type: 'short-input',
      placeholder: 'plainText',
      condition: { field: 'operation', value: 'get_thread' },
      mode: 'advanced',
    },
    // Sort is split per operation because Zoho allows a different field set on
    // each list endpoint (tickets sort on createdTime/customerResponseTime/
    // responseDueDate, comments on commentedTime, threads on sendDateTime). One
    // shared subBlock keeps its value across an operation change, so it would
    // carry a field name the next endpoint rejects.
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'createdTime, customerResponseTime, or responseDueDate',
      condition: { field: 'operation', value: 'list_tickets' },
      mode: 'advanced',
    },
    {
      id: 'commentSortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'commentedTime or -commentedTime',
      condition: { field: 'operation', value: 'list_comments' },
      mode: 'advanced',
    },
    {
      id: 'threadSortBy',
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
      placeholder: 'Start index (0-based)',
      condition: {
        field: 'operation',
        value: ['list_tickets', 'list_comments', 'list_threads'],
      },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (tickets/comments 100, threads 200)',
      condition: {
        field: 'operation',
        value: ['list_tickets', 'list_comments', 'list_threads'],
      },
      mode: 'advanced',
    },
    {
      id: 'createTicketProductId',
      title: 'Product ID',
      type: 'short-input',
      placeholder: 'ID of the product to associate the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketPhone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Phone number of the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketSubject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Subject of the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
      required: true,
    },
    {
      id: 'createTicketDueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'createTicketChannel',
      title: 'Channel',
      type: 'short-input',
      placeholder: 'Channel through which the ticket is being created.',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketLanguage',
      title: 'Language',
      type: 'short-input',
      placeholder: 'Language preference of the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketPriority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'Enter priority',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketAssigneeId',
      title: 'Assignee ID',
      type: 'short-input',
      placeholder: 'ID of the assignee',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email ID of the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
    },
    {
      id: 'createTicketSubCategory',
      title: 'Sub Category',
      type: 'short-input',
      placeholder: 'Subcategory of the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketCustomFields',
      title: 'Custom Fields',
      type: 'code',
      placeholder: '{"cf_example": "value"}',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        placeholder: 'Describe the custom fields',
        prompt: 'Custom fields in the ticket JSON object. Return ONLY the JSON object.',
      },
    },
    {
      id: 'createTicketDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Description of the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketClassification',
      title: 'Classification',
      type: 'short-input',
      placeholder: 'Enter classification',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketCategory',
      title: 'Category',
      type: 'short-input',
      placeholder: 'Category of the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketStatus',
      title: 'Status',
      type: 'short-input',
      placeholder: 'Enter status',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketContactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Enter contact id',
      condition: { field: 'operation', value: 'create_ticket' },
    },
    {
      id: 'createTicketDepartmentId',
      title: 'Department ID',
      type: 'short-input',
      placeholder: 'ID of the department to associate the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
      required: true,
    },
    {
      id: 'createTicketContact',
      title: 'Contact',
      type: 'code',
      placeholder: '{"email": "person@example.com"}',
      condition: { field: 'operation', value: 'create_ticket' },
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
      id: 'createTicketUploads',
      title: 'Uploads',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: 'create_ticket' },
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
      id: 'createTicketResolution',
      title: 'Resolution',
      type: 'long-input',
      placeholder: 'Resolution notes of the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketWebUrl',
      title: 'Web Url',
      type: 'short-input',
      placeholder: 'URL to access the resource',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketSharedDepartments',
      title: 'Shared Departments',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: 'create_ticket' },
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
      id: 'createTicketTeamId',
      title: 'Team ID',
      type: 'short-input',
      placeholder: 'ID of the team to assign the ticket',
      condition: { field: 'operation', value: 'create_ticket' },
      mode: 'advanced',
    },
    {
      id: 'createTicketSecondaryContacts',
      title: 'Secondary Contacts',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: 'create_ticket' },
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
      id: 'createTicketEntitySkills',
      title: 'Entity Skills',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: 'create_ticket' },
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
      id: 'searchTicketsEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Enter email',
      condition: { field: 'operation', value: 'search_tickets' },
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt: `The corresponding email address associated with the ticket. example: 1. email=jack* 2.email=\${notempty} 3.email=\${empty} wildcard search empty check not empty check Comma-separated values. Return ONLY the comma-separated values.`,
      },
    },
    {
      id: 'searchTicketsPhone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Enter phone',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'The phone number provided in the ticket wildcard search empty check not empty check Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchTicketsTicketNumber',
      title: 'Ticket Number',
      type: 'short-input',
      placeholder: "The ticket's serial number exact match Comma-separated values.",
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          "The ticket's serial number exact match Comma-separated values. Return ONLY the comma-separated values.",
      },
    },
    {
      id: 'searchTicketsAccountName',
      title: 'Account Name',
      type: 'short-input',
      placeholder:
        'Name of the account associated with the ticket wildcard search empty check not empty check',
      condition: { field: 'operation', value: 'search_tickets' },
    },
    {
      id: 'searchTicketsSubject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Subject of the ticket wildcard search',
      condition: { field: 'operation', value: 'search_tickets' },
    },
    {
      id: 'searchTicketsDepartmentId',
      title: 'Department ID',
      type: 'short-input',
      placeholder: 'Enter department id',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsProductName',
      title: 'Product Name',
      type: 'short-input',
      placeholder:
        'Name of the product associated with the ticket wildcard search empty check not empty check',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
      condition: { field: 'operation', value: 'search_tickets' },
    },
    {
      id: 'searchTicketsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Page size (1-100; default 10).',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'Pagination start index (0-999; search returns at most the first 1000 matches).',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsDueDateRange',
      title: 'Due Date Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
      },
    },
    {
      id: 'searchTicketsId',
      title: 'Id',
      type: 'short-input',
      placeholder: 'ID of the ticket exact match Comma-separated values.',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'ID of the ticket exact match Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchTicketsProductId',
      title: 'Product ID',
      type: 'short-input',
      placeholder:
        'ID of the product associated with the ticket exact match Comma-separated values.',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'ID of the product associated with the ticket exact match Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchTicketsContactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'ID of the contact who raised the ticket exact match Comma-separated values.',
      condition: { field: 'operation', value: 'search_tickets' },
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'ID of the contact who raised the ticket exact match Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchTicketsCreatedTimeRange',
      title: 'Created Time Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
      },
    },
    {
      id: 'searchTicketsPriority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'Priority of the ticket exact match Comma-separated values.',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Priority of the ticket exact match Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchTicketsAssigneeId',
      title: 'Assignee ID',
      type: 'short-input',
      placeholder:
        'ID of the agent who is assigned to resolve the ticket exact match Comma-separated values.',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'ID of the agent who is assigned to resolve the ticket exact match Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchTicketsAccountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder:
        'ID of the account associated with the ticket exact match Comma-separated values.',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'ID of the account associated with the ticket exact match Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchTicketsModifiedTimeRange',
      title: 'Modified Time Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
      },
    },
    {
      id: 'searchTicketsStatus',
      title: 'Status',
      type: 'short-input',
      placeholder: 'Enter status',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt: `Status of the ticket inclusive of custom status. example: 1. status=open,in progress 2. status=\${open} exact match Comma-separated values. Return ONLY the comma-separated values.`,
      },
    },
    {
      id: 'searchTicketsCustomField1',
      title: 'Custom Field1',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCustomField2',
      title: 'Custom Field2',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCustomField3',
      title: 'Custom Field3',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCustomField4',
      title: 'Custom Field4',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCustomField5',
      title: 'Custom Field5',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCustomField6',
      title: 'Custom Field6',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCustomField7',
      title: 'Custom Field7',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCustomField8',
      title: 'Custom Field8',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCustomField9',
      title: 'Custom Field9',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCustomField10',
      title: 'Custom Field10',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsChannel',
      title: 'Channel',
      type: 'short-input',
      placeholder:
        'The channel through which the ticket was received exact match empty check not empty check',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCustomerResponseTimeRange',
      title: 'Customer Response Time Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
      },
    },
    {
      id: 'searchTicketsDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Description of the ticket wildcard search',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsSortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'Enter sort by',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsTag',
      title: 'Tag',
      type: 'short-input',
      placeholder: 'The tag associated with the ticket wildcard search empty check not empty check',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsContactName',
      title: 'Contact Name',
      type: 'short-input',
      placeholder: 'The name of the contact who raised the ticket wildcard search',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'searchTicketsCategory',
      title: 'Category',
      type: 'short-input',
      placeholder: 'The category of the ticket wildcard search empty check not empty check',
      condition: { field: 'operation', value: 'search_tickets' },
      mode: 'advanced',
    },
    {
      id: 'moveTicketTicketId',
      title: 'Ticket ID',
      type: 'short-input',
      placeholder: 'Ticket ID',
      condition: { field: 'operation', value: 'move_ticket' },
      required: true,
    },
    {
      id: 'moveTicketDepartmentId',
      title: 'Department ID',
      type: 'short-input',
      placeholder: 'ID of the department to move the ticket',
      condition: { field: 'operation', value: 'move_ticket' },
      required: true,
    },
    {
      id: 'moveTicketForumId',
      title: 'Forum ID',
      type: 'short-input',
      placeholder:
        'ID of the community sub-category to move the forum ticket (forum topic converted into a ticket).',
      condition: { field: 'operation', value: 'move_ticket' },
      mode: 'advanced',
    },
    {
      id: 'sendReplyIsPrivate',
      title: 'Is Private',
      type: 'dropdown',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'sendReplySendImmediately',
      title: 'Send Immediately',
      type: 'dropdown',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'sendReplyTicketId',
      title: 'Ticket ID',
      type: 'short-input',
      placeholder: 'Ticket ID',
      condition: { field: 'operation', value: 'send_reply' },
      required: true,
    },
    {
      id: 'sendReplyContent',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Content of the thread',
      condition: { field: 'operation', value: 'send_reply' },
      required: true,
    },
    {
      id: 'sendReplyContentType',
      title: 'Content Type',
      type: 'dropdown',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'html', id: 'html' },
        { label: 'plainText', id: 'plainText' },
      ],
      value: () => '',
    },
    {
      id: 'sendReplyInReplyToThreadId',
      title: 'In Reply To Thread ID',
      type: 'short-input',
      placeholder:
        'ID of the thread to which current thread is a reply, applicable only for EMAIL channel',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
    },
    {
      id: 'sendReplyDirection',
      title: 'Direction',
      type: 'dropdown',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'in', id: 'in' },
        { label: 'out', id: 'out' },
      ],
      value: () => '',
    },
    {
      id: 'sendReplyCc',
      title: 'Cc',
      type: 'short-input',
      placeholder: 'Email ID to be CC-ed. Applicable only for EMAIL channel',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
    },
    {
      id: 'sendReplyBcc',
      title: 'Bcc',
      type: 'short-input',
      placeholder: 'Email ID to be BCC-ed., if any exist. Applicable only for EMAIL channel',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
    },
    {
      id: 'sendReplyHasAttach',
      title: 'Has Attach',
      type: 'dropdown',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'sendReplyTicketStatus',
      title: 'Ticket Status',
      type: 'short-input',
      placeholder:
        'Status of the ticket. Includes the custom statuses configured in your help desk portal.',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
    },
    {
      id: 'sendReplyAttachmentIds',
      title: 'Attachment IDs',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: 'send_reply' },
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
      id: 'sendReplyTo',
      title: 'To',
      type: 'short-input',
      placeholder: 'To email ID in the thread, applicable only for EMAIL channel',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
    },
    {
      id: 'sendReplyFromEmailAddress',
      title: 'From Email Address',
      type: 'short-input',
      placeholder: 'Sender email address configured in your Zoho Desk portal.',
      condition: { field: 'operation', value: 'send_reply' },
      required: true,
    },
    {
      id: 'sendReplyIsForward',
      title: 'Is Forward',
      type: 'dropdown',
      condition: { field: 'operation', value: 'send_reply' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'listContactsFields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'Field names, separated by commas',
      condition: { field: 'operation', value: 'list_contacts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Key that returns the values of mentioned fields (both pre-defined and custom) in your portal. All field types except multi-text are supported. Standard, non-editable fields are supported too. These fields include: photoURL, webUrl. Maximum of 30 fields is supported as comma separated values. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'listContactsViewId',
      title: 'View ID',
      type: 'short-input',
      placeholder: 'ID of the view to apply while fetching the resources',
      condition: { field: 'operation', value: 'list_contacts' },
      mode: 'advanced',
    },
    {
      id: 'listContactsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Page size (1-100).',
      condition: { field: 'operation', value: 'list_contacts' },
      mode: 'advanced',
    },
    {
      id: 'listContactsFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'Pagination start index; use the provider index for this endpoint (default 1).',
      condition: { field: 'operation', value: 'list_contacts' },
      mode: 'advanced',
    },
    {
      id: 'listContactsInclude',
      title: 'Include',
      type: 'short-input',
      placeholder:
        'Secondary information related to the contact.Value supported is accounts. Comma-separated values.',
      condition: { field: 'operation', value: 'list_contacts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Secondary information related to the contact.Value supported is accounts. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'listContactsSortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'Enter sort by',
      condition: { field: 'operation', value: 'list_contacts' },
      mode: 'advanced',
    },
    {
      id: 'createContactLastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Last name of the contact',
      condition: { field: 'operation', value: 'create_contact' },
      required: true,
    },
    {
      id: 'createContactAccountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Account to which the contact is mapped',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactFirstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'First name of the contact',
      condition: { field: 'operation', value: 'create_contact' },
    },
    {
      id: 'createContactSecondaryEmail',
      title: 'Secondary Email',
      type: 'short-input',
      placeholder: 'Secondary email ID of the contact',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactPhone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Phone number of the contact',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactMobile',
      title: 'Mobile',
      type: 'short-input',
      placeholder: 'Mobile number of the contact',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactOwnerId',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'ID of the user who creates the contact',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactType',
      title: 'Type',
      type: 'short-input',
      placeholder: 'Contact type',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email ID of the contact',
      condition: { field: 'operation', value: 'create_contact' },
    },
    {
      id: 'createContactZip',
      title: 'Zip',
      type: 'short-input',
      placeholder: 'Zip code',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: "Contact's country of residence",
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactTwitter',
      title: 'Twitter',
      type: 'short-input',
      placeholder: 'Twitter ID of the contact',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactCustomFields',
      title: 'Custom Fields',
      type: 'code',
      placeholder: '{"cf_example": "value"}',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        placeholder: 'Describe the custom fields',
        prompt:
          'User-defined fields related to the contact JSON object. Return ONLY the JSON object.',
      },
    },
    {
      id: 'createContactCity',
      title: 'City',
      type: 'short-input',
      placeholder: "Contact's city of residence",
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactStreet',
      title: 'Street',
      type: 'short-input',
      placeholder: "Contact's address",
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactFacebook',
      title: 'Facebook',
      type: 'short-input',
      placeholder: 'Facebook ID of the contact',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Contact description',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactState',
      title: 'State',
      type: 'short-input',
      placeholder: "Contact's state of residence",
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactTitle',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Contact title',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'createContactLanguage',
      title: 'Language',
      type: 'short-input',
      placeholder: 'Language preference to set for the Contact',
      condition: { field: 'operation', value: 'create_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactContactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Contact ID',
      condition: { field: 'operation', value: 'update_contact' },
      required: true,
    },
    {
      id: 'updateContactLastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Last name of the contact',
      condition: { field: 'operation', value: 'update_contact' },
    },
    {
      id: 'updateContactAccountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Account to which the contact is mapped',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactFirstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'First name of the contact',
      condition: { field: 'operation', value: 'update_contact' },
    },
    {
      id: 'updateContactSecondaryEmail',
      title: 'Secondary Email',
      type: 'short-input',
      placeholder: 'Secondary email ID of the contact',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactPhone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Phone number of the contact',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactMobile',
      title: 'Mobile',
      type: 'short-input',
      placeholder: 'Mobile number of the contact',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactOwnerId',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'ID of the user who creates the contact',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactType',
      title: 'Type',
      type: 'short-input',
      placeholder: 'Contact type',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email ID of the contact',
      condition: { field: 'operation', value: 'update_contact' },
    },
    {
      id: 'updateContactZip',
      title: 'Zip',
      type: 'short-input',
      placeholder: 'Zip code',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: "Contact's country of residence",
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactTwitter',
      title: 'Twitter',
      type: 'short-input',
      placeholder: 'Twitter ID of the contact',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactCustomFields',
      title: 'Custom Fields',
      type: 'code',
      placeholder: '{"cf_example": "value"}',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        placeholder: 'Describe the custom fields',
        prompt:
          'User-defined fields related to the contact JSON object. Return ONLY the JSON object.',
      },
    },
    {
      id: 'updateContactCity',
      title: 'City',
      type: 'short-input',
      placeholder: "Contact's city of residence",
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactStreet',
      title: 'Street',
      type: 'short-input',
      placeholder: "Contact's address",
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactFacebook',
      title: 'Facebook',
      type: 'short-input',
      placeholder: 'Facebook ID of the contact',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Contact description',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactState',
      title: 'State',
      type: 'short-input',
      placeholder: "Contact's state of residence",
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactTitle',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Contact title',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'updateContactLanguage',
      title: 'Language',
      type: 'short-input',
      placeholder: 'Language preference to set for the Contact',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsEmail',
      title: 'Email',
      type: 'short-input',
      placeholder:
        'Email ID of the contact wildcard search empty check not empty check Comma-separated values.',
      condition: { field: 'operation', value: 'search_contacts' },
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Email ID of the contact wildcard search empty check not empty check Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchContactsPhone',
      title: 'Phone',
      type: 'short-input',
      placeholder:
        'Phone number of the contact wildcard search empty check not empty check Comma-separated values.',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Phone number of the contact wildcard search empty check not empty check Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchContactsMobile',
      title: 'Mobile',
      type: 'short-input',
      placeholder:
        'Mobile number of the contact wildcard search empty check not empty check Comma-separated values.',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Mobile number of the contact wildcard search empty check not empty check Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchContactsAccountName',
      title: 'Account Name',
      type: 'short-input',
      placeholder:
        'Name of the account associated with the Contact wildcard search empty check not empty check',
      condition: { field: 'operation', value: 'search_contacts' },
    },
    {
      id: 'searchContactsCreatedTimeRange',
      title: 'Created Time Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
      },
    },
    {
      id: 'searchContactsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Page size (1-100; default 10).',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'Pagination start index (0-999; search returns at most the first 1000 matches).',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsModifiedTimeRange',
      title: 'Modified Time Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
      },
    },
    {
      id: 'searchContactsId',
      title: 'Id',
      type: 'short-input',
      placeholder: 'ID of the contact exact match Comma-separated values.',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'ID of the contact exact match Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchContactsQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
      condition: { field: 'operation', value: 'search_contacts' },
    },
    {
      id: 'searchContactsCustomField1',
      title: 'Custom Field1',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsCustomField2',
      title: 'Custom Field2',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsCustomField3',
      title: 'Custom Field3',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsCustomField4',
      title: 'Custom Field4',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsCustomField5',
      title: 'Custom Field5',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsCustomField6',
      title: 'Custom Field6',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsCustomField7',
      title: 'Custom Field7',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsCustomField8',
      title: 'Custom Field8',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsCustomField9',
      title: 'Custom Field9',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsCustomField10',
      title: 'Custom Field10',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsLastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Last name of the contact wildcard search',
      condition: { field: 'operation', value: 'search_contacts' },
    },
    {
      id: 'searchContactsFirstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'First name of the contact wildcard search empty check not empty check',
      condition: { field: 'operation', value: 'search_contacts' },
    },
    {
      id: 'searchContactsFullName',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'Full name of the contact wildcard search',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'searchContactsSortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'Enter sort by',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'listAccountsViewId',
      title: 'View ID',
      type: 'short-input',
      placeholder: 'ID of the view to apply while fetching the resources',
      condition: { field: 'operation', value: 'list_accounts' },
      mode: 'advanced',
    },
    {
      id: 'listAccountsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Page size (1-100).',
      condition: { field: 'operation', value: 'list_accounts' },
      mode: 'advanced',
    },
    {
      id: 'listAccountsFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'Pagination start index; use the provider index for this endpoint (default 1).',
      condition: { field: 'operation', value: 'list_accounts' },
      mode: 'advanced',
    },
    {
      id: 'listAccountsSortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'Enter sort by',
      condition: { field: 'operation', value: 'list_accounts' },
      mode: 'advanced',
    },
    {
      id: 'listAccountsFields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'Field names, separated by commas',
      condition: { field: 'operation', value: 'list_accounts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Key that returns the values of mentioned fields (both pre-defined and custom) in your portal. All field types except multi-text are supported. Standard, non-editable fields are supported too. These fields include: photoURL, webUrl. Maximum of 30 fields is supported as comma separated values. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'createAccountWebsite',
      title: 'Website',
      type: 'short-input',
      placeholder: 'Website of the account',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountAccountName',
      title: 'Account Name',
      type: 'short-input',
      placeholder: 'Name of the account',
      condition: { field: 'operation', value: 'create_account' },
      required: true,
    },
    {
      id: 'createAccountPhone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Phone number of the account',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email ID of the account',
      condition: { field: 'operation', value: 'create_account' },
    },
    {
      id: 'createAccountCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'Country in which the account is based',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountCode',
      title: 'Code',
      type: 'short-input',
      placeholder: 'Zip code',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountCustomFields',
      title: 'Custom Fields',
      type: 'code',
      placeholder: '{"cf_example": "value"}',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        placeholder: 'Describe the custom fields',
        prompt:
          'User-defined fields associated with the account JSON object. Return ONLY the JSON object.',
      },
    },
    {
      id: 'createAccountCity',
      title: 'City',
      type: 'short-input',
      placeholder: 'City in which the account is based',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountStreet',
      title: 'Street',
      type: 'short-input',
      placeholder: 'Address of the account',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountAnnualrevenue',
      title: 'Annualrevenue',
      type: 'short-input',
      placeholder: 'Annual revenue of the account',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'A short description of the account',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountIndustry',
      title: 'Industry',
      type: 'short-input',
      placeholder: 'Industry in which the account operates',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountState',
      title: 'State',
      type: 'short-input',
      placeholder: 'State in which the account is based',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountOwnerId',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'ID of account owner',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountFax',
      title: 'Fax',
      type: 'short-input',
      placeholder: 'Fax number of the account',
      condition: { field: 'operation', value: 'create_account' },
      mode: 'advanced',
    },
    {
      id: 'createAccountAssociatedSLAIds',
      title: 'Associated Slaids',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: 'create_account' },
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
      id: 'updateAccountAccountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Unique ID of the account',
      condition: { field: 'operation', value: 'update_account' },
      required: true,
    },
    {
      id: 'updateAccountWebsite',
      title: 'Website',
      type: 'short-input',
      placeholder: 'Website of the account',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountAccountName',
      title: 'Account Name',
      type: 'short-input',
      placeholder: 'Name of the account',
      condition: { field: 'operation', value: 'update_account' },
    },
    {
      id: 'updateAccountPhone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Phone number of the account',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email ID of the account',
      condition: { field: 'operation', value: 'update_account' },
    },
    {
      id: 'updateAccountCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'Country in which the account is based',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountCode',
      title: 'Code',
      type: 'short-input',
      placeholder: 'Zip code',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountCustomFields',
      title: 'Custom Fields',
      type: 'code',
      placeholder: '{"cf_example": "value"}',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        placeholder: 'Describe the custom fields',
        prompt:
          'User-defined fields associated with the account JSON object. Return ONLY the JSON object.',
      },
    },
    {
      id: 'updateAccountCity',
      title: 'City',
      type: 'short-input',
      placeholder: 'City in which the account is based',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountStreet',
      title: 'Street',
      type: 'short-input',
      placeholder: 'Address of the account',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountAnnualrevenue',
      title: 'Annualrevenue',
      type: 'short-input',
      placeholder: 'Annual revenue of the account',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'A short description of the account',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountIndustry',
      title: 'Industry',
      type: 'short-input',
      placeholder: 'Industry in which the account operates',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountState',
      title: 'State',
      type: 'short-input',
      placeholder: 'State in which the account is based',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountOwnerId',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'ID of account owner',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountFax',
      title: 'Fax',
      type: 'short-input',
      placeholder: 'Fax number of the account',
      condition: { field: 'operation', value: 'update_account' },
      mode: 'advanced',
    },
    {
      id: 'updateAccountAssociatedSLAIds',
      title: 'Associated Slaids',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: 'update_account' },
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
      id: 'searchAccountsAccountName',
      title: 'Account Name',
      type: 'short-input',
      placeholder: 'Name of the account wildcard search',
      condition: { field: 'operation', value: 'search_accounts' },
    },
    {
      id: 'searchAccountsCreatedTimeRange',
      title: 'Created Time Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
      },
    },
    {
      id: 'searchAccountsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Page size (1-100; default 10).',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'Pagination start index (0-999; search returns at most the first 1000 matches).',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsModifiedTimeRange',
      title: 'Modified Time Range',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00.000Z,2026-01-31T23:59:59.000Z',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the date or time range',
        prompt:
          'Generate two comma-separated ISO 8601 timestamps. Return ONLY the comma-separated timestamps.',
      },
    },
    {
      id: 'searchAccountsId',
      title: 'Id',
      type: 'short-input',
      placeholder: 'ID of the account exact match Comma-separated values.',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'ID of the account exact match Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'searchAccountsQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
      condition: { field: 'operation', value: 'search_accounts' },
    },
    {
      id: 'searchAccountsCustomField1',
      title: 'Custom Field1',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsCustomField2',
      title: 'Custom Field2',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsCustomField3',
      title: 'Custom Field3',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsCustomField4',
      title: 'Custom Field4',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsCustomField5',
      title: 'Custom Field5',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsCustomField6',
      title: 'Custom Field6',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsCustomField7',
      title: 'Custom Field7',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsCustomField8',
      title: 'Custom Field8',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsCustomField9',
      title: 'Custom Field9',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsCustomField10',
      title: 'Custom Field10',
      type: 'short-input',
      placeholder: 'cf_field_name:search value',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'searchAccountsSortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder:
        'Sort field: relevance, modifiedTime, createdTime, accountName. Prefix with - for descending.',
      condition: { field: 'operation', value: 'search_accounts' },
      mode: 'advanced',
    },
    {
      id: 'getAccountInclude',
      title: 'Include',
      type: 'short-input',
      placeholder: 'Allowed values are : owner',
      condition: { field: 'operation', value: 'get_account' },
      mode: 'advanced',
    },
    {
      id: 'getAccountAccountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Unique ID of the account',
      condition: { field: 'operation', value: 'get_account' },
      required: true,
    },
    {
      id: 'listDepartmentsChatStatus',
      title: 'Chat Status',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list_departments' },
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
      id: 'listDepartmentsSearchStr',
      title: 'Search Str',
      type: 'short-input',
      placeholder: 'Search text; use * for wildcards',
      condition: { field: 'operation', value: 'list_departments' },
      mode: 'advanced',
    },
    {
      id: 'listDepartmentsIsEnabled',
      title: 'Is Enabled',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list_departments' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'listDepartmentsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Page size (0-200; default 10).',
      condition: { field: 'operation', value: 'list_departments' },
      mode: 'advanced',
    },
    {
      id: 'listDepartmentsFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'Pagination start index (0-based).',
      condition: { field: 'operation', value: 'list_departments' },
      mode: 'advanced',
    },
    {
      id: 'getDepartmentDepartmentId',
      title: 'Department ID',
      type: 'short-input',
      placeholder: 'Unique ID of the department',
      condition: { field: 'operation', value: 'get_department' },
      required: true,
    },
    {
      id: 'listAgentsInclude',
      title: 'Include',
      type: 'short-input',
      placeholder: 'Related data to include, separated by commas',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Secondary information related to agents, The allowed values are profile, role. You can include all two values by separating them with commas in the API request. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'listAgentsRoleIds',
      title: 'Role IDs',
      type: 'short-input',
      placeholder:
        'Comma-separated array of role IDs. Maximum number of IDs allowed is 50. Comma-separated values.',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Comma-separated array of role IDs. Maximum number of IDs allowed is 50. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'listAgentsSearchStr',
      title: 'Search Str',
      type: 'short-input',
      placeholder: 'Search text; use * for wildcards',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
    },
    {
      id: 'listAgentsCfSearchStr',
      title: 'Cf Search Str',
      type: 'short-input',
      placeholder:
        'String to search for agents by custom field. The string must contain at least one character',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
    },
    {
      id: 'listAgentsCfFieldName',
      title: 'Cf Field Name',
      type: 'short-input',
      placeholder:
        'API name of the custom field that must be used for searching and listing agents',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
    },
    {
      id: 'listAgentsFieldName',
      title: 'Field Name',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list_agents' },
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
      id: 'listAgentsIsLightAgent',
      title: 'Is Light Agent',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'listAgentsSortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'asc', id: 'asc' },
        { label: 'desc', id: 'desc' },
      ],
      value: () => '',
    },
    {
      id: 'listAgentsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Page size (0-200; default 10).',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
    },
    {
      id: 'listAgentsRolePermissionType',
      title: 'Role Permission Type',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list_agents' },
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
      id: 'listAgentsProfileIds',
      title: 'Profile IDs',
      type: 'short-input',
      placeholder: 'Enter profile ids',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Comma-separated array of profile IDs. Maximum number of IDs allowed is 50. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'listAgentsFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'Pagination start index (0-based).',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
    },
    {
      id: 'listAgentsIsConfirmed',
      title: 'Is Confirmed',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'listAgentsDepartmentIds',
      title: 'Department IDs',
      type: 'short-input',
      placeholder: 'Enter department ids',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Comma-separated array of department IDs. Maximum number of IDs allowed is 50. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'listAgentsStatus',
      title: 'Status',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list_agents' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'ACTIVE', id: 'ACTIVE' },
        { label: 'DISABLED', id: 'DISABLED' },
        { label: 'DELETED', id: 'DELETED' },
        { label: 'IMPORTED', id: 'IMPORTED' },
      ],
      value: () => '',
    },
    {
      id: 'getAgentInclude',
      title: 'Include',
      type: 'short-input',
      placeholder: 'Related data to include, separated by commas',
      condition: { field: 'operation', value: 'get_agent' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Secondary information related to the agent. Values allowed are profile, role, associatedDepartments, associatedChatDepartments and verifiedEmails. Separate multiple values with commas. Comma-separated values. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'getAgentAgentId',
      title: 'Agent ID',
      type: 'short-input',
      placeholder: 'Agent ID',
      condition: { field: 'operation', value: 'get_agent' },
      required: true,
    },
    {
      id: 'getCommentInclude',
      title: 'Include',
      type: 'short-input',
      placeholder:
        'Related comment data to include: mentions, plainText, or both separated by commas.',
      condition: { field: 'operation', value: 'get_comment' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the values to include',
        prompt:
          'Related comment data to include: mentions, plainText, or both separated by commas. Return ONLY the comma-separated values.',
      },
    },
    {
      id: 'getCommentCommentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Comment ID',
      condition: { field: 'operation', value: 'get_comment' },
      required: true,
    },
    {
      id: 'getCommentTicketId',
      title: 'Ticket ID',
      type: 'short-input',
      placeholder: 'Ticket ID',
      condition: { field: 'operation', value: 'get_comment' },
      required: true,
    },
    {
      id: 'updateCommentCommentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Comment ID',
      condition: { field: 'operation', value: 'update_comment' },
      required: true,
    },
    {
      id: 'updateCommentTicketId',
      title: 'Ticket ID',
      type: 'short-input',
      placeholder: 'Ticket ID',
      condition: { field: 'operation', value: 'update_comment' },
      required: true,
    },
    {
      id: 'updateCommentContent',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter content',
      condition: { field: 'operation', value: 'update_comment' },
    },
    {
      id: 'updateCommentAttachmentIds',
      title: 'Attachment IDs',
      type: 'code',
      placeholder: '[]',
      condition: { field: 'operation', value: 'update_comment' },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the attachment ids',
        prompt:
          'List of file attachments included in the comment.Note: For more details on attachments, refer to the Uploads section. JSON array. Return ONLY the JSON array.',
      },
    },
    {
      id: 'updateCommentContentType',
      title: 'Content Type',
      type: 'dropdown',
      condition: { field: 'operation', value: 'update_comment' },
      mode: 'advanced',
      options: [
        { label: 'Not set', id: '' },
        { label: 'html', id: 'html' },
        { label: 'plainText', id: 'plainText' },
      ],
      value: () => '',
    },
    {
      id: 'deleteCommentCommentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Comment ID',
      condition: { field: 'operation', value: 'delete_comment' },
      required: true,
    },
    {
      id: 'deleteCommentTicketId',
      title: 'Ticket ID',
      type: 'short-input',
      placeholder: 'Ticket ID',
      condition: { field: 'operation', value: 'delete_comment' },
      required: true,
    },
    {
      id: 'listTicketsViewId',
      title: 'View Id',
      type: 'short-input',
      placeholder: 'Saved view ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tickets' },
    },
    {
      id: 'listTicketsTeamIds',
      title: 'Team Ids',
      type: 'short-input',
      placeholder: 'Comma-separated team IDs or Unassigned',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tickets' },
    },
    {
      id: 'listTicketsFields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'Comma-separated fields to return; at most 30 system or custom fields',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tickets' },
    },
    {
      id: 'updateTicketContactId',
      title: 'Contact Id',
      type: 'short-input',
      placeholder: 'Existing contact ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'updateTicketContact',
      title: 'Contact',
      type: 'code',
      placeholder: '{}',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        placeholder: 'Describe the requested values',
        prompt:
          'Contact JSON with email or lastName; use instead of contactId. Return ONLY the JSON object.',
      },
    },
    {
      id: 'updateTicketProductId',
      title: 'Product Id',
      type: 'short-input',
      placeholder: 'Product ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'updateTicketUploads',
      title: 'Uploads',
      type: 'code',
      placeholder: '[]',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the requested values',
        prompt: 'JSON array of previously uploaded attachment IDs. Return ONLY the JSON array.',
      },
    },
    {
      id: 'updateTicketEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Ticket email address',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'updateTicketPhone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Ticket phone number',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'updateTicketLanguage',
      title: 'Language',
      type: 'short-input',
      placeholder: 'Ticket language',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'updateTicketChannel',
      title: 'Channel',
      type: 'short-input',
      placeholder: 'Ticket origin channel',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'updateTicketWebUrl',
      title: 'Web Url',
      type: 'short-input',
      placeholder: 'URL to access the ticket',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'updateTicketSharedDepartments',
      title: 'Shared Departments',
      type: 'code',
      placeholder: '[]',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the requested values',
        prompt:
          'JSON array of shared departments and access privileges. Return ONLY the JSON array.',
      },
    },
    {
      id: 'updateTicketTeamId',
      title: 'Team Id',
      type: 'short-input',
      placeholder: 'Team ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
    },
    {
      id: 'updateTicketSecondaryContacts',
      title: 'Secondary Contacts',
      type: 'code',
      placeholder: '[]',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the requested values',
        prompt: 'JSON array of secondary contact IDs. Return ONLY the JSON array.',
      },
    },
    {
      id: 'updateTicketEntitySkills',
      title: 'Entity Skills',
      type: 'code',
      placeholder: '[]',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the requested values',
        prompt:
          'JSON array of skill IDs in priority order; at most 10. Return ONLY the JSON array.',
      },
    },
    {
      id: 'updateTicketDisableClosureNotification',
      title: 'Disable Closure Notification',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_ticket' },
      options: [
        { label: 'Provider default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'addCommentAttachmentIds',
      title: 'Attachment Ids',
      type: 'code',
      placeholder: '[]',
      mode: 'advanced',
      condition: { field: 'operation', value: 'add_comment' },
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        placeholder: 'Describe the requested values',
        prompt: 'JSON array of previously uploaded attachment IDs. Return ONLY the JSON array.',
      },
    },
    {
      id: 'listCommentsInclude',
      title: 'Include',
      type: 'short-input',
      placeholder: 'Related data to include: mentions and plainText, comma-separated',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_comments' },
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
            const value = params[config.field]
            if (value === undefined || value === null || (config.omitEmpty && value === '')) {
              result[name] = undefined
              continue
            }
            if (config.type === 'number') result[name] = value === '' ? undefined : Number(value)
            else if (config.type === 'boolean')
              result[name] = value === '' ? undefined : value === true || value === 'true'
            else result[name] = value
          }
          return result
        }
        // The agent-tool path does not carry `operation` inside params - it is a
        // sibling of the tool call, used only to pick the tool - and there the
        // model addresses tool params by their real names. The tool is already
        // selected, so there is no cross-operation leak to guard against, while
        // running the scoping below WOULD overwrite the model's own values with
        // `undefined`. Leave those params alone; only coerce the JSON field,
        // which is a type fix rather than an operation gate.
        if (typeof params.operation !== 'string') {
          return { ...params, customFields: parseCustomFields(params.customFields) }
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
                  ? params.listCommentsInclude
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
        result.viewId = params.operation === 'list_tickets' ? params.listTicketsViewId : undefined
        result.teamIds = params.operation === 'list_tickets' ? params.listTicketsTeamIds : undefined
        result.fields = params.operation === 'list_tickets' ? params.listTicketsFields : undefined
        result.contactId =
          params.operation === 'update_ticket' ? params.updateTicketContactId : params.contactId
        result.contact =
          params.operation === 'update_ticket' ? params.updateTicketContact : undefined
        result.productId =
          params.operation === 'update_ticket' ? params.updateTicketProductId : undefined
        result.uploads =
          params.operation === 'update_ticket' ? params.updateTicketUploads : undefined
        result.email = params.operation === 'update_ticket' ? params.updateTicketEmail : undefined
        result.phone = params.operation === 'update_ticket' ? params.updateTicketPhone : undefined
        result.language =
          params.operation === 'update_ticket' ? params.updateTicketLanguage : undefined
        result.channel =
          params.operation === 'update_ticket' ? params.updateTicketChannel : result.channel
        result.webUrl = params.operation === 'update_ticket' ? params.updateTicketWebUrl : undefined
        result.sharedDepartments =
          params.operation === 'update_ticket' ? params.updateTicketSharedDepartments : undefined
        result.teamId = params.operation === 'update_ticket' ? params.updateTicketTeamId : undefined
        result.secondaryContacts =
          params.operation === 'update_ticket' ? params.updateTicketSecondaryContacts : undefined
        result.entitySkills =
          params.operation === 'update_ticket' ? params.updateTicketEntitySkills : undefined
        result.disableClosureNotification =
          params.operation === 'update_ticket'
            ? params.updateTicketDisableClosureNotification === '' ||
              params.updateTicketDisableClosureNotification == null
              ? undefined
              : params.updateTicketDisableClosureNotification === true ||
                params.updateTicketDisableClosureNotification === 'true'
            : undefined
        result.attachmentIds =
          params.operation === 'add_comment' ? params.addCommentAttachmentIds : undefined
        return result
      },
    },
  },
  inputs: {
    listCommentsInclude: {
      type: 'string',
      description: 'Related data to include: mentions and plainText, comma-separated',
    },
    addCommentAttachmentIds: {
      type: 'json',
      description: 'JSON array of previously uploaded attachment IDs',
    },
    updateTicketDisableClosureNotification: {
      type: 'boolean',
      description: 'Suppress the contact notification when closing the ticket',
    },
    updateTicketEntitySkills: {
      type: 'json',
      description: 'JSON array of skill IDs in priority order; at most 10',
    },
    updateTicketSecondaryContacts: {
      type: 'json',
      description: 'JSON array of secondary contact IDs',
    },
    updateTicketTeamId: { type: 'string', description: 'Team ID' },
    updateTicketSharedDepartments: {
      type: 'json',
      description: 'JSON array of shared departments and access privileges',
    },
    updateTicketWebUrl: { type: 'string', description: 'URL to access the ticket' },
    updateTicketChannel: { type: 'string', description: 'Ticket origin channel' },
    updateTicketLanguage: { type: 'string', description: 'Ticket language' },
    updateTicketPhone: { type: 'string', description: 'Ticket phone number' },
    updateTicketEmail: { type: 'string', description: 'Ticket email address' },
    updateTicketUploads: {
      type: 'json',
      description: 'JSON array of previously uploaded attachment IDs',
    },
    updateTicketProductId: { type: 'string', description: 'Product ID' },
    updateTicketContact: {
      type: 'json',
      description: 'Contact JSON with email or lastName; use instead of contactId',
    },
    updateTicketContactId: { type: 'string', description: 'Existing contact ID' },
    listTicketsFields: {
      type: 'string',
      description: 'Comma-separated fields to return; at most 30 system or custom fields',
    },
    listTicketsTeamIds: { type: 'string', description: 'Comma-separated team IDs or Unassigned' },
    listTicketsViewId: { type: 'string', description: 'Saved view ID' },
    operation: { type: 'string', description: 'Operation to perform' },
    createTicketProductId: {
      type: 'string',
      description: 'ID of the product to associate the ticket',
    },
    createTicketPhone: { type: 'string', description: 'Phone number of the ticket' },
    createTicketSubject: { type: 'string', description: 'Subject of the ticket' },
    createTicketDueDate: { type: 'string', description: 'Due date of the ticket' },
    createTicketChannel: {
      type: 'string',
      description: 'Channel through which the ticket is being created.',
    },
    createTicketLanguage: { type: 'string', description: 'Language preference of the ticket' },
    createTicketPriority: {
      type: 'string',
      description:
        'Priority of the ticket Allowed values: Medium, High, Low, or a custom priority.',
    },
    createTicketAssigneeId: { type: 'string', description: 'ID of the assignee' },
    createTicketEmail: { type: 'string', description: 'Email ID of the ticket' },
    createTicketSubCategory: { type: 'string', description: 'Subcategory of the ticket' },
    createTicketCustomFields: {
      type: 'json',
      description: 'Custom fields in the ticket JSON object.',
    },
    createTicketDescription: { type: 'string', description: 'Description of the ticket' },
    createTicketClassification: {
      type: 'string',
      description:
        'Classification type of the ticket Allowed values: Problem, Request, Question, or a custom classification.',
    },
    createTicketCategory: { type: 'string', description: 'Category of the ticket' },
    createTicketStatus: {
      type: 'string',
      description:
        'Status of the ticket. Note: This can be a system-defined or custom value that falls under one of the status types: OPEN, ON HOLD, or CLOSED.',
    },
    createTicketContactId: {
      type: 'string',
      description:
        'ID of the contact Note: The contactId is mandatory for creating a ticket. If the contact does not already exist, include the contact JSON object to create the contact during ticket creation.',
    },
    createTicketDepartmentId: {
      type: 'string',
      description: 'ID of the department to associate the ticket',
    },
    createTicketContact: {
      type: 'json',
      description:
        'New contact JSON: email or lastName is required; firstName is optional. Provide either this or contactId.',
    },
    createTicketUploads: {
      type: 'json',
      description:
        'File attachments in the ticket. For more information, refer to the Uploads section JSON array.',
    },
    createTicketResolution: { type: 'string', description: 'Resolution notes of the ticket' },
    createTicketWebUrl: { type: 'string', description: 'URL to access the resource' },
    createTicketSharedDepartments: {
      type: 'json',
      description:
        'List of departments to which the ticket could be shared, along with the access privileges for each department JSON array.',
    },
    createTicketTeamId: { type: 'string', description: 'ID of the team to assign the ticket' },
    createTicketSecondaryContacts: {
      type: 'json',
      description: 'List of Secondary contacts JSON array.',
    },
    createTicketEntitySkills: {
      type: 'json',
      description:
        'JSON array of up to 10 skill IDs, ordered from highest to lowest assignment priority.',
    },
    searchTicketsEmail: {
      type: 'string',
      description: `The corresponding email address associated with the ticket. example: 1. email=jack* 2.email=\${notempty} 3.email=\${empty}. Supports * wildcards. Supports empty/not-empty search operators. Comma-separated values.`,
    },
    searchTicketsPhone: {
      type: 'string',
      description:
        'The phone number provided in the ticket. Supports * wildcards. Supports empty/not-empty search operators. Comma-separated values.',
    },
    searchTicketsTicketNumber: {
      type: 'string',
      description: "The ticket's serial number. Exact match. Comma-separated values.",
    },
    searchTicketsAccountName: {
      type: 'string',
      description:
        'Name of the account associated with the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    searchTicketsSubject: {
      type: 'string',
      description: 'Subject of the ticket. Supports * wildcards.',
    },
    searchTicketsDepartmentId: {
      type: 'string',
      description:
        'ID of the department from which the entity must be fetched. If the ID is not passed, then searches in all permitted departments. Exact match.',
    },
    searchTicketsProductName: {
      type: 'string',
      description:
        'Name of the product associated with the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    searchTicketsQuery: {
      type: 'string',
      description: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
    },
    searchTicketsLimit: { type: 'number', description: 'Page size (1-100; default 10).' },
    searchTicketsFrom: {
      type: 'number',
      description: 'Pagination start index (0-999; search returns at most the first 1000 matches).',
    },
    searchTicketsDueDateRange: {
      type: 'string',
      description: 'Due date range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    searchTicketsId: {
      type: 'string',
      description: 'ID of the ticket. Exact match. Comma-separated values.',
    },
    searchTicketsProductId: {
      type: 'string',
      description:
        'ID of the product associated with the ticket. Exact match. Comma-separated values.',
    },
    searchTicketsContactId: {
      type: 'string',
      description: 'ID of the contact who raised the ticket. Exact match. Comma-separated values.',
    },
    searchTicketsCreatedTimeRange: {
      type: 'string',
      description: 'Created time range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    searchTicketsPriority: {
      type: 'string',
      description: 'Priority of the ticket. Exact match. Comma-separated values.',
    },
    searchTicketsAssigneeId: {
      type: 'string',
      description:
        'ID of the agent who is assigned to resolve the ticket. Exact match. Comma-separated values.',
    },
    searchTicketsAccountId: {
      type: 'string',
      description:
        'ID of the account associated with the ticket. Exact match. Comma-separated values.',
    },
    searchTicketsModifiedTimeRange: {
      type: 'string',
      description: 'Modified time range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    searchTicketsStatus: {
      type: 'string',
      description: `Status of the ticket inclusive of custom status. example: 1. status=open,in progress 2. status=\${open}. Exact match. Comma-separated values.`,
    },
    searchTicketsCustomField1: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchTicketsCustomField2: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchTicketsCustomField3: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchTicketsCustomField4: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchTicketsCustomField5: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchTicketsCustomField6: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchTicketsCustomField7: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchTicketsCustomField8: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchTicketsCustomField9: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchTicketsCustomField10: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchTicketsChannel: {
      type: 'string',
      description:
        'The channel through which the ticket was received. Exact match. Supports empty/not-empty search operators.',
    },
    searchTicketsCustomerResponseTimeRange: {
      type: 'string',
      description:
        'Customer response time range as two comma-separated ISO 8601 timestamps: start,end.',
    },
    searchTicketsDescription: {
      type: 'string',
      description: 'Description of the ticket. Supports * wildcards.',
    },
    searchTicketsSortBy: {
      type: 'string',
      description:
        'Sort field: relevance, modifiedTime, createdTime, customerResponseTime. Prefix with - for descending.',
    },
    searchTicketsTag: {
      type: 'string',
      description:
        'The tag associated with the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    searchTicketsContactName: {
      type: 'string',
      description: 'The name of the contact who raised the ticket. Supports * wildcards.',
    },
    searchTicketsCategory: {
      type: 'string',
      description:
        'The category of the ticket. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    moveTicketTicketId: { type: 'string', description: 'Ticket ID' },
    moveTicketDepartmentId: {
      type: 'string',
      description: 'ID of the department to move the ticket',
    },
    moveTicketForumId: {
      type: 'string',
      description:
        'ID of the community sub-category to move the forum ticket (forum topic converted into a ticket).',
    },
    sendReplyIsPrivate: {
      type: 'boolean',
      description:
        'Specifies whether the thread is Private or Public. Forwarded threads are always private.',
    },
    sendReplySendImmediately: {
      type: 'boolean',
      description: 'Specify whether the reply has to sent immediately',
    },
    sendReplyTicketId: { type: 'string', description: 'Ticket ID' },
    sendReplyContent: { type: 'string', description: 'Content of the thread' },
    sendReplyContentType: {
      type: 'string',
      description:
        'Formatting type of the content. Applicable only for the EMAIL channel. Values supported are html and plainText (default).',
    },
    sendReplyInReplyToThreadId: {
      type: 'string',
      description:
        'ID of the thread to which current thread is a reply, applicable only for EMAIL channel',
    },
    sendReplyDirection: {
      type: 'string',
      description: 'Key that returns whether the thread is incoming or outgoing',
    },
    sendReplyCc: {
      type: 'string',
      description: 'Email ID to be CC-ed. Applicable only for EMAIL channel',
    },
    sendReplyBcc: {
      type: 'string',
      description: 'Email ID to be BCC-ed., if any exist. Applicable only for EMAIL channel',
    },
    sendReplyHasAttach: {
      type: 'boolean',
      description: 'States whether the thread has attachments',
    },
    sendReplyTicketStatus: {
      type: 'string',
      description:
        'Status of the ticket. Includes the custom statuses configured in your help desk portal.',
    },
    sendReplyAttachmentIds: {
      type: 'json',
      description:
        'List of attachment IDs, applicable only for EMAIL channel. For information on how to retrieve attachment IDs, refer to the Uploads section. JSON array.',
    },
    sendReplyTo: {
      type: 'string',
      description: 'To email ID in the thread, applicable only for EMAIL channel',
    },
    sendReplyFromEmailAddress: {
      type: 'string',
      description: 'Sender email address configured in your Zoho Desk portal.',
    },
    sendReplyIsForward: {
      type: 'boolean',
      description:
        'Key that returns if the thread was sent as a forward. Applicable only for the EMAIL channel.',
    },
    listContactsFields: {
      type: 'string',
      description:
        'Key that returns the values of mentioned fields (both pre-defined and custom) in your portal. All field types except multi-text are supported. Standard, non-editable fields are supported too. These fields include: photoURL, webUrl. Maximum of 30 fields is supported as comma separated values. Comma-separated values.',
    },
    listContactsViewId: {
      type: 'string',
      description: 'ID of the view to apply while fetching the resources',
    },
    listContactsLimit: { type: 'number', description: 'Page size (1-100).' },
    listContactsFrom: {
      type: 'number',
      description: 'Pagination start index; use the provider index for this endpoint (default 1).',
    },
    listContactsInclude: {
      type: 'string',
      description:
        'Secondary information related to the contact.Value supported is accounts. Comma-separated values.',
    },
    listContactsSortBy: {
      type: 'string',
      description:
        'Sort field: firstName, lastName, phone, email, account, createdTime, modifiedTime. Prefix with - for descending.',
    },
    createContactLastName: { type: 'string', description: 'Last name of the contact' },
    createContactAccountId: {
      type: 'string',
      description: 'Account to which the contact is mapped',
    },
    createContactFirstName: { type: 'string', description: 'First name of the contact' },
    createContactSecondaryEmail: {
      type: 'string',
      description: 'Secondary email ID of the contact',
    },
    createContactPhone: { type: 'string', description: 'Phone number of the contact' },
    createContactMobile: { type: 'string', description: 'Mobile number of the contact' },
    createContactOwnerId: { type: 'string', description: 'ID of the user who creates the contact' },
    createContactType: { type: 'string', description: 'Contact type' },
    createContactEmail: { type: 'string', description: 'Email ID of the contact' },
    createContactZip: { type: 'string', description: 'Zip code' },
    createContactCountry: { type: 'string', description: "Contact's country of residence" },
    createContactTwitter: { type: 'string', description: 'Twitter ID of the contact' },
    createContactCustomFields: {
      type: 'json',
      description: 'User-defined fields related to the contact JSON object.',
    },
    createContactCity: { type: 'string', description: "Contact's city of residence" },
    createContactStreet: { type: 'string', description: "Contact's address" },
    createContactFacebook: { type: 'string', description: 'Facebook ID of the contact' },
    createContactDescription: { type: 'string', description: 'Contact description' },
    createContactState: { type: 'string', description: "Contact's state of residence" },
    createContactTitle: { type: 'string', description: 'Contact title' },
    createContactLanguage: {
      type: 'string',
      description: 'Language preference to set for the Contact',
    },
    updateContactContactId: { type: 'string', description: 'Contact ID' },
    updateContactLastName: { type: 'string', description: 'Last name of the contact' },
    updateContactAccountId: {
      type: 'string',
      description: 'Account to which the contact is mapped',
    },
    updateContactFirstName: { type: 'string', description: 'First name of the contact' },
    updateContactSecondaryEmail: {
      type: 'string',
      description: 'Secondary email ID of the contact',
    },
    updateContactPhone: { type: 'string', description: 'Phone number of the contact' },
    updateContactMobile: { type: 'string', description: 'Mobile number of the contact' },
    updateContactOwnerId: { type: 'string', description: 'ID of the user who creates the contact' },
    updateContactType: { type: 'string', description: 'Contact type' },
    updateContactEmail: { type: 'string', description: 'Email ID of the contact' },
    updateContactZip: { type: 'string', description: 'Zip code' },
    updateContactCountry: { type: 'string', description: "Contact's country of residence" },
    updateContactTwitter: { type: 'string', description: 'Twitter ID of the contact' },
    updateContactCustomFields: {
      type: 'json',
      description: 'User-defined fields related to the contact JSON object.',
    },
    updateContactCity: { type: 'string', description: "Contact's city of residence" },
    updateContactStreet: { type: 'string', description: "Contact's address" },
    updateContactFacebook: { type: 'string', description: 'Facebook ID of the contact' },
    updateContactDescription: { type: 'string', description: 'Contact description' },
    updateContactState: { type: 'string', description: "Contact's state of residence" },
    updateContactTitle: { type: 'string', description: 'Contact title' },
    updateContactLanguage: {
      type: 'string',
      description: 'Language preference to set for the Contact',
    },
    searchContactsEmail: {
      type: 'string',
      description:
        'Email ID of the contact. Supports * wildcards. Supports empty/not-empty search operators. Comma-separated values.',
    },
    searchContactsPhone: {
      type: 'string',
      description:
        'Phone number of the contact. Supports * wildcards. Supports empty/not-empty search operators. Comma-separated values.',
    },
    searchContactsMobile: {
      type: 'string',
      description:
        'Mobile number of the contact. Supports * wildcards. Supports empty/not-empty search operators. Comma-separated values.',
    },
    searchContactsAccountName: {
      type: 'string',
      description:
        'Name of the account associated with the Contact. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    searchContactsCreatedTimeRange: {
      type: 'string',
      description:
        'Key that filters contacts created in a particular period of time. Enter the from and to dates in the ISO date format of yyyy-MM-ddThh:mm:ss.SSSZ; For example, createdTimeRange=2017-11-05T00:00:00.000Z,2018-09-05T23:59:00.000Z',
    },
    searchContactsLimit: { type: 'number', description: 'Page size (1-100; default 10).' },
    searchContactsFrom: {
      type: 'number',
      description: 'Pagination start index (0-999; search returns at most the first 1000 matches).',
    },
    searchContactsModifiedTimeRange: {
      type: 'string',
      description:
        'Key that filters contacts modified in a particular period of time. Enter the from and to dates in the ISO date format of yyyy-MM-ddThh:mm:ss.SSSZ; For example, modifiedTimeRange=2017-11-05T00:00:00.000Z,2018-09-05T23:59:00.000Z',
    },
    searchContactsId: {
      type: 'string',
      description: 'ID of the contact. Exact match. Comma-separated values.',
    },
    searchContactsQuery: {
      type: 'string',
      description: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
    },
    searchContactsCustomField1: {
      type: 'string',
      description: `Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.`,
    },
    searchContactsCustomField2: {
      type: 'string',
      description: `Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.`,
    },
    searchContactsCustomField3: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchContactsCustomField4: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchContactsCustomField5: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchContactsCustomField6: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchContactsCustomField7: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchContactsCustomField8: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchContactsCustomField9: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchContactsCustomField10: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchContactsLastName: {
      type: 'string',
      description: 'Last name of the contact. Supports * wildcards.',
    },
    searchContactsFirstName: {
      type: 'string',
      description:
        'First name of the contact. Supports * wildcards. Supports empty/not-empty search operators.',
    },
    searchContactsFullName: {
      type: 'string',
      description: 'Full name of the contact. Supports * wildcards.',
    },
    searchContactsSortBy: {
      type: 'string',
      description:
        'Sort field: relevance, modifiedTime, createdTime, lastName, firstName. Prefix with - for descending.',
    },
    listAccountsViewId: {
      type: 'string',
      description: 'ID of the view to apply while fetching the resources',
    },
    listAccountsLimit: { type: 'number', description: 'Page size (1-100).' },
    listAccountsFrom: {
      type: 'number',
      description: 'Pagination start index; use the provider index for this endpoint (default 1).',
    },
    listAccountsSortBy: {
      type: 'string',
      description:
        'Sort field: website, email, phone, accountName, createdTime, modifiedTime. Prefix with - for descending.',
    },
    listAccountsFields: {
      type: 'string',
      description:
        'Key that returns the values of mentioned fields (both pre-defined and custom) in your portal. All field types except multi-text are supported. Standard, non-editable fields are supported too. These fields include: photoURL, webUrl. Maximum of 30 fields is supported as comma separated values. Comma-separated values.',
    },
    createAccountWebsite: { type: 'string', description: 'Website of the account' },
    createAccountAccountName: { type: 'string', description: 'Name of the account' },
    createAccountPhone: { type: 'string', description: 'Phone number of the account' },
    createAccountEmail: { type: 'string', description: 'Email ID of the account' },
    createAccountCountry: { type: 'string', description: 'Country in which the account is based' },
    createAccountCode: { type: 'string', description: 'Zip code' },
    createAccountCustomFields: {
      type: 'json',
      description: 'User-defined fields associated with the account JSON object.',
    },
    createAccountCity: { type: 'string', description: 'City in which the account is based' },
    createAccountStreet: { type: 'string', description: 'Address of the account' },
    createAccountAnnualrevenue: { type: 'number', description: 'Annual revenue of the account' },
    createAccountDescription: { type: 'string', description: 'A short description of the account' },
    createAccountIndustry: {
      type: 'string',
      description: 'Industry in which the account operates',
    },
    createAccountState: { type: 'string', description: 'State in which the account is based' },
    createAccountOwnerId: { type: 'string', description: 'ID of account owner' },
    createAccountFax: { type: 'string', description: 'Fax number of the account' },
    createAccountAssociatedSLAIds: {
      type: 'json',
      description:
        'IDs of the SLAs associated with the account. An account can have multiple SLAs, but only one SLA per department can be mapped to it. JSON array.',
    },
    updateAccountAccountId: { type: 'string', description: 'Unique ID of the account' },
    updateAccountWebsite: { type: 'string', description: 'Website of the account' },
    updateAccountAccountName: { type: 'string', description: 'Name of the account' },
    updateAccountPhone: { type: 'string', description: 'Phone number of the account' },
    updateAccountEmail: { type: 'string', description: 'Email ID of the account' },
    updateAccountCountry: { type: 'string', description: 'Country in which the account is based' },
    updateAccountCode: { type: 'string', description: 'Zip code' },
    updateAccountCustomFields: {
      type: 'json',
      description: 'User-defined fields associated with the account JSON object.',
    },
    updateAccountCity: { type: 'string', description: 'City in which the account is based' },
    updateAccountStreet: { type: 'string', description: 'Address of the account' },
    updateAccountAnnualrevenue: { type: 'number', description: 'Annual revenue of the account' },
    updateAccountDescription: { type: 'string', description: 'A short description of the account' },
    updateAccountIndustry: {
      type: 'string',
      description: 'Industry in which the account operates',
    },
    updateAccountState: { type: 'string', description: 'State in which the account is based' },
    updateAccountOwnerId: { type: 'string', description: 'ID of account owner' },
    updateAccountFax: { type: 'string', description: 'Fax number of the account' },
    updateAccountAssociatedSLAIds: {
      type: 'json',
      description:
        'IDs of the SLAs associated with the account. An account can have multiple SLAs, but only one SLA per department can be mapped to it. JSON array.',
    },
    searchAccountsAccountName: {
      type: 'string',
      description: 'Name of the account. Supports * wildcards.',
    },
    searchAccountsCreatedTimeRange: {
      type: 'string',
      description:
        'Key that filters accounts created in a particular period of time. Enter the from and to dates in the ISO date format of yyyy-MM-ddThh:mm:ss.SSSZ; For example, createdTimeRange=2017-11-05T00:00:00.000Z,2018-09-05T23:59:00.000Z',
    },
    searchAccountsLimit: { type: 'number', description: 'Page size (1-100; default 10).' },
    searchAccountsFrom: {
      type: 'number',
      description: 'Pagination start index (0-999; search returns at most the first 1000 matches).',
    },
    searchAccountsModifiedTimeRange: {
      type: 'string',
      description:
        'Key that filters accounts modified in a particular period of time. Enter the from and to dates in the ISO date format of yyyy-MM-ddThh:mm:ss.SSSZ; For example, modifiedTimeRange=2017-11-05T00:00:00.000Z,2018-09-05T23:59:00.000Z',
    },
    searchAccountsId: {
      type: 'string',
      description: 'ID of the account. Exact match. Comma-separated values.',
    },
    searchAccountsQuery: {
      type: 'string',
      description: 'Search text across all fields. Supports * wildcards; at least 3 characters.',
    },
    searchAccountsCustomField1: {
      type: 'string',
      description: `Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.`,
    },
    searchAccountsCustomField2: {
      type: 'string',
      description: `Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.`,
    },
    searchAccountsCustomField3: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchAccountsCustomField4: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchAccountsCustomField5: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchAccountsCustomField6: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchAccountsCustomField7: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchAccountsCustomField8: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchAccountsCustomField9: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchAccountsCustomField10: {
      type: 'string',
      description:
        'Custom-field filter in APIName:search value format. Supports * wildcards and empty/not-empty search operators.',
    },
    searchAccountsSortBy: {
      type: 'string',
      description:
        'Sort field: relevance, modifiedTime, createdTime, accountName. Prefix with - for descending.',
    },
    getAccountInclude: { type: 'string', description: 'Allowed values are : owner' },
    getAccountAccountId: { type: 'string', description: 'Unique ID of the account' },
    listDepartmentsChatStatus: {
      type: 'string',
      description: `Key that filters departments based on their chat status. Values allowed are AVAILABLE, DISABLED, NOT_CREATED, and \${UNAVAILABLE}. \${UNAVAILABLE} refers to departments which are not available for chat.`,
    },
    listDepartmentsSearchStr: {
      type: 'string',
      description:
        'String to search for departments by name, help center name, or description. The string must contain at least one character. Three search methods are supported: 1) string* - Searches for departments whose name, help center name, or description start with the string, 2) *string* - Searches for departments whose name, help center name, or description contain the string, 3) string - Searches for departments whose name, help center name, or description is an. Exact match. for the string',
    },
    listDepartmentsIsEnabled: {
      type: 'boolean',
      description: 'Key that filters departments based on their enabled status',
    },
    listDepartmentsLimit: { type: 'number', description: 'Page size (0-200; default 10).' },
    listDepartmentsFrom: { type: 'number', description: 'Pagination start index (0-based).' },
    getDepartmentDepartmentId: { type: 'string', description: 'Unique ID of the department' },
    listAgentsInclude: {
      type: 'string',
      description:
        'Secondary information related to agents, The allowed values are profile, role. You can include all two values by separating them with commas in the API request.',
    },
    listAgentsRoleIds: {
      type: 'string',
      description:
        'Comma-separated array of role IDs. Maximum number of IDs allowed is 50. Comma-separated values.',
    },
    listAgentsSearchStr: {
      type: 'string',
      description:
        'String to search for agents by first name, last name, or email ID. The string must contain at least one character. The supported search methods: 1) string* - Searches for agents whose first name, last name, or email ID start with the string, 2) *string* - Searches for agents whose first name, last name, or email ID contain the string, 3) string - Searches for agents whose first name, last name, or email ID is an. Exact match. for the string',
    },
    listAgentsCfSearchStr: {
      type: 'string',
      description:
        'String to search for agents by custom field. The string must contain at least one character',
    },
    listAgentsCfFieldName: {
      type: 'string',
      description:
        'API name of the custom field that must be used for searching and listing agents',
    },
    listAgentsFieldName: {
      type: 'string',
      description:
        'Name of the field that must be used for searching and listing agents. The allowed values are: firstName, lastName, name, and emailId',
    },
    listAgentsIsLightAgent: {
      type: 'boolean',
      description: 'Key that denotes if the agents must be light or non light.',
    },
    listAgentsSortOrder: {
      type: 'string',
      description:
        'To sort the available list of agents in either ascending or descending order. The allowed values are: asc or desc',
    },
    listAgentsLimit: { type: 'number', description: 'Page size (0-200; default 10).' },
    listAgentsRolePermissionType: {
      type: 'string',
      description: `Types of roles and permissions of the agents to list. The allowed values are AgentPublic, AgentPersonal,AgentTeamPersonal, Admin, Light, Custom, and \${NON_LIGHT}. \${NON_LIGHT} refers to agents who are not associated with the light agent profile.`,
    },
    listAgentsProfileIds: {
      type: 'string',
      description:
        'Comma-separated array of profile IDs. Maximum number of IDs allowed is 50. Comma-separated values.',
    },
    listAgentsFrom: { type: 'number', description: 'Pagination start index (0-based).' },
    listAgentsIsConfirmed: {
      type: 'boolean',
      description: 'Key that denotes if the agents must be confirmed or unconfirmed.',
    },
    listAgentsDepartmentIds: {
      type: 'string',
      description:
        'Comma-separated array of department IDs. Maximum number of IDs allowed is 50. Comma-separated values.',
    },
    listAgentsStatus: {
      type: 'string',
      description:
        'Key that filters agents based on their activation status: ACTIVE, DISABLED, DELETED or IMPORTED',
    },
    getAgentInclude: {
      type: 'string',
      description:
        'Secondary information related to the agent. Values allowed are profile, role, associatedDepartments, associatedChatDepartments and verifiedEmails. Separate multiple values with commas.',
    },
    getAgentAgentId: { type: 'string', description: 'Agent ID' },
    getCommentInclude: {
      type: 'string',
      description:
        'Related comment data to include: mentions, plainText, or both separated by commas.',
    },
    getCommentCommentId: { type: 'string', description: 'Comment ID' },
    getCommentTicketId: { type: 'string', description: 'Ticket ID' },
    updateCommentCommentId: { type: 'string', description: 'Comment ID' },
    updateCommentTicketId: { type: 'string', description: 'Ticket ID' },
    updateCommentContent: {
      type: 'string',
      description:
        'The comment content. To mention an agent: zsu[@user:{zuid}]zsu To mention a team: zsu[@team:{teamId}_{teamName}]zsu Note: This format can also be used to retrieve agent information.',
    },
    updateCommentAttachmentIds: {
      type: 'json',
      description:
        'List of file attachments included in the comment.Note: For more details on attachments, refer to the Uploads section. JSON array.',
    },
    updateCommentContentType: {
      type: 'string',
      description:
        'Specifies the type of the content whether html or plainText. The default value is html.',
    },
    deleteCommentCommentId: { type: 'string', description: 'Comment ID' },
    deleteCommentTicketId: { type: 'string', description: 'Ticket ID' },

    oauthCredential: { type: 'string', description: 'Zoho Desk credential' },
    orgId: { type: 'string', description: 'Zoho Desk organization ID' },
    ticketId: { type: 'string', description: 'Ticket ID' },
    threadId: { type: 'string', description: 'Thread ID' },
    contactId: { type: 'string', description: 'Contact ID' },
    content: { type: 'string', description: 'Comment content' },
    contentType: { type: 'string', description: 'Comment content type (plainText/html)' },
    isPublic: { type: 'boolean', description: 'Whether a comment is public' },
    subject: { type: 'string', description: 'Ticket subject' },
    status: { type: 'string', description: 'Ticket status to set' },
    statusFilter: { type: 'string', description: 'Status filter for listing tickets' },
    priorityFilter: { type: 'string', description: 'Priority filter for listing tickets' },
    assigneeFilter: { type: 'string', description: 'Assignee filter for listing tickets' },
    channelFilter: { type: 'string', description: 'Channel filter for listing tickets' },
    receivedInDays: {
      type: 'number',
      description: 'Only tickets with a customer response in the last N days',
    },
    priority: { type: 'string', description: 'Ticket priority' },
    assigneeId: { type: 'string', description: 'Assignee (agent) ID' },
    description: { type: 'string', description: 'Ticket description' },
    resolution: { type: 'string', description: 'Resolution notes' },
    classification: { type: 'string', description: 'Ticket classification' },
    departmentId: { type: 'string', description: 'Department ID to move a ticket to' },
    departmentIds: { type: 'string', description: 'Department IDs to filter by (comma-separated)' },
    category: { type: 'string', description: 'Ticket category' },
    subCategory: { type: 'string', description: 'Ticket sub-category' },
    dueDate: { type: 'string', description: 'Ticket due date' },
    customFields: { type: 'json', description: 'Custom field values' },
    href: { type: 'string', description: 'Attachment download href' },
    fileName: { type: 'string', description: 'Downloaded file name' },
    include: { type: 'string', description: 'Related data to include when listing tickets' },
    ticketInclude: { type: 'string', description: 'Related data to include on a single ticket' },
    contactInclude: { type: 'string', description: 'Related data to include on a contact' },
    threadInclude: { type: 'string', description: 'Related data to include on a thread' },
    sortBy: { type: 'string', description: 'Sort field for listing tickets' },
    commentSortBy: { type: 'string', description: 'Sort field for listing comments' },
    threadSortBy: { type: 'string', description: 'Sort field for listing threads' },
    from: { type: 'number', description: 'Pagination start index' },
    limit: { type: 'number', description: 'Maximum results' },
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
