import { PagerDutyIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'

export const PagerDutyBlock: BlockConfig = {
  type: 'pagerduty',
  name: 'PagerDuty',
  description: 'Manage incidents and on-call schedules with PagerDuty',
  longDescription:
    'Integrate PagerDuty into your workflow to list, create, and update incidents, add notes, list services, and check on-call schedules.',
  docsLink: 'https://docs.sim.ai/tools/pagerduty',
  category: 'tools',
  bgColor: '#06AC38',
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
}
