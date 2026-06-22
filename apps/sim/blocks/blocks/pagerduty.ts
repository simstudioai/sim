import { PagerDutyIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const PagerDutyBlock: BlockConfig = {
  type: 'pagerduty',
  name: 'PagerDuty',
  description: 'Manage incidents and on-call schedules with PagerDuty',
  triggerAllowed: true,
  longDescription:
    'Integrate PagerDuty into your workflow to list, create, and update incidents, add notes, list services, and check on-call schedules.',
  docsLink: 'https://docs.sim.ai/integrations/pagerduty',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#06AC38',
  iconColor: '#06AC38',
  icon: PagerDutyIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Incidents', id: 'list_incidents' },
        { label: 'Create Incident', id: 'create_incident' },
        { label: 'Update Incident', id: 'update_incident' },
        { label: 'Add Note', id: 'add_note' },
        { label: 'List Services', id: 'list_services' },
        { label: 'List On-Calls', id: 'list_oncalls' },
      ],
      value: () => 'list_incidents',
    },

    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your PagerDuty REST API Key',
      password: true,
    },

    {
      id: 'fromEmail',
      title: 'From Email',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['create_incident', 'update_incident', 'add_note'],
      },
      placeholder: 'Valid PagerDuty user email (required for write operations)',
      condition: {
        field: 'operation',
        value: ['create_incident', 'update_incident', 'add_note'],
      },
    },

    // --- List Incidents fields ---
    {
      id: 'statuses',
      title: 'Statuses',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Triggered', id: 'triggered' },
        { label: 'Acknowledged', id: 'acknowledged' },
        { label: 'Resolved', id: 'resolved' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_incidents' },
    },
    {
      id: 'listServiceIds',
      title: 'Service IDs',
      type: 'short-input',
      placeholder: 'Comma-separated service IDs to filter',
      condition: { field: 'operation', value: 'list_incidents' },
      mode: 'advanced',
    },
    {
      id: 'listSince',
      title: 'Since',
      type: 'short-input',
      placeholder: 'Start date (ISO 8601, e.g., 2024-01-01T00:00:00Z)',
      condition: { field: 'operation', value: 'list_incidents' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp. Return ONLY the timestamp string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'listUntil',
      title: 'Until',
      type: 'short-input',
      placeholder: 'End date (ISO 8601, e.g., 2024-12-31T23:59:59Z)',
      condition: { field: 'operation', value: 'list_incidents' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp. Return ONLY the timestamp string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'listSortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Created At (newest)', id: 'created_at:desc' },
        { label: 'Created At (oldest)', id: 'created_at:asc' },
      ],
      value: () => 'created_at:desc',
      condition: { field: 'operation', value: 'list_incidents' },
      mode: 'advanced',
    },
    {
      id: 'listLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'list_incidents' },
      mode: 'advanced',
    },

    // --- Create Incident fields ---
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      required: { field: 'operation', value: 'create_incident' },
      placeholder: 'Incident title/summary',
      condition: { field: 'operation', value: 'create_incident' },
    },
    {
      id: 'createServiceId',
      title: 'Service ID',
      type: 'short-input',
      required: { field: 'operation', value: 'create_incident' },
      placeholder: 'PagerDuty service ID',
      condition: { field: 'operation', value: 'create_incident' },
    },
    {
      id: 'createUrgency',
      title: 'Urgency',
      type: 'dropdown',
      options: [
        { label: 'High', id: 'high' },
        { label: 'Low', id: 'low' },
      ],
      value: () => 'high',
      condition: { field: 'operation', value: 'create_incident' },
    },
    {
      id: 'body',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Detailed description of the incident',
      condition: { field: 'operation', value: 'create_incident' },
    },
    {
      id: 'escalationPolicyId',
      title: 'Escalation Policy ID',
      type: 'short-input',
      placeholder: 'Escalation policy ID (optional)',
      condition: { field: 'operation', value: 'create_incident' },
      mode: 'advanced',
    },
    {
      id: 'assigneeId',
      title: 'Assignee User ID',
      type: 'short-input',
      placeholder: 'User ID to assign (optional)',
      condition: { field: 'operation', value: 'create_incident' },
      mode: 'advanced',
    },

    // --- Update Incident fields ---
    {
      id: 'updateIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      required: { field: 'operation', value: 'update_incident' },
      placeholder: 'ID of the incident to update',
      condition: { field: 'operation', value: 'update_incident' },
    },
    {
      id: 'updateStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'Acknowledged', id: 'acknowledged' },
        { label: 'Resolved', id: 'resolved' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_incident' },
    },
    {
      id: 'updateTitle',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'New incident title (optional)',
      condition: { field: 'operation', value: 'update_incident' },
      mode: 'advanced',
    },
    {
      id: 'updateUrgency',
      title: 'Urgency',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'High', id: 'high' },
        { label: 'Low', id: 'low' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_incident' },
      mode: 'advanced',
    },
    {
      id: 'updateEscalationLevel',
      title: 'Escalation Level',
      type: 'short-input',
      placeholder: 'Escalation level number (e.g., 2)',
      condition: { field: 'operation', value: 'update_incident' },
      mode: 'advanced',
    },
    // --- Add Note fields ---
    {
      id: 'noteIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      required: { field: 'operation', value: 'add_note' },
      placeholder: 'ID of the incident',
      condition: { field: 'operation', value: 'add_note' },
    },
    {
      id: 'noteContent',
      title: 'Note Content',
      type: 'long-input',
      required: { field: 'operation', value: 'add_note' },
      placeholder: 'Note text to add to the incident',
      condition: { field: 'operation', value: 'add_note' },
    },

    // --- List Services fields ---
    {
      id: 'serviceQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter services by name',
      condition: { field: 'operation', value: 'list_services' },
    },
    {
      id: 'serviceLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'list_services' },
      mode: 'advanced',
    },

    // --- List On-Calls fields ---
    {
      id: 'oncallEscalationPolicyIds',
      title: 'Escalation Policy IDs',
      type: 'short-input',
      placeholder: 'Comma-separated escalation policy IDs',
      condition: { field: 'operation', value: 'list_oncalls' },
    },
    {
      id: 'oncallScheduleIds',
      title: 'Schedule IDs',
      type: 'short-input',
      placeholder: 'Comma-separated schedule IDs',
      condition: { field: 'operation', value: 'list_oncalls' },
      mode: 'advanced',
    },
    {
      id: 'oncallLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'list_oncalls' },
      mode: 'advanced',
    },
    {
      id: 'oncallSince',
      title: 'Since',
      type: 'short-input',
      placeholder: 'Start time (ISO 8601)',
      condition: { field: 'operation', value: 'list_oncalls' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp. Return ONLY the timestamp string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'oncallUntil',
      title: 'Until',
      type: 'short-input',
      placeholder: 'End time (ISO 8601)',
      condition: { field: 'operation', value: 'list_oncalls' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp. Return ONLY the timestamp string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    ...getTrigger('pagerduty_incident_triggered').subBlocks,
    ...getTrigger('pagerduty_incident_acknowledged').subBlocks,
    ...getTrigger('pagerduty_incident_resolved').subBlocks,
    ...getTrigger('pagerduty_incident_escalated').subBlocks,
    ...getTrigger('pagerduty_incident_reassigned').subBlocks,
    ...getTrigger('pagerduty_webhook').subBlocks,
  ],

  tools: {
    access: [
      'pagerduty_list_incidents',
      'pagerduty_create_incident',
      'pagerduty_update_incident',
      'pagerduty_add_note',
      'pagerduty_list_services',
      'pagerduty_list_oncalls',
    ],
    config: {
      tool: (params) => `pagerduty_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}

        switch (params.operation) {
          case 'list_incidents':
            if (params.statuses) result.statuses = params.statuses
            if (params.listServiceIds) result.serviceIds = params.listServiceIds
            if (params.listSince) result.since = params.listSince
            if (params.listUntil) result.until = params.listUntil
            if (params.listSortBy) result.sortBy = params.listSortBy
            if (params.listLimit) result.limit = params.listLimit
            break

          case 'create_incident':
            if (params.createServiceId) result.serviceId = params.createServiceId
            if (params.createUrgency) result.urgency = params.createUrgency
            break

          case 'update_incident':
            if (params.updateIncidentId) result.incidentId = params.updateIncidentId
            if (params.updateStatus) result.status = params.updateStatus
            if (params.updateTitle) result.title = params.updateTitle
            if (params.updateUrgency) result.urgency = params.updateUrgency
            if (params.updateEscalationLevel) result.escalationLevel = params.updateEscalationLevel
            break

          case 'add_note':
            if (params.noteIncidentId) result.incidentId = params.noteIncidentId
            if (params.noteContent) result.content = params.noteContent
            break

          case 'list_services':
            if (params.serviceQuery) result.query = params.serviceQuery
            if (params.serviceLimit) result.limit = params.serviceLimit
            break

          case 'list_oncalls':
            if (params.oncallEscalationPolicyIds)
              result.escalationPolicyIds = params.oncallEscalationPolicyIds
            if (params.oncallScheduleIds) result.scheduleIds = params.oncallScheduleIds
            if (params.oncallSince) result.since = params.oncallSince
            if (params.oncallUntil) result.until = params.oncallUntil
            if (params.oncallLimit) result.limit = params.oncallLimit
            break
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'PagerDuty REST API Key' },
    fromEmail: { type: 'string', description: 'Valid PagerDuty user email' },
    statuses: { type: 'string', description: 'Status filter for incidents' },
    listServiceIds: { type: 'string', description: 'Service IDs filter' },
    listSince: { type: 'string', description: 'Start date filter' },
    listUntil: { type: 'string', description: 'End date filter' },
    title: { type: 'string', description: 'Incident title' },
    createServiceId: { type: 'string', description: 'Service ID for new incident' },
    createUrgency: { type: 'string', description: 'Urgency level' },
    body: { type: 'string', description: 'Incident description' },
    updateIncidentId: { type: 'string', description: 'Incident ID to update' },
    updateStatus: { type: 'string', description: 'New status' },
    noteIncidentId: { type: 'string', description: 'Incident ID for note' },
    noteContent: { type: 'string', description: 'Note content' },
    escalationPolicyId: { type: 'string', description: 'Escalation policy ID' },
    assigneeId: { type: 'string', description: 'Assignee user ID' },
    updateTitle: { type: 'string', description: 'New incident title' },
    updateUrgency: { type: 'string', description: 'New urgency level' },
    updateEscalationLevel: { type: 'string', description: 'Escalation level number' },
    listSortBy: { type: 'string', description: 'Sort field' },
    listLimit: { type: 'string', description: 'Max results for incidents' },
    serviceQuery: { type: 'string', description: 'Service name filter' },
    serviceLimit: { type: 'string', description: 'Max results for services' },
    oncallEscalationPolicyIds: { type: 'string', description: 'Escalation policy IDs filter' },
    oncallScheduleIds: { type: 'string', description: 'Schedule IDs filter' },
    oncallSince: { type: 'string', description: 'On-call start time filter' },
    oncallUntil: { type: 'string', description: 'On-call end time filter' },
    oncallLimit: { type: 'string', description: 'Max results for on-calls' },
  },

  outputs: {
    incidents: {
      type: 'json',
      description: 'Array of incidents (list_incidents)',
    },
    total: {
      type: 'number',
      description: 'Total count of results',
    },
    more: {
      type: 'boolean',
      description: 'Whether more results are available',
    },
    id: {
      type: 'string',
      description: 'Created/updated resource ID',
    },
    incidentNumber: {
      type: 'number',
      description: 'Incident number',
    },
    title: {
      type: 'string',
      description: 'Incident title',
    },
    status: {
      type: 'string',
      description: 'Incident status',
    },
    urgency: {
      type: 'string',
      description: 'Incident urgency',
    },
    createdAt: {
      type: 'string',
      description: 'Creation timestamp',
    },
    updatedAt: {
      type: 'string',
      description: 'Last updated timestamp',
    },
    serviceName: {
      type: 'string',
      description: 'Service name',
    },
    serviceId: {
      type: 'string',
      description: 'Service ID',
    },
    htmlUrl: {
      type: 'string',
      description: 'PagerDuty web URL',
    },
    content: {
      type: 'string',
      description: 'Note content (add_note)',
    },
    userName: {
      type: 'string',
      description: 'User name (add_note)',
    },
    services: {
      type: 'json',
      description: 'Array of services (list_services)',
    },
    oncalls: {
      type: 'json',
      description: 'Array of on-call entries (list_oncalls)',
    },
  },

  triggers: {
    enabled: true,
    available: [
      'pagerduty_incident_triggered',
      'pagerduty_incident_acknowledged',
      'pagerduty_incident_resolved',
      'pagerduty_incident_escalated',
      'pagerduty_incident_reassigned',
      'pagerduty_webhook',
    ],
  },
}

export const PagerDutyBlockMeta = {
  tags: ['incident-management', 'monitoring'],
  url: 'https://www.pagerduty.com',
  templates: [
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty incident war room',
      prompt:
        'Build a scheduled workflow that polls PagerDuty for new severity-1 incidents, opens a Slack war-room channel, invites responders, posts the incident summary, and updates the channel topic with status.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty on-call digest',
      prompt:
        'Create a scheduled daily workflow that summarizes the past 24 hours of PagerDuty incidents, MTTR, and on-call load by responder, and posts a Slack digest to the SRE channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty escalation auditor',
      prompt:
        'Build a scheduled weekly workflow that audits PagerDuty escalation policies, on-call schedules, and gaps in coverage, and writes a remediation backlog to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty postmortem starter',
      prompt:
        'Create a scheduled workflow that polls PagerDuty for newly resolved incidents and opens a postmortem doc for each with the timeline, responders, and Slack thread linked, ready for the team to fill in root cause.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty auto-triage enricher',
      prompt:
        'Build a scheduled workflow that polls PagerDuty for new incidents, pulls the affected service details, queries recent logs and the latest deploy, and posts an enriched triage summary with likely cause back as an incident note for the responder.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'incident-management', 'automation'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty customer-impact notifier',
      prompt:
        'Create a scheduled workflow that polls PagerDuty for incidents on customer-facing services, looks up affected accounts in Salesforce, and drafts a status-page update plus a Slack alert to the customer success team for high-impact outages.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'incident-management', 'communication'],
      alsoIntegrations: ['slack', 'salesforce'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty alert-to-ticket bridge',
      prompt:
        'Build a workflow that creates a PagerDuty incident from inbound monitoring alerts, opens a matching Linear issue with the same severity and links the two, and logs the pairing in a table so engineering can track alert-to-fix time.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'incident-management', 'ticketing'],
      alsoIntegrations: ['linear'],
    },
  ],
  skills: [
    {
      name: 'open-incident',
      description:
        'Create a PagerDuty incident on a service with a title, urgency, and description so responders get paged.',
      content:
        '# Open Incident\n\nCreate a new PagerDuty incident and page the on-call responder.\n\n## Steps\n1. Use the Create Incident operation with the target Service ID and a clear, specific Title summarizing the problem.\n2. Set Urgency (high or low) based on customer impact and add a Description with affected systems, symptoms, and any error signatures.\n3. Optionally set an Escalation Policy ID or Assignee User ID to route the page directly.\n4. Capture the returned incident ID, number, and web URL for follow-up.\n\n## Output\nReport the new incident number, urgency, assigned service, and the PagerDuty URL so the team can jump straight to the incident.',
    },
    {
      name: 'triage-active-incidents',
      description:
        'List triggered and acknowledged PagerDuty incidents and produce a prioritized triage summary.',
      content:
        '# Triage Active Incidents\n\nReview what is currently on fire and summarize it for the team.\n\n## Steps\n1. Use List Incidents filtered to Triggered then Acknowledged statuses, sorted by created at (newest first).\n2. Optionally scope to specific Service IDs or a Since window to focus on a team or recent activity.\n3. Group results by service and urgency, flagging high-urgency triggered incidents that are still unacknowledged.\n4. For each, note title, age, status, and the responsible service.\n\n## Output\nA prioritized list leading with unacknowledged high-urgency incidents, including incident number, service, age, and URL.',
    },
    {
      name: 'resolve-and-note-incident',
      description:
        'Update a PagerDuty incident status and add a resolution note documenting what was done.',
      content:
        '# Resolve and Note Incident\n\nClose out an incident with a clear audit trail.\n\n## Steps\n1. Use Update Incident with the Incident ID and set Status to acknowledged or resolved as appropriate.\n2. Use Add Note on the same Incident ID to record the root cause, the fix applied, and any follow-up actions.\n3. Provide a valid From Email (a real PagerDuty user) since these write operations require it.\n4. Confirm the new status from the response.\n\n## Output\nState the incident number, its new status, and a one-line summary of the note that was attached.',
    },
    {
      name: 'check-whos-on-call',
      description:
        'List current PagerDuty on-call assignments for given schedules or escalation policies.',
      content:
        '# Check Who Is On Call\n\nFind the right person to reach right now.\n\n## Steps\n1. Use List On-Calls, optionally scoped by Escalation Policy IDs or Schedule IDs.\n2. Set a Since and Until window to look at the current or an upcoming shift.\n3. Map each on-call entry to its escalation level so primary versus backup responders are clear.\n\n## Output\nA concise roster: who is on call at level 1 (primary) and level 2 (backup) per schedule, with the time window covered.',
    },
  ],
} as const satisfies BlockMeta
