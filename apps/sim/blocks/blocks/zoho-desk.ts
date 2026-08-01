import { ZohoDeskIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { fetchZohoDeskOrganizationOptions } from '@/blocks/blocks/zoho-desk-org-options'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { getTrigger } from '@/triggers'

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
]

export const ZohoDeskBlock: BlockConfig<ZohoDeskResponse> = {
  type: 'zoho_desk',
  name: 'Zoho Desk',
  description: 'Manage Zoho Desk tickets, comments, threads, and contacts',
  authMode: AuthMode.OAuth,
  triggerAllowed: true,
  longDescription:
    'Read and update Zoho Desk tickets, manage comments and threads, look up contacts, and download attachments. Can also trigger workflows from Zoho Desk webhook events.',
  docsLink: 'https://docs.sim.ai/integrations/zoho_desk',
  category: 'tools',
  integrationType: IntegrationType.Support,
  bgColor: '#E42527',
  icon: ZohoDeskIcon,
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
      type: 'combobox',
      placeholder: 'Select or enter an organization ID',
      dependsOn: ['credential'],
      commandSearchable: true,
      options: [],
      fetchOptions: fetchZohoDeskOrganizationOptions,
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
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      placeholder: 'e.g. Open, Closed',
      condition: { field: 'operation', value: ['update_ticket', 'list_tickets'] },
      mode: 'advanced',
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'e.g. High',
      condition: { field: 'operation', value: ['update_ticket', 'list_tickets'] },
      mode: 'advanced',
    },
    {
      id: 'assigneeId',
      title: 'Assignee ID',
      type: 'short-input',
      placeholder: 'Agent ID',
      condition: { field: 'operation', value: 'update_ticket' },
      mode: 'advanced',
    },
    {
      id: 'category',
      title: 'Category',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_ticket' },
      mode: 'advanced',
    },
    {
      id: 'subCategory',
      title: 'Sub-category',
      type: 'short-input',
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
        prompt: 'Generate a JSON object of Zoho Desk custom field API names to values.',
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
      id: 'departmentId',
      title: 'Department ID',
      type: 'short-input',
      placeholder: 'Filter by department',
      condition: { field: 'operation', value: 'list_tickets' },
      mode: 'advanced',
    },
    {
      id: 'include',
      title: 'Include',
      type: 'short-input',
      placeholder: 'e.g. contacts,assignee',
      condition: { field: 'operation', value: ['list_tickets', 'get_ticket'] },
      mode: 'advanced',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'e.g. createdTime or -modifiedTime',
      condition: { field: 'operation', value: 'list_tickets' },
      mode: 'advanced',
    },
    {
      id: 'from',
      title: 'From',
      type: 'short-input',
      placeholder: 'Pagination start index',
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
      placeholder: 'Max results (max 100)',
      condition: {
        field: 'operation',
        value: ['list_tickets', 'list_comments', 'list_threads'],
      },
      mode: 'advanced',
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
    ],
    config: {
      tool: (params) => `zoho_desk_${params.operation}`,
      params: (params) => {
        // Pull raw pagination out of the spread so invalid values never reach the
        // tool; only re-add them when Number() yields a finite value (a non-numeric
        // typo would otherwise become NaN and produce an invalid Zoho query param).
        const { oauthCredential, from: rawFrom, limit: rawLimit, contentType, ...rest } = params
        const result: Record<string, unknown> = { ...rest, oauthCredential }

        // contentType is the comment's content type; its default would otherwise
        // serialize for every operation (e.g. get_attachment, which has no such
        // param). Only forward it for add_comment so the UI can't imply an option
        // that has no effect elsewhere.
        if (params.operation === 'add_comment' && typeof contentType === 'string' && contentType) {
          result.contentType = contentType
        }

        if (rawFrom !== undefined && rawFrom !== '') {
          const from = Number(rawFrom)
          if (Number.isFinite(from)) result.from = from
        }
        if (rawLimit !== undefined && rawLimit !== '') {
          const limit = Number(rawLimit)
          if (Number.isFinite(limit)) result.limit = limit
        }
        if (rest.isPublic !== undefined) {
          result.isPublic = rest.isPublic === true || rest.isPublic === 'true'
        }
        if (typeof rest.customFields === 'string' && rest.customFields.trim()) {
          try {
            result.customFields = JSON.parse(rest.customFields)
          } catch {
            throw new Error('Invalid JSON provided for custom fields')
          }
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Zoho Desk credential' },
    orgId: { type: 'string', description: 'Zoho Desk organization ID' },
    ticketId: { type: 'string', description: 'Ticket ID' },
    threadId: { type: 'string', description: 'Thread ID' },
    contactId: { type: 'string', description: 'Contact ID' },
    content: { type: 'string', description: 'Comment content' },
    contentType: { type: 'string', description: 'Comment content type (plainText/html)' },
    isPublic: { type: 'boolean', description: 'Whether a comment is public' },
    subject: { type: 'string', description: 'Ticket subject' },
    status: { type: 'string', description: 'Ticket status' },
    priority: { type: 'string', description: 'Ticket priority' },
    assigneeId: { type: 'string', description: 'Assignee (agent) ID' },
    departmentId: { type: 'string', description: 'Department ID' },
    category: { type: 'string', description: 'Ticket category' },
    subCategory: { type: 'string', description: 'Ticket sub-category' },
    dueDate: { type: 'string', description: 'Ticket due date' },
    customFields: { type: 'json', description: 'Custom field values' },
    href: { type: 'string', description: 'Attachment download href' },
    fileName: { type: 'string', description: 'Downloaded file name' },
    include: { type: 'string', description: 'Related data to include' },
    sortBy: { type: 'string', description: 'Sort field' },
    from: { type: 'number', description: 'Pagination start index' },
    limit: { type: 'number', description: 'Maximum results' },
  },
  outputs: {
    tickets: { type: 'array', description: 'List of tickets' },
    ticket: { type: 'json', description: 'A single ticket' },
    comments: { type: 'array', description: 'List of comments' },
    comment: { type: 'json', description: 'A single comment' },
    threads: { type: 'array', description: 'List of threads' },
    thread: { type: 'json', description: 'A single thread' },
    contact: { type: 'json', description: 'A contact' },
    organizations: { type: 'array', description: 'Accessible organizations' },
    file: { type: 'file', description: 'Downloaded attachment file' },
    count: { type: 'number', description: 'Number of items returned' },
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
        'Build a scheduled workflow that pulls all Zoho Desk tickets updated in the last 24 hours, summarizes volume by status and priority, and emails a digest to the support lead.',
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
} as const satisfies BlockMeta
