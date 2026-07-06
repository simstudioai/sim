import { PagerDutyIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const PagerDutyBlock: BlockConfig = {
  type: 'pagerduty',
  name: 'PagerDuty',
  description: 'Manage incidents and on-call schedules with PagerDuty',
  triggerAllowed: true,
  longDescription:
    'Integrate PagerDuty into your workflow to list, get, create, update, snooze, and merge incidents, add notes and list alerts, look up services and escalation policies, check on-call schedules, list users, and send monitoring events through the Events API v2.',
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
        { label: 'Get Incident', id: 'get_incident' },
        { label: 'Create Incident', id: 'create_incident' },
        { label: 'Update Incident', id: 'update_incident' },
        { label: 'Snooze Incident', id: 'snooze_incident' },
        { label: 'Merge Incidents', id: 'merge_incidents' },
        { label: 'Add Note', id: 'add_note' },
        { label: 'List Incident Alerts', id: 'list_incident_alerts' },
        { label: 'List Services', id: 'list_services' },
        { label: 'Get Service', id: 'get_service' },
        { label: 'List On-Calls', id: 'list_oncalls' },
        { label: 'List Escalation Policies', id: 'list_escalation_policies' },
        { label: 'List Schedules', id: 'list_schedules' },
        { label: 'List Users', id: 'list_users' },
        { label: 'Send Event', id: 'send_event' },
      ],
      value: () => 'list_incidents',
    },

    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: { field: 'operation', value: 'send_event', not: true },
      placeholder: 'Enter your PagerDuty REST API Key',
      password: true,
      condition: { field: 'operation', value: 'send_event', not: true },
    },

    {
      id: 'routingKey',
      title: 'Integration Key',
      type: 'short-input',
      required: { field: 'operation', value: 'send_event' },
      placeholder: 'Events API v2 integration key for the target service',
      password: true,
      condition: { field: 'operation', value: 'send_event' },
    },

    {
      id: 'fromEmail',
      title: 'From Email',
      type: 'short-input',
      required: {
        field: 'operation',
        value: [
          'create_incident',
          'update_incident',
          'add_note',
          'snooze_incident',
          'merge_incidents',
        ],
      },
      placeholder: 'Valid PagerDuty user email (required for write operations)',
      condition: {
        field: 'operation',
        value: [
          'create_incident',
          'update_incident',
          'add_note',
          'snooze_incident',
          'merge_incidents',
        ],
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
      id: 'listUrgencies',
      title: 'Urgencies',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'High', id: 'high' },
        { label: 'Low', id: 'low' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_incidents' },
      mode: 'advanced',
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
    {
      id: 'listOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'list_incidents' },
      mode: 'advanced',
    },

    // --- Get Incident fields ---
    {
      id: 'getIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      required: { field: 'operation', value: 'get_incident' },
      placeholder: 'ID of the incident to fetch',
      condition: { field: 'operation', value: 'get_incident' },
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
    {
      id: 'incidentKey',
      title: 'De-duplication Key',
      type: 'short-input',
      placeholder: 'Idempotency key to avoid duplicate incidents (optional)',
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
        { label: 'Triggered (reopen)', id: 'triggered' },
        { label: 'Acknowledged', id: 'acknowledged' },
        { label: 'Resolved', id: 'resolved' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_incident' },
    },
    {
      id: 'updateResolution',
      title: 'Resolution Note',
      type: 'long-input',
      placeholder: 'Note describing the resolution (used when status is resolved)',
      condition: { field: 'operation', value: 'update_incident' },
      mode: 'advanced',
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
    // --- Snooze Incident fields ---
    {
      id: 'snoozeIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      required: { field: 'operation', value: 'snooze_incident' },
      placeholder: 'ID of the incident to snooze',
      condition: { field: 'operation', value: 'snooze_incident' },
    },
    {
      id: 'snoozeDuration',
      title: 'Duration (seconds)',
      type: 'short-input',
      required: { field: 'operation', value: 'snooze_incident' },
      placeholder: 'e.g., 3600 for 1 hour (max 604800)',
      condition: { field: 'operation', value: 'snooze_incident' },
    },

    // --- Merge Incidents fields ---
    {
      id: 'mergeTargetIncidentId',
      title: 'Target Incident ID',
      type: 'short-input',
      required: { field: 'operation', value: 'merge_incidents' },
      placeholder: 'Incident that will absorb the source incidents',
      condition: { field: 'operation', value: 'merge_incidents' },
    },
    {
      id: 'mergeSourceIncidentIds',
      title: 'Source Incident IDs',
      type: 'short-input',
      required: { field: 'operation', value: 'merge_incidents' },
      placeholder: 'Comma-separated IDs of incidents to merge in',
      condition: { field: 'operation', value: 'merge_incidents' },
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

    // --- List Incident Alerts fields ---
    {
      id: 'alertsIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      required: { field: 'operation', value: 'list_incident_alerts' },
      placeholder: 'ID of the incident whose alerts to list',
      condition: { field: 'operation', value: 'list_incident_alerts' },
    },
    {
      id: 'alertsStatuses',
      title: 'Statuses',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Triggered', id: 'triggered' },
        { label: 'Resolved', id: 'resolved' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_incident_alerts' },
      mode: 'advanced',
    },
    {
      id: 'alertsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'list_incident_alerts' },
      mode: 'advanced',
    },
    {
      id: 'alertsOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'list_incident_alerts' },
      mode: 'advanced',
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
    {
      id: 'serviceOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'list_services' },
      mode: 'advanced',
    },

    // --- Get Service fields ---
    {
      id: 'getServiceId',
      title: 'Service ID',
      type: 'short-input',
      required: { field: 'operation', value: 'get_service' },
      placeholder: 'ID of the service to fetch',
      condition: { field: 'operation', value: 'get_service' },
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
    {
      id: 'oncallOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'list_oncalls' },
      mode: 'advanced',
    },

    // --- List Escalation Policies fields ---
    {
      id: 'escalationPolicyQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter escalation policies by name',
      condition: { field: 'operation', value: 'list_escalation_policies' },
    },
    {
      id: 'escalationPolicyLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'list_escalation_policies' },
      mode: 'advanced',
    },
    {
      id: 'escalationPolicyOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'list_escalation_policies' },
      mode: 'advanced',
    },

    // --- List Schedules fields ---
    {
      id: 'scheduleQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter schedules by name',
      condition: { field: 'operation', value: 'list_schedules' },
    },
    {
      id: 'scheduleLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'list_schedules' },
      mode: 'advanced',
    },
    {
      id: 'scheduleOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'list_schedules' },
      mode: 'advanced',
    },

    // --- List Users fields ---
    {
      id: 'userQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter users by name or email',
      condition: { field: 'operation', value: 'list_users' },
    },
    {
      id: 'userLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'list_users' },
      mode: 'advanced',
    },
    {
      id: 'userOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'list_users' },
      mode: 'advanced',
    },

    // --- Send Event fields ---
    {
      id: 'eventAction',
      title: 'Event Action',
      type: 'dropdown',
      options: [
        { label: 'Trigger', id: 'trigger' },
        { label: 'Acknowledge', id: 'acknowledge' },
        { label: 'Resolve', id: 'resolve' },
      ],
      value: () => 'trigger',
      condition: { field: 'operation', value: 'send_event' },
    },
    {
      id: 'eventSummary',
      title: 'Summary',
      type: 'short-input',
      required: {
        field: 'operation',
        value: 'send_event',
        and: { field: 'eventAction', value: 'trigger' },
      },
      placeholder: 'Brief summary of the event',
      condition: {
        field: 'operation',
        value: 'send_event',
        and: { field: 'eventAction', value: 'trigger' },
      },
    },
    {
      id: 'eventSource',
      title: 'Source',
      type: 'short-input',
      required: {
        field: 'operation',
        value: 'send_event',
        and: { field: 'eventAction', value: 'trigger' },
      },
      placeholder: 'Affected system, e.g. a hostname',
      condition: {
        field: 'operation',
        value: 'send_event',
        and: { field: 'eventAction', value: 'trigger' },
      },
    },
    {
      id: 'eventSeverity',
      title: 'Severity',
      type: 'dropdown',
      options: [
        { label: 'Critical', id: 'critical' },
        { label: 'Warning', id: 'warning' },
        { label: 'Error', id: 'error' },
        { label: 'Info', id: 'info' },
      ],
      value: () => 'critical',
      condition: {
        field: 'operation',
        value: 'send_event',
        and: { field: 'eventAction', value: 'trigger' },
      },
    },
    {
      id: 'eventDedupKey',
      title: 'De-duplication Key',
      type: 'short-input',
      required: {
        field: 'operation',
        value: 'send_event',
        and: { field: 'eventAction', value: ['acknowledge', 'resolve'] },
      },
      placeholder: 'Key identifying the alert (required for acknowledge/resolve)',
      condition: { field: 'operation', value: 'send_event' },
    },
    {
      id: 'eventComponent',
      title: 'Component',
      type: 'short-input',
      placeholder: 'Component of the source responsible for the event',
      condition: {
        field: 'operation',
        value: 'send_event',
        and: { field: 'eventAction', value: 'trigger' },
      },
      mode: 'advanced',
    },
    {
      id: 'eventGroup',
      title: 'Group',
      type: 'short-input',
      placeholder: 'Logical grouping of components',
      condition: {
        field: 'operation',
        value: 'send_event',
        and: { field: 'eventAction', value: 'trigger' },
      },
      mode: 'advanced',
    },
    {
      id: 'eventClass',
      title: 'Class',
      type: 'short-input',
      placeholder: 'Class/type of the event',
      condition: {
        field: 'operation',
        value: 'send_event',
        and: { field: 'eventAction', value: 'trigger' },
      },
      mode: 'advanced',
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
      'pagerduty_get_incident',
      'pagerduty_create_incident',
      'pagerduty_update_incident',
      'pagerduty_snooze_incident',
      'pagerduty_merge_incidents',
      'pagerduty_add_note',
      'pagerduty_list_incident_alerts',
      'pagerduty_list_services',
      'pagerduty_get_service',
      'pagerduty_list_oncalls',
      'pagerduty_list_escalation_policies',
      'pagerduty_list_schedules',
      'pagerduty_list_users',
      'pagerduty_send_event',
    ],
    config: {
      tool: (params) => `pagerduty_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}

        switch (params.operation) {
          case 'list_incidents':
            if (params.statuses) result.statuses = params.statuses
            if (params.listUrgencies) result.urgencies = params.listUrgencies
            if (params.listServiceIds) result.serviceIds = params.listServiceIds
            if (params.listSince) result.since = params.listSince
            if (params.listUntil) result.until = params.listUntil
            if (params.listSortBy) result.sortBy = params.listSortBy
            if (params.listLimit) result.limit = params.listLimit
            if (params.listOffset) result.offset = params.listOffset
            break

          case 'get_incident':
            if (params.getIncidentId) result.incidentId = params.getIncidentId
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
            if (params.updateResolution) result.resolution = params.updateResolution
            break

          case 'snooze_incident':
            if (params.snoozeIncidentId) result.incidentId = params.snoozeIncidentId
            if (params.snoozeDuration) result.duration = params.snoozeDuration
            break

          case 'merge_incidents':
            if (params.mergeTargetIncidentId) result.targetIncidentId = params.mergeTargetIncidentId
            if (params.mergeSourceIncidentIds)
              result.sourceIncidentIds = params.mergeSourceIncidentIds
            break

          case 'add_note':
            if (params.noteIncidentId) result.incidentId = params.noteIncidentId
            if (params.noteContent) result.content = params.noteContent
            break

          case 'list_incident_alerts':
            if (params.alertsIncidentId) result.incidentId = params.alertsIncidentId
            if (params.alertsStatuses) result.statuses = params.alertsStatuses
            if (params.alertsLimit) result.limit = params.alertsLimit
            if (params.alertsOffset) result.offset = params.alertsOffset
            break

          case 'list_services':
            if (params.serviceQuery) result.query = params.serviceQuery
            if (params.serviceLimit) result.limit = params.serviceLimit
            if (params.serviceOffset) result.offset = params.serviceOffset
            break

          case 'get_service':
            if (params.getServiceId) result.serviceId = params.getServiceId
            break

          case 'list_oncalls':
            if (params.oncallEscalationPolicyIds)
              result.escalationPolicyIds = params.oncallEscalationPolicyIds
            if (params.oncallScheduleIds) result.scheduleIds = params.oncallScheduleIds
            if (params.oncallSince) result.since = params.oncallSince
            if (params.oncallUntil) result.until = params.oncallUntil
            if (params.oncallLimit) result.limit = params.oncallLimit
            if (params.oncallOffset) result.offset = params.oncallOffset
            break

          case 'list_escalation_policies':
            if (params.escalationPolicyQuery) result.query = params.escalationPolicyQuery
            if (params.escalationPolicyLimit) result.limit = params.escalationPolicyLimit
            if (params.escalationPolicyOffset) result.offset = params.escalationPolicyOffset
            break

          case 'list_schedules':
            if (params.scheduleQuery) result.query = params.scheduleQuery
            if (params.scheduleLimit) result.limit = params.scheduleLimit
            if (params.scheduleOffset) result.offset = params.scheduleOffset
            break

          case 'list_users':
            if (params.userQuery) result.query = params.userQuery
            if (params.userLimit) result.limit = params.userLimit
            if (params.userOffset) result.offset = params.userOffset
            break

          case 'send_event':
            if (params.eventAction) result.eventAction = params.eventAction
            if (params.eventSummary) result.summary = params.eventSummary
            if (params.eventSource) result.source = params.eventSource
            if (params.eventSeverity) result.severity = params.eventSeverity
            if (params.eventDedupKey) result.dedupKey = params.eventDedupKey
            if (params.eventComponent) result.component = params.eventComponent
            if (params.eventGroup) result.group = params.eventGroup
            if (params.eventClass) result.class = params.eventClass
            break
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'PagerDuty REST API Key' },
    routingKey: { type: 'string', description: 'Events API v2 integration key' },
    fromEmail: { type: 'string', description: 'Valid PagerDuty user email' },
    statuses: { type: 'string', description: 'Status filter for incidents' },
    listUrgencies: { type: 'string', description: 'Urgency filter for incidents' },
    listServiceIds: { type: 'string', description: 'Service IDs filter' },
    listSince: { type: 'string', description: 'Start date filter' },
    listUntil: { type: 'string', description: 'End date filter' },
    listSortBy: { type: 'string', description: 'Sort field' },
    listLimit: { type: 'string', description: 'Max results for incidents' },
    listOffset: { type: 'string', description: 'Pagination offset for incidents' },
    getIncidentId: { type: 'string', description: 'Incident ID to fetch' },
    title: { type: 'string', description: 'Incident title' },
    createServiceId: { type: 'string', description: 'Service ID for new incident' },
    createUrgency: { type: 'string', description: 'Urgency level' },
    body: { type: 'string', description: 'Incident description' },
    incidentKey: { type: 'string', description: 'De-duplication key for new incident' },
    updateIncidentId: { type: 'string', description: 'Incident ID to update' },
    updateStatus: { type: 'string', description: 'New status' },
    updateResolution: { type: 'string', description: 'Resolution note' },
    snoozeIncidentId: { type: 'string', description: 'Incident ID to snooze' },
    snoozeDuration: { type: 'string', description: 'Snooze duration in seconds' },
    mergeTargetIncidentId: { type: 'string', description: 'Target incident ID for merge' },
    mergeSourceIncidentIds: { type: 'string', description: 'Source incident IDs to merge in' },
    noteIncidentId: { type: 'string', description: 'Incident ID for note' },
    noteContent: { type: 'string', description: 'Note content' },
    alertsIncidentId: { type: 'string', description: 'Incident ID whose alerts to list' },
    alertsStatuses: { type: 'string', description: 'Status filter for alerts' },
    alertsLimit: { type: 'string', description: 'Max results for alerts' },
    alertsOffset: { type: 'string', description: 'Pagination offset for alerts' },
    escalationPolicyId: { type: 'string', description: 'Escalation policy ID' },
    assigneeId: { type: 'string', description: 'Assignee user ID' },
    updateTitle: { type: 'string', description: 'New incident title' },
    updateUrgency: { type: 'string', description: 'New urgency level' },
    updateEscalationLevel: { type: 'string', description: 'Escalation level number' },
    serviceQuery: { type: 'string', description: 'Service name filter' },
    serviceLimit: { type: 'string', description: 'Max results for services' },
    serviceOffset: { type: 'string', description: 'Pagination offset for services' },
    getServiceId: { type: 'string', description: 'Service ID to fetch' },
    oncallEscalationPolicyIds: { type: 'string', description: 'Escalation policy IDs filter' },
    oncallScheduleIds: { type: 'string', description: 'Schedule IDs filter' },
    oncallSince: { type: 'string', description: 'On-call start time filter' },
    oncallUntil: { type: 'string', description: 'On-call end time filter' },
    oncallLimit: { type: 'string', description: 'Max results for on-calls' },
    oncallOffset: { type: 'string', description: 'Pagination offset for on-calls' },
    escalationPolicyQuery: { type: 'string', description: 'Escalation policy name filter' },
    escalationPolicyLimit: { type: 'string', description: 'Max results for escalation policies' },
    escalationPolicyOffset: {
      type: 'string',
      description: 'Pagination offset for escalation policies',
    },
    scheduleQuery: { type: 'string', description: 'Schedule name filter' },
    scheduleLimit: { type: 'string', description: 'Max results for schedules' },
    scheduleOffset: { type: 'string', description: 'Pagination offset for schedules' },
    userQuery: { type: 'string', description: 'User name/email filter' },
    userLimit: { type: 'string', description: 'Max results for users' },
    userOffset: { type: 'string', description: 'Pagination offset for users' },
    eventAction: { type: 'string', description: 'Events API action (trigger/acknowledge/resolve)' },
    eventSummary: { type: 'string', description: 'Event summary' },
    eventSource: { type: 'string', description: 'Event source system' },
    eventSeverity: { type: 'string', description: 'Event severity' },
    eventDedupKey: { type: 'string', description: 'Event de-duplication key' },
    eventComponent: { type: 'string', description: 'Event component' },
    eventGroup: { type: 'string', description: 'Event group' },
    eventClass: { type: 'string', description: 'Event class' },
  },

  outputs: {
    incidents: {
      type: 'json',
      description:
        '[{id, incidentNumber, title, status, urgency, createdAt, updatedAt, serviceName, serviceId, assigneeName, assigneeId, escalationPolicyName, htmlUrl}] (list_incidents)',
    },
    total: {
      type: 'number',
      description: 'Total count of results, null unless requested (list operations)',
    },
    more: {
      type: 'boolean',
      description: 'Whether more results are available (list operations)',
    },
    offset: {
      type: 'number',
      description: 'Pagination offset for this page of results (list operations)',
    },
    id: {
      type: 'string',
      description: 'Created/updated/fetched resource ID',
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
      description: 'Incident/event status',
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
    resolvedAt: {
      type: 'string',
      description: 'Resolution timestamp (get_incident)',
    },
    incidentKey: {
      type: 'string',
      description: 'De-duplication key (get_incident)',
    },
    serviceName: {
      type: 'string',
      description: 'Service name',
    },
    serviceId: {
      type: 'string',
      description: 'Service ID',
    },
    assigneeName: {
      type: 'string',
      description: 'Assignee name (list_incidents, get_incident)',
    },
    assigneeId: {
      type: 'string',
      description: 'Assignee ID (list_incidents, get_incident)',
    },
    escalationPolicyName: {
      type: 'string',
      description: 'Escalation policy name',
    },
    escalationPolicyId: {
      type: 'string',
      description: 'Escalation policy ID (get_incident, get_service)',
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
      description:
        '[{id, name, description, status, escalationPolicyName, escalationPolicyId, createdAt, htmlUrl}] (list_services)',
    },
    name: {
      type: 'string',
      description: 'Resource name (get_service, escalation policies, schedules, users)',
    },
    description: {
      type: 'string',
      description: 'Resource description (get_service, escalation policies, schedules)',
    },
    autoResolveTimeout: {
      type: 'number',
      description: 'Seconds before an open incident auto-resolves (get_service)',
    },
    acknowledgementTimeout: {
      type: 'number',
      description: 'Seconds before an acknowledged incident reverts to triggered (get_service)',
    },
    lastIncidentTimestamp: {
      type: 'string',
      description: 'Timestamp of the most recent incident (get_service)',
    },
    oncalls: {
      type: 'json',
      description:
        '[{userName, userId, escalationLevel, escalationPolicyName, escalationPolicyId, scheduleName, scheduleId, start, end}] (list_oncalls)',
    },
    escalationPolicies: {
      type: 'json',
      description:
        '[{id, name, description, numLoops, onCallHandoffNotifications, htmlUrl}] (list_escalation_policies)',
    },
    schedules: {
      type: 'json',
      description: '[{id, name, description, timeZone, htmlUrl}] (list_schedules)',
    },
    users: {
      type: 'json',
      description: '[{id, name, email, role, jobTitle, timeZone, htmlUrl}] (list_users)',
    },
    alerts: {
      type: 'json',
      description:
        '[{id, summary, status, severity, createdAt, alertKey, serviceName, serviceId, htmlUrl}] (list_incident_alerts)',
    },
    message: {
      type: 'string',
      description: 'Result message (send_event)',
    },
    dedupKey: {
      type: 'string',
      description: 'De-duplication key returned by the Events API (send_event)',
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
    {
      name: 'send-monitoring-event',
      description:
        'Trigger, acknowledge, or resolve a PagerDuty alert from a monitoring source using the Events API v2 integration key, without a PagerDuty user account.',
      content:
        "# Send Monitoring Event\n\nPage PagerDuty directly from a monitoring check or script.\n\n## Steps\n1. Use Send Event with the target service's Integration Key and Event Action set to Trigger.\n2. Provide a Summary, Source (the affected host/system), and Severity describing the problem.\n3. Reuse the same De-duplication Key on later Acknowledge/Resolve events to update the same alert instead of opening a new one.\n\n## Output\nReport the resulting status and the de-duplication key so follow-up events can reference the same alert.",
    },
    {
      name: 'merge-duplicate-incidents',
      description:
        'Merge duplicate PagerDuty incidents from the same event into one target incident to reduce noise.',
      content:
        '# Merge Duplicate Incidents\n\nCollapse near-duplicate pages into a single incident.\n\n## Steps\n1. Use List Incidents to identify incidents that describe the same underlying problem (same service, overlapping time window, similar title).\n2. Pick the incident responders are already working as the Target Incident ID.\n3. Use Merge Incidents with the Target Incident ID and the comma-separated Source Incident IDs to merge in; the sources are resolved automatically.\n4. Provide a valid From Email since this is a write operation.\n\n## Output\nConfirm the target incident number and status, and how many source incidents were merged into it.',
    },
  ],
} as const satisfies BlockMeta
