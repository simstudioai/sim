import { ZohoDeskIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
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
  bgColor: '#FFFFFF',
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
    {
      id: 'classification',
      title: 'Classification',
      type: 'dropdown',
      options: [
        { label: 'Problem', id: 'Problem' },
        { label: 'Request', id: 'Request' },
        { label: 'Question', id: 'Question' },
        { label: 'Others', id: 'Others' },
      ],
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
      condition: { field: 'operation', value: ['list_tickets', 'get_ticket'] },
      mode: 'advanced',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'createdTime, customerResponseTime, or responseDueDate',
      condition: { field: 'operation', value: 'list_tickets' },
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
        if (departmentIds) result.departmentIds = departmentIds

        // contentType is the comment's content type; its default would otherwise
        // serialize for every operation (e.g. get_attachment, which has no such
        // param). Only forward it for add_comment so the UI can't imply an option
        // that has no effect elsewhere.
        if (params.operation === 'add_comment' && typeof contentType === 'string' && contentType) {
          result.contentType = contentType
        }

        // Zoho documents from >= 0 and limit >= 1 as integers; a negative or
        // fractional value reaches the API as an opaque provider error, so drop
        // anything outside those bounds here rather than round-tripping it.
        // `null` is checked explicitly: the serializer initializes untouched
        // subBlocks to null, and Number(null) is 0 — which would otherwise inject
        // from=0 on every operation instead of leaving the param unset.
        if (rawFrom !== undefined && rawFrom !== null && rawFrom !== '') {
          const from = Number(rawFrom)
          if (Number.isInteger(from) && from >= 0) result.from = from
        }
        if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
          const limit = Number(rawLimit)
          if (Number.isInteger(limit) && limit >= 1) result.limit = limit
        }
        // Gated for the same reason as contentType above: isPublic carries a
        // defaultValue, so forwarding it unconditionally would serialize a
        // comment-only field onto every other operation's params. Destructured
        // out of `rest` so the default never reaches non-comment operations.
        if (params.operation === 'add_comment' && isPublic !== undefined) {
          result.isPublic = isPublic === true || isPublic === 'true'
        }
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
        if (activeStatus !== undefined && activeStatus !== null && activeStatus !== '') {
          result.status = activeStatus
        }
        if (activePriority !== undefined && activePriority !== null && activePriority !== '') {
          result.priority = activePriority
        }

        if (params.operation === 'update_ticket' && rawCustomFields !== undefined) {
          if (typeof rawCustomFields === 'string') {
            if (rawCustomFields.trim()) {
              try {
                result.customFields = JSON.parse(rawCustomFields)
              } catch {
                throw new Error('Invalid JSON provided for custom fields')
              }
            }
          } else if (rawCustomFields !== null) {
            // Already an object when an agent supplies it directly.
            result.customFields = rawCustomFields
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
    status: { type: 'string', description: 'Ticket status to set' },
    statusFilter: { type: 'string', description: 'Status filter for listing tickets' },
    priorityFilter: { type: 'string', description: 'Priority filter for listing tickets' },
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
  skills: [
    {
      name: 'triage-new-ticket',
      description:
        'Read an incoming Zoho Desk ticket, classify it, and set priority, classification, category, and assignee.',
      content:
        '# Triage a Zoho Desk Ticket\n\nClassify a newly created ticket and route it to the right owner.\n\n## Steps\n1. If the organization ID is unknown, List Organizations and pick the portal to work in.\n2. Get Ticket for the ticket ID and read subject, descriptionText, channel, and status.\n3. Decide the urgency and the owning team from the content, and pick a classification of Problem, Request, Question, or Others.\n4. Update Ticket to set priority, classification, category and subCategory, and the assigneeId or departmentId that should own it.\n5. Add Comment as an internal note explaining the triage decision so the agent who picks it up has the reasoning.\n\n## Output\nReport the ticket ID and number, the classification and priority set, the assignee or department it was routed to, and anything ambiguous that needs a human decision.',
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
        '# Enrich a Ticket With Customer Context\n\nGive the assigned agent the customer background before they start working the ticket.\n\n## Steps\n1. Get Ticket with include set to contacts so the related contact record comes back with the ticket.\n2. Get Contact for the ticket contactId to read the full contact record, including accountId, job title, email, and phone.\n3. List Tickets filtered to the same department and scan for other tickets from the same contact or account to spot repeat issues.\n4. Add Comment as an internal note summarizing who the customer is, their account, and any related open or recent tickets.\n\n## Output\nThe ticket number, the contact and account identified, a list of related tickets by number, and the internal note that was posted. Say explicitly if no contact is linked to the ticket.',
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
        '# Ticket Knowledge Gap Report\n\nFind the questions customers keep asking that no article answers.\n\n## Steps\n1. List Tickets across the statuses and departments in scope, paging with from and limit to cover a meaningful window.\n2. Read subject, descriptionText, category, and subCategory on each and group tickets into recurring themes.\n3. Rank themes by ticket volume, and for the top ones Get Ticket and List Threads on a couple of examples to understand what the customer actually needed.\n4. For each theme, propose a knowledge base article with a working title and the questions it must answer.\n\n## Output\nA ranked table of themes with ticket counts and example ticket numbers, plus the proposed article titles and outlines. Note which themes are one-off incidents rather than genuine documentation gaps.',
    },
  ],
} as const satisfies BlockMeta
