import { RootlyIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { RootlyResponse } from '@/tools/rootly/types'
import { getTrigger } from '@/triggers'

export const RootlyBlock: BlockConfig<RootlyResponse> = {
  type: 'rootly',
  name: 'Rootly',
  description: 'Manage incidents, alerts, and on-call with Rootly',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Rootly incident management into workflows. Create and manage incidents, alerts, services, severities, and retrospectives.',
  docsLink: 'https://docs.sim.ai/integrations/rootly',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#6C72C8',
  iconColor: '#6C72C8',
  icon: RootlyIcon,
  triggers: {
    enabled: true,
    available: [
      'rootly_incident_created',
      'rootly_incident_updated',
      'rootly_incident_resolved',
      'rootly_alert_created',
    ],
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Incident', id: 'rootly_create_incident' },
        { label: 'Get Incident', id: 'rootly_get_incident' },
        { label: 'Update Incident', id: 'rootly_update_incident' },
        { label: 'List Incidents', id: 'rootly_list_incidents' },
        { label: 'Create Alert', id: 'rootly_create_alert' },
        { label: 'List Alerts', id: 'rootly_list_alerts' },
        { label: 'Add Incident Event', id: 'rootly_add_incident_event' },
        { label: 'List Services', id: 'rootly_list_services' },
        { label: 'List Severities', id: 'rootly_list_severities' },
        { label: 'List Teams', id: 'rootly_list_teams' },
        { label: 'List Environments', id: 'rootly_list_environments' },
        { label: 'List Incident Types', id: 'rootly_list_incident_types' },
        { label: 'List Functionalities', id: 'rootly_list_functionalities' },
        { label: 'List Retrospectives', id: 'rootly_list_retrospectives' },
        { label: 'Delete Incident', id: 'rootly_delete_incident' },
        { label: 'Get Alert', id: 'rootly_get_alert' },
        { label: 'Update Alert', id: 'rootly_update_alert' },
        { label: 'Acknowledge Alert', id: 'rootly_acknowledge_alert' },
        { label: 'Resolve Alert', id: 'rootly_resolve_alert' },
        { label: 'Create Action Item', id: 'rootly_create_action_item' },
        { label: 'List Action Items', id: 'rootly_list_action_items' },
        { label: 'List Users', id: 'rootly_list_users' },
        { label: 'List On-Calls', id: 'rootly_list_on_calls' },
        { label: 'List Schedules', id: 'rootly_list_schedules' },
        { label: 'List Escalation Policies', id: 'rootly_list_escalation_policies' },
        { label: 'List Causes', id: 'rootly_list_causes' },
        { label: 'List Playbooks', id: 'rootly_list_playbooks' },
        { label: 'Mitigate Incident', id: 'rootly_mitigate_incident' },
        { label: 'Resolve Incident', id: 'rootly_resolve_incident' },
        { label: 'Assign Incident Role', id: 'rootly_assign_incident_role' },
        { label: 'Unassign Incident Role', id: 'rootly_unassign_incident_role' },
        { label: 'Add Subscribers', id: 'rootly_add_subscribers' },
        { label: 'Remove Subscribers', id: 'rootly_remove_subscribers' },
        { label: 'Create Status Page Event', id: 'rootly_create_status_page_event' },
        { label: 'Update Action Item', id: 'rootly_update_action_item' },
        { label: 'Delete Action Item', id: 'rootly_delete_action_item' },
        { label: 'Snooze Alert', id: 'rootly_snooze_alert' },
        { label: 'Escalate Alert', id: 'rootly_escalate_alert' },
        { label: 'List Incident Events', id: 'rootly_list_incident_events' },
        { label: 'Run Workflow', id: 'rootly_run_workflow' },
        { label: 'List Incident Roles', id: 'rootly_list_incident_roles' },
      ],
      value: () => 'rootly_create_incident',
    },

    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Incident title',
      condition: { field: 'operation', value: 'rootly_create_incident' },
    },
    {
      id: 'createSummary',
      title: 'Summary',
      type: 'long-input',
      placeholder: 'Describe the incident',
      condition: { field: 'operation', value: 'rootly_create_incident' },
    },
    {
      id: 'createSeverityId',
      title: 'Severity ID',
      type: 'short-input',
      placeholder: 'Severity ID (use List Severities to find IDs)',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'createStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'In Triage', id: 'in_triage' },
        { label: 'Started', id: 'started' },
        { label: 'Detected', id: 'detected' },
        { label: 'Acknowledged', id: 'acknowledged' },
        { label: 'Mitigated', id: 'mitigated' },
        { label: 'Resolved', id: 'resolved' },
        { label: 'Closed', id: 'closed' },
        { label: 'Cancelled', id: 'cancelled' },
        { label: 'Scheduled', id: 'scheduled' },
        { label: 'In Progress', id: 'in_progress' },
        { label: 'Completed', id: 'completed' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'createKind',
      title: 'Kind',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Normal', id: 'normal' },
        { label: 'Test', id: 'test' },
        { label: 'Example', id: 'example' },
        { label: 'Backfilled', id: 'backfilled' },
        { label: 'Scheduled', id: 'scheduled' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'createServiceIds',
      title: 'Service IDs',
      type: 'short-input',
      placeholder: 'Comma-separated service IDs',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'createEnvironmentIds',
      title: 'Environment IDs',
      type: 'short-input',
      placeholder: 'Comma-separated environment IDs',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'createGroupIds',
      title: 'Team IDs',
      type: 'short-input',
      placeholder: 'Comma-separated team/group IDs',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'createIncidentTypeIds',
      title: 'Incident Type IDs',
      type: 'short-input',
      placeholder: 'Comma-separated incident type IDs',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'createFunctionalityIds',
      title: 'Functionality IDs',
      type: 'short-input',
      placeholder: 'Comma-separated functionality IDs',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'createLabels',
      title: 'Labels',
      type: 'short-input',
      placeholder: '{"platform":"osx","version":"1.29"}',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of key-value label pairs for a Rootly incident. Example: {"platform":"osx","version":"1.29","region":"us-east-1"}. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the labels (e.g., "platform osx, version 1.29")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'createPrivate',
      title: 'Private',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
    },

    {
      id: 'getIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident to retrieve',
      condition: { field: 'operation', value: 'rootly_get_incident' },
      required: { field: 'operation', value: 'rootly_get_incident' },
    },

    {
      id: 'updateIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident to update',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      required: { field: 'operation', value: 'rootly_update_incident' },
    },
    {
      id: 'updateTitle',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Updated incident title',
      condition: { field: 'operation', value: 'rootly_update_incident' },
    },
    {
      id: 'updateSummary',
      title: 'Summary',
      type: 'long-input',
      placeholder: 'Updated incident summary',
      condition: { field: 'operation', value: 'rootly_update_incident' },
    },
    {
      id: 'updateStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'In Triage', id: 'in_triage' },
        { label: 'Started', id: 'started' },
        { label: 'Detected', id: 'detected' },
        { label: 'Acknowledged', id: 'acknowledged' },
        { label: 'Mitigated', id: 'mitigated' },
        { label: 'Resolved', id: 'resolved' },
        { label: 'Closed', id: 'closed' },
        { label: 'Cancelled', id: 'cancelled' },
        { label: 'Scheduled', id: 'scheduled' },
        { label: 'In Progress', id: 'in_progress' },
        { label: 'Completed', id: 'completed' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_update_incident' },
    },
    {
      id: 'updateSeverityId',
      title: 'Severity ID',
      type: 'short-input',
      placeholder: 'Updated severity ID',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },
    {
      id: 'mitigationMessage',
      title: 'Mitigation Message',
      type: 'long-input',
      placeholder: 'How was the incident mitigated?',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },
    {
      id: 'resolutionMessage',
      title: 'Resolution Message',
      type: 'long-input',
      placeholder: 'How was the incident resolved?',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },
    {
      id: 'updateServiceIds',
      title: 'Service IDs',
      type: 'short-input',
      placeholder: 'Comma-separated service IDs',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },
    {
      id: 'updateEnvironmentIds',
      title: 'Environment IDs',
      type: 'short-input',
      placeholder: 'Comma-separated environment IDs',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },
    {
      id: 'updateGroupIds',
      title: 'Team IDs',
      type: 'short-input',
      placeholder: 'Comma-separated team/group IDs',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },
    {
      id: 'updateKind',
      title: 'Kind',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Normal', id: 'normal' },
        { label: 'Test', id: 'test' },
        { label: 'Example', id: 'example' },
        { label: 'Backfilled', id: 'backfilled' },
        { label: 'Scheduled', id: 'scheduled' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },
    {
      id: 'updatePrivate',
      title: 'Private',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },
    {
      id: 'updateIncidentTypeIds',
      title: 'Incident Type IDs',
      type: 'short-input',
      placeholder: 'Comma-separated incident type IDs',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },
    {
      id: 'updateFunctionalityIds',
      title: 'Functionality IDs',
      type: 'short-input',
      placeholder: 'Comma-separated functionality IDs',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },
    {
      id: 'updateLabels',
      title: 'Labels',
      type: 'short-input',
      placeholder: '{"platform":"osx","version":"1.29"}',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of key-value label pairs for a Rootly incident. Example: {"platform":"osx","version":"1.29","region":"us-east-1"}. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the labels (e.g., "platform osx, version 1.29")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'cancellationMessage',
      title: 'Cancellation Message',
      type: 'long-input',
      placeholder: 'Why was the incident cancelled?',
      condition: { field: 'operation', value: 'rootly_update_incident' },
      mode: 'advanced',
    },

    {
      id: 'listIncidentsStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'In Triage', id: 'in_triage' },
        { label: 'Started', id: 'started' },
        { label: 'Detected', id: 'detected' },
        { label: 'Acknowledged', id: 'acknowledged' },
        { label: 'Mitigated', id: 'mitigated' },
        { label: 'Resolved', id: 'resolved' },
        { label: 'Closed', id: 'closed' },
        { label: 'Cancelled', id: 'cancelled' },
        { label: 'Scheduled', id: 'scheduled' },
        { label: 'In Progress', id: 'in_progress' },
        { label: 'Completed', id: 'completed' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_list_incidents' },
    },
    {
      id: 'listIncidentsSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search incidents...',
      condition: { field: 'operation', value: 'rootly_list_incidents' },
    },
    {
      id: 'listIncidentsSeverity',
      title: 'Severity Filter',
      type: 'short-input',
      placeholder: 'Severity slug (e.g., sev0)',
      condition: { field: 'operation', value: 'rootly_list_incidents' },
      mode: 'advanced',
    },
    {
      id: 'listIncidentsServices',
      title: 'Services Filter',
      type: 'short-input',
      placeholder: 'Comma-separated service slugs',
      condition: { field: 'operation', value: 'rootly_list_incidents' },
      mode: 'advanced',
    },
    {
      id: 'listIncidentsSort',
      title: 'Sort',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Newest First', id: '-created_at' },
        { label: 'Oldest First', id: 'created_at' },
        { label: 'Recently Started', id: '-started_at' },
        { label: 'Recently Updated', id: '-updated_at' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_list_incidents' },
      mode: 'advanced',
    },
    {
      id: 'listIncidentsTeams',
      title: 'Teams Filter',
      type: 'short-input',
      placeholder: 'Comma-separated team slugs',
      condition: { field: 'operation', value: 'rootly_list_incidents' },
      mode: 'advanced',
    },
    {
      id: 'listIncidentsEnvironments',
      title: 'Environments Filter',
      type: 'short-input',
      placeholder: 'Comma-separated environment slugs',
      condition: { field: 'operation', value: 'rootly_list_incidents' },
      mode: 'advanced',
    },
    {
      id: 'listIncidentsPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_incidents' },
      mode: 'advanced',
    },
    {
      id: 'listIncidentsPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_incidents' },
      mode: 'advanced',
    },

    {
      id: 'alertSummary',
      title: 'Summary',
      type: 'short-input',
      placeholder: 'Alert summary',
      condition: { field: 'operation', value: 'rootly_create_alert' },
      required: { field: 'operation', value: 'rootly_create_alert' },
    },
    {
      id: 'alertDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Detailed alert description',
      condition: { field: 'operation', value: 'rootly_create_alert' },
    },
    {
      id: 'alertSource',
      title: 'Source',
      type: 'short-input',
      placeholder: 'Alert source (e.g., api, datadog)',
      condition: { field: 'operation', value: 'rootly_create_alert' },
    },
    {
      id: 'alertServiceIds',
      title: 'Service IDs',
      type: 'short-input',
      placeholder: 'Comma-separated service IDs',
      condition: { field: 'operation', value: 'rootly_create_alert' },
      mode: 'advanced',
    },
    {
      id: 'alertGroupIds',
      title: 'Team IDs',
      type: 'short-input',
      placeholder: 'Comma-separated team/group IDs',
      condition: { field: 'operation', value: 'rootly_create_alert' },
      mode: 'advanced',
    },
    {
      id: 'alertDeduplicationKey',
      title: 'Deduplication Key',
      type: 'short-input',
      placeholder: 'Key to deduplicate alerts',
      condition: { field: 'operation', value: 'rootly_create_alert' },
      mode: 'advanced',
    },
    {
      id: 'alertEnvironmentIds',
      title: 'Environment IDs',
      type: 'short-input',
      placeholder: 'Comma-separated environment IDs',
      condition: { field: 'operation', value: 'rootly_create_alert' },
      mode: 'advanced',
    },
    {
      id: 'alertStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Open', id: 'open' },
        { label: 'Triggered', id: 'triggered' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_create_alert' },
      mode: 'advanced',
    },
    {
      id: 'alertExternalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'External alert ID',
      condition: { field: 'operation', value: 'rootly_create_alert' },
      mode: 'advanced',
    },
    {
      id: 'alertExternalUrl',
      title: 'External URL',
      type: 'short-input',
      placeholder: 'Link to external source',
      condition: { field: 'operation', value: 'rootly_create_alert' },
      mode: 'advanced',
    },

    {
      id: 'listAlertsStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Open', id: 'open' },
        { label: 'Triggered', id: 'triggered' },
        { label: 'Acknowledged', id: 'acknowledged' },
        { label: 'Resolved', id: 'resolved' },
        { label: 'Deferred', id: 'deferred' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_list_alerts' },
    },
    {
      id: 'listAlertsSource',
      title: 'Source Filter',
      type: 'short-input',
      placeholder: 'Filter by source (e.g., datadog)',
      condition: { field: 'operation', value: 'rootly_list_alerts' },
      mode: 'advanced',
    },
    {
      id: 'listAlertsServices',
      title: 'Services Filter',
      type: 'short-input',
      placeholder: 'Comma-separated service slugs',
      condition: { field: 'operation', value: 'rootly_list_alerts' },
      mode: 'advanced',
    },
    {
      id: 'listAlertsEnvironments',
      title: 'Environments Filter',
      type: 'short-input',
      placeholder: 'Comma-separated environment slugs',
      condition: { field: 'operation', value: 'rootly_list_alerts' },
      mode: 'advanced',
    },
    {
      id: 'listAlertsGroups',
      title: 'Teams Filter',
      type: 'short-input',
      placeholder: 'Comma-separated team slugs',
      condition: { field: 'operation', value: 'rootly_list_alerts' },
      mode: 'advanced',
    },
    {
      id: 'listAlertsPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_alerts' },
      mode: 'advanced',
    },
    {
      id: 'listAlertsPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_alerts' },
      mode: 'advanced',
    },

    {
      id: 'eventIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident',
      condition: { field: 'operation', value: 'rootly_add_incident_event' },
      required: { field: 'operation', value: 'rootly_add_incident_event' },
    },
    {
      id: 'eventText',
      title: 'Event',
      type: 'long-input',
      placeholder: 'Describe the timeline event',
      condition: { field: 'operation', value: 'rootly_add_incident_event' },
      required: { field: 'operation', value: 'rootly_add_incident_event' },
    },
    {
      id: 'eventVisibility',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Internal', id: 'internal' },
        { label: 'External', id: 'external' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_add_incident_event' },
      mode: 'advanced',
    },

    {
      id: 'servicesSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search services...',
      condition: { field: 'operation', value: 'rootly_list_services' },
    },
    {
      id: 'servicesPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_services' },
      mode: 'advanced',
    },
    {
      id: 'servicesPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_services' },
      mode: 'advanced',
    },

    {
      id: 'severitiesSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search severities...',
      condition: { field: 'operation', value: 'rootly_list_severities' },
    },
    {
      id: 'severitiesPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_severities' },
      mode: 'advanced',
    },
    {
      id: 'severitiesPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_severities' },
      mode: 'advanced',
    },

    {
      id: 'teamsSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search teams...',
      condition: { field: 'operation', value: 'rootly_list_teams' },
    },
    {
      id: 'teamsPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_teams' },
      mode: 'advanced',
    },
    {
      id: 'teamsPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_teams' },
      mode: 'advanced',
    },

    {
      id: 'environmentsSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search environments...',
      condition: { field: 'operation', value: 'rootly_list_environments' },
    },
    {
      id: 'environmentsPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_environments' },
      mode: 'advanced',
    },
    {
      id: 'environmentsPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_environments' },
      mode: 'advanced',
    },

    {
      id: 'incidentTypesSearch',
      title: 'Name Filter',
      type: 'short-input',
      placeholder: 'Filter by name...',
      condition: { field: 'operation', value: 'rootly_list_incident_types' },
    },
    {
      id: 'incidentTypesPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_incident_types' },
      mode: 'advanced',
    },
    {
      id: 'incidentTypesPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_incident_types' },
      mode: 'advanced',
    },

    {
      id: 'functionalitiesSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search functionalities...',
      condition: { field: 'operation', value: 'rootly_list_functionalities' },
    },
    {
      id: 'functionalitiesPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_functionalities' },
      mode: 'advanced',
    },
    {
      id: 'functionalitiesPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_functionalities' },
      mode: 'advanced',
    },

    {
      id: 'retrospectivesStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Draft', id: 'draft' },
        { label: 'Published', id: 'published' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_list_retrospectives' },
    },
    {
      id: 'retrospectivesSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search retrospectives...',
      condition: { field: 'operation', value: 'rootly_list_retrospectives' },
    },
    {
      id: 'retrospectivesPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_retrospectives' },
      mode: 'advanced',
    },
    {
      id: 'retrospectivesPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_retrospectives' },
      mode: 'advanced',
    },

    {
      id: 'deleteIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident to delete',
      condition: { field: 'operation', value: 'rootly_delete_incident' },
      required: { field: 'operation', value: 'rootly_delete_incident' },
    },

    {
      id: 'getAlertId',
      title: 'Alert ID',
      type: 'short-input',
      placeholder: 'The ID of the alert to retrieve',
      condition: { field: 'operation', value: 'rootly_get_alert' },
      required: { field: 'operation', value: 'rootly_get_alert' },
    },

    {
      id: 'updateAlertId',
      title: 'Alert ID',
      type: 'short-input',
      placeholder: 'The ID of the alert to update',
      condition: { field: 'operation', value: 'rootly_update_alert' },
      required: { field: 'operation', value: 'rootly_update_alert' },
    },
    {
      id: 'updateAlertSummary',
      title: 'Summary',
      type: 'short-input',
      placeholder: 'Updated alert summary',
      condition: { field: 'operation', value: 'rootly_update_alert' },
    },
    {
      id: 'updateAlertDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Updated alert description',
      condition: { field: 'operation', value: 'rootly_update_alert' },
    },
    {
      id: 'updateAlertSource',
      title: 'Source',
      type: 'short-input',
      placeholder: 'Alert source (e.g., api, datadog)',
      condition: { field: 'operation', value: 'rootly_update_alert' },
      mode: 'advanced',
    },
    {
      id: 'updateAlertServiceIds',
      title: 'Service IDs',
      type: 'short-input',
      placeholder: 'Comma-separated service IDs',
      condition: { field: 'operation', value: 'rootly_update_alert' },
      mode: 'advanced',
    },
    {
      id: 'updateAlertGroupIds',
      title: 'Team IDs',
      type: 'short-input',
      placeholder: 'Comma-separated team/group IDs',
      condition: { field: 'operation', value: 'rootly_update_alert' },
      mode: 'advanced',
    },
    {
      id: 'updateAlertEnvironmentIds',
      title: 'Environment IDs',
      type: 'short-input',
      placeholder: 'Comma-separated environment IDs',
      condition: { field: 'operation', value: 'rootly_update_alert' },
      mode: 'advanced',
    },
    {
      id: 'updateAlertExternalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'External alert ID',
      condition: { field: 'operation', value: 'rootly_update_alert' },
      mode: 'advanced',
    },
    {
      id: 'updateAlertExternalUrl',
      title: 'External URL',
      type: 'short-input',
      placeholder: 'Link to external source',
      condition: { field: 'operation', value: 'rootly_update_alert' },
      mode: 'advanced',
    },
    {
      id: 'updateAlertDeduplicationKey',
      title: 'Deduplication Key',
      type: 'short-input',
      placeholder: 'Key to deduplicate alerts',
      condition: { field: 'operation', value: 'rootly_update_alert' },
      mode: 'advanced',
    },

    {
      id: 'ackAlertId',
      title: 'Alert ID',
      type: 'short-input',
      placeholder: 'The ID of the alert to acknowledge',
      condition: { field: 'operation', value: 'rootly_acknowledge_alert' },
      required: { field: 'operation', value: 'rootly_acknowledge_alert' },
    },

    {
      id: 'resolveAlertId',
      title: 'Alert ID',
      type: 'short-input',
      placeholder: 'The ID of the alert to resolve',
      condition: { field: 'operation', value: 'rootly_resolve_alert' },
      required: { field: 'operation', value: 'rootly_resolve_alert' },
    },
    {
      id: 'resolveResolutionMessage',
      title: 'Resolution Message',
      type: 'long-input',
      placeholder: 'How was the alert resolved?',
      condition: { field: 'operation', value: 'rootly_resolve_alert' },
    },
    {
      id: 'resolveRelatedIncidents',
      title: 'Resolve Related Incidents',
      type: 'dropdown',
      options: [
        { label: 'No', id: '' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_resolve_alert' },
      mode: 'advanced',
    },

    {
      id: 'actionItemIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident',
      condition: { field: 'operation', value: 'rootly_create_action_item' },
      required: { field: 'operation', value: 'rootly_create_action_item' },
    },
    {
      id: 'actionItemSummary',
      title: 'Summary',
      type: 'short-input',
      placeholder: 'Action item title',
      condition: { field: 'operation', value: 'rootly_create_action_item' },
      required: { field: 'operation', value: 'rootly_create_action_item' },
    },
    {
      id: 'actionItemDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Describe the action item',
      condition: { field: 'operation', value: 'rootly_create_action_item' },
    },
    {
      id: 'actionItemKind',
      title: 'Kind',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Task', id: 'task' },
        { label: 'Follow Up', id: 'follow_up' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_create_action_item' },
    },
    {
      id: 'actionItemPriority',
      title: 'Priority',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'High', id: 'high' },
        { label: 'Medium', id: 'medium' },
        { label: 'Low', id: 'low' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_create_action_item' },
    },
    {
      id: 'actionItemStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Open', id: 'open' },
        { label: 'In Progress', id: 'in_progress' },
        { label: 'Cancelled', id: 'cancelled' },
        { label: 'Done', id: 'done' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_create_action_item' },
      mode: 'advanced',
    },
    {
      id: 'actionItemAssignedToUserId',
      title: 'Assigned To User ID',
      type: 'short-input',
      placeholder: 'User ID to assign (use List Users to find IDs)',
      condition: { field: 'operation', value: 'rootly_create_action_item' },
      mode: 'advanced',
    },
    {
      id: 'actionItemDueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'rootly_create_action_item' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format for the requested due date. Return ONLY the date string - no explanations, no extra text.',
        placeholder: 'Describe the due date (e.g., "next Friday", "in 2 weeks")...',
        generationType: 'timestamp',
      },
    },

    {
      id: 'listActionItemsIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident',
      condition: { field: 'operation', value: 'rootly_list_action_items' },
      required: { field: 'operation', value: 'rootly_list_action_items' },
    },
    {
      id: 'listActionItemsPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_action_items' },
      mode: 'advanced',
    },
    {
      id: 'listActionItemsPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_action_items' },
      mode: 'advanced',
    },

    {
      id: 'usersSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search users...',
      condition: { field: 'operation', value: 'rootly_list_users' },
    },
    {
      id: 'usersEmail',
      title: 'Email Filter',
      type: 'short-input',
      placeholder: 'Filter by email address',
      condition: { field: 'operation', value: 'rootly_list_users' },
      mode: 'advanced',
    },
    {
      id: 'usersPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_users' },
      mode: 'advanced',
    },
    {
      id: 'usersPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_users' },
      mode: 'advanced',
    },

    {
      id: 'onCallsScheduleIds',
      title: 'Schedule IDs',
      type: 'short-input',
      placeholder: 'Comma-separated schedule IDs',
      condition: { field: 'operation', value: 'rootly_list_on_calls' },
    },
    {
      id: 'onCallsEscalationPolicyIds',
      title: 'Escalation Policy IDs',
      type: 'short-input',
      placeholder: 'Comma-separated escalation policy IDs',
      condition: { field: 'operation', value: 'rootly_list_on_calls' },
    },
    {
      id: 'onCallsUserIds',
      title: 'User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs',
      condition: { field: 'operation', value: 'rootly_list_on_calls' },
      mode: 'advanced',
    },
    {
      id: 'onCallsServiceIds',
      title: 'Service IDs',
      type: 'short-input',
      placeholder: 'Comma-separated service IDs',
      condition: { field: 'operation', value: 'rootly_list_on_calls' },
      mode: 'advanced',
    },

    {
      id: 'schedulesSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search schedules...',
      condition: { field: 'operation', value: 'rootly_list_schedules' },
    },
    {
      id: 'schedulesPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_schedules' },
      mode: 'advanced',
    },
    {
      id: 'schedulesPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_schedules' },
      mode: 'advanced',
    },

    {
      id: 'escalationPoliciesSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search escalation policies...',
      condition: { field: 'operation', value: 'rootly_list_escalation_policies' },
    },
    {
      id: 'escalationPoliciesPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_escalation_policies' },
      mode: 'advanced',
    },
    {
      id: 'escalationPoliciesPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_escalation_policies' },
      mode: 'advanced',
    },

    {
      id: 'causesSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search causes...',
      condition: { field: 'operation', value: 'rootly_list_causes' },
    },
    {
      id: 'causesPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_causes' },
      mode: 'advanced',
    },
    {
      id: 'causesPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_causes' },
      mode: 'advanced',
    },

    {
      id: 'playbooksPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_playbooks' },
      mode: 'advanced',
    },
    {
      id: 'playbooksPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_playbooks' },
      mode: 'advanced',
    },

    {
      id: 'mitigateIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident to mitigate',
      condition: { field: 'operation', value: 'rootly_mitigate_incident' },
      required: { field: 'operation', value: 'rootly_mitigate_incident' },
    },
    {
      id: 'mitigateMessage',
      title: 'Mitigation Message',
      type: 'long-input',
      placeholder: 'How was the incident mitigated?',
      condition: { field: 'operation', value: 'rootly_mitigate_incident' },
    },

    {
      id: 'resolveIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident to resolve',
      condition: { field: 'operation', value: 'rootly_resolve_incident' },
      required: { field: 'operation', value: 'rootly_resolve_incident' },
    },
    {
      id: 'resolveIncidentMessage',
      title: 'Resolution Message',
      type: 'long-input',
      placeholder: 'How was the incident resolved?',
      condition: { field: 'operation', value: 'rootly_resolve_incident' },
    },

    {
      id: 'assignRoleIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident',
      condition: { field: 'operation', value: 'rootly_assign_incident_role' },
      required: { field: 'operation', value: 'rootly_assign_incident_role' },
    },
    {
      id: 'assignRoleUserId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'User ID to assign (use List Users to find IDs)',
      condition: { field: 'operation', value: 'rootly_assign_incident_role' },
      required: { field: 'operation', value: 'rootly_assign_incident_role' },
    },
    {
      id: 'assignRoleId',
      title: 'Incident Role ID',
      type: 'short-input',
      placeholder: 'Role ID (use List Incident Roles to find IDs)',
      condition: { field: 'operation', value: 'rootly_assign_incident_role' },
      required: { field: 'operation', value: 'rootly_assign_incident_role' },
    },

    {
      id: 'unassignRoleIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident',
      condition: { field: 'operation', value: 'rootly_unassign_incident_role' },
      required: { field: 'operation', value: 'rootly_unassign_incident_role' },
    },
    {
      id: 'unassignRoleUserId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'User ID to unassign (use List Users to find IDs)',
      condition: { field: 'operation', value: 'rootly_unassign_incident_role' },
      required: { field: 'operation', value: 'rootly_unassign_incident_role' },
    },
    {
      id: 'unassignRoleId',
      title: 'Incident Role ID',
      type: 'short-input',
      placeholder: 'Role ID (use List Incident Roles to find IDs)',
      condition: { field: 'operation', value: 'rootly_unassign_incident_role' },
      required: { field: 'operation', value: 'rootly_unassign_incident_role' },
    },

    {
      id: 'addSubsIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident',
      condition: { field: 'operation', value: 'rootly_add_subscribers' },
      required: { field: 'operation', value: 'rootly_add_subscribers' },
    },
    {
      id: 'addSubsUserIds',
      title: 'User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs to subscribe',
      condition: { field: 'operation', value: 'rootly_add_subscribers' },
      required: { field: 'operation', value: 'rootly_add_subscribers' },
    },

    {
      id: 'removeSubsIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident',
      condition: { field: 'operation', value: 'rootly_remove_subscribers' },
      required: { field: 'operation', value: 'rootly_remove_subscribers' },
    },
    {
      id: 'removeSubsUserIds',
      title: 'User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs to unsubscribe',
      condition: { field: 'operation', value: 'rootly_remove_subscribers' },
      required: { field: 'operation', value: 'rootly_remove_subscribers' },
    },

    {
      id: 'statusEventIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident',
      condition: { field: 'operation', value: 'rootly_create_status_page_event' },
      required: { field: 'operation', value: 'rootly_create_status_page_event' },
    },
    {
      id: 'statusEventText',
      title: 'Update Message',
      type: 'long-input',
      placeholder: 'The status page update to publish',
      condition: { field: 'operation', value: 'rootly_create_status_page_event' },
      required: { field: 'operation', value: 'rootly_create_status_page_event' },
    },
    {
      id: 'statusEventStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Investigating', id: 'investigating' },
        { label: 'Identified', id: 'identified' },
        { label: 'Monitoring', id: 'monitoring' },
        { label: 'Resolved', id: 'resolved' },
        { label: 'Scheduled', id: 'scheduled' },
        { label: 'In Progress', id: 'in_progress' },
        { label: 'Completed', id: 'completed' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_create_status_page_event' },
    },
    {
      id: 'statusEventStatusPageId',
      title: 'Status Page ID',
      type: 'short-input',
      placeholder: 'Status page ID to post to',
      condition: { field: 'operation', value: 'rootly_create_status_page_event' },
      mode: 'advanced',
    },
    {
      id: 'statusEventNotify',
      title: 'Notify Subscribers',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_create_status_page_event' },
      mode: 'advanced',
    },
    {
      id: 'statusEventTweet',
      title: 'Post to Twitter/X',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_create_status_page_event' },
      mode: 'advanced',
    },

    {
      id: 'updateActionItemId',
      title: 'Action Item ID',
      type: 'short-input',
      placeholder: 'The ID of the action item to update',
      condition: { field: 'operation', value: 'rootly_update_action_item' },
      required: { field: 'operation', value: 'rootly_update_action_item' },
    },
    {
      id: 'updateActionItemSummary',
      title: 'Summary',
      type: 'short-input',
      placeholder: 'Updated action item title',
      condition: { field: 'operation', value: 'rootly_update_action_item' },
    },
    {
      id: 'updateActionItemDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Updated description',
      condition: { field: 'operation', value: 'rootly_update_action_item' },
    },
    {
      id: 'updateActionItemStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Open', id: 'open' },
        { label: 'In Progress', id: 'in_progress' },
        { label: 'Cancelled', id: 'cancelled' },
        { label: 'Done', id: 'done' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_update_action_item' },
    },
    {
      id: 'updateActionItemPriority',
      title: 'Priority',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'High', id: 'high' },
        { label: 'Medium', id: 'medium' },
        { label: 'Low', id: 'low' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_update_action_item' },
      mode: 'advanced',
    },
    {
      id: 'updateActionItemKind',
      title: 'Kind',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: '' },
        { label: 'Task', id: 'task' },
        { label: 'Follow Up', id: 'follow_up' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_update_action_item' },
      mode: 'advanced',
    },
    {
      id: 'updateActionItemAssignee',
      title: 'Assigned To User ID',
      type: 'short-input',
      placeholder: 'User ID to assign (use List Users to find IDs)',
      condition: { field: 'operation', value: 'rootly_update_action_item' },
      mode: 'advanced',
    },
    {
      id: 'updateActionItemDueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'rootly_update_action_item' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format for the requested due date. Return ONLY the date string - no explanations, no extra text.',
        placeholder: 'Describe the due date (e.g., "next Friday", "in 2 weeks")...',
        generationType: 'timestamp',
      },
    },

    {
      id: 'deleteActionItemId',
      title: 'Action Item ID',
      type: 'short-input',
      placeholder: 'The ID of the action item to delete',
      condition: { field: 'operation', value: 'rootly_delete_action_item' },
      required: { field: 'operation', value: 'rootly_delete_action_item' },
    },

    {
      id: 'snoozeAlertId',
      title: 'Alert ID',
      type: 'short-input',
      placeholder: 'The ID of the alert to snooze',
      condition: { field: 'operation', value: 'rootly_snooze_alert' },
      required: { field: 'operation', value: 'rootly_snooze_alert' },
    },
    {
      id: 'snoozeDelayMinutes',
      title: 'Snooze Minutes',
      type: 'short-input',
      placeholder: '30',
      condition: { field: 'operation', value: 'rootly_snooze_alert' },
      required: { field: 'operation', value: 'rootly_snooze_alert' },
    },

    {
      id: 'escalateAlertId',
      title: 'Alert ID',
      type: 'short-input',
      placeholder: 'The ID of the alert to escalate',
      condition: { field: 'operation', value: 'rootly_escalate_alert' },
      required: { field: 'operation', value: 'rootly_escalate_alert' },
    },
    {
      id: 'escalatePolicyId',
      title: 'Escalation Policy ID',
      type: 'short-input',
      placeholder: 'Policy ID (use List Escalation Policies to find IDs)',
      condition: { field: 'operation', value: 'rootly_escalate_alert' },
      mode: 'advanced',
    },
    {
      id: 'escalatePolicyLevel',
      title: 'Escalation Policy Level',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_escalate_alert' },
      mode: 'advanced',
    },

    {
      id: 'listEventsIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident',
      condition: { field: 'operation', value: 'rootly_list_incident_events' },
      required: { field: 'operation', value: 'rootly_list_incident_events' },
    },
    {
      id: 'listEventsPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_incident_events' },
      mode: 'advanced',
    },
    {
      id: 'listEventsPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_incident_events' },
      mode: 'advanced',
    },

    {
      id: 'runWorkflowId',
      title: 'Workflow ID',
      type: 'short-input',
      placeholder: 'The ID of the workflow to run',
      condition: { field: 'operation', value: 'rootly_run_workflow' },
      required: { field: 'operation', value: 'rootly_run_workflow' },
    },
    {
      id: 'runWorkflowIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'Incident to run the workflow against',
      condition: { field: 'operation', value: 'rootly_run_workflow' },
    },
    {
      id: 'runWorkflowAlertId',
      title: 'Alert ID',
      type: 'short-input',
      placeholder: 'Alert to run the workflow against',
      condition: { field: 'operation', value: 'rootly_run_workflow' },
      mode: 'advanced',
    },
    {
      id: 'runWorkflowImmediate',
      title: 'Run Immediately',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_run_workflow' },
      mode: 'advanced',
    },
    {
      id: 'runWorkflowCheckConditions',
      title: 'Check Conditions',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'rootly_run_workflow' },
      mode: 'advanced',
    },

    {
      id: 'incidentRolesSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search incident roles...',
      condition: { field: 'operation', value: 'rootly_list_incident_roles' },
    },
    {
      id: 'incidentRolesPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_incident_roles' },
      mode: 'advanced',
    },
    {
      id: 'incidentRolesPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'rootly_list_incident_roles' },
      mode: 'advanced',
    },

    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Rootly API key',
      password: true,
      required: true,
    },

    ...getTrigger('rootly_incident_created').subBlocks,
    ...getTrigger('rootly_incident_updated').subBlocks,
    ...getTrigger('rootly_incident_resolved').subBlocks,
    ...getTrigger('rootly_alert_created').subBlocks,
  ],
  tools: {
    access: [
      'rootly_create_incident',
      'rootly_get_incident',
      'rootly_update_incident',
      'rootly_list_incidents',
      'rootly_create_alert',
      'rootly_list_alerts',
      'rootly_add_incident_event',
      'rootly_list_services',
      'rootly_list_severities',
      'rootly_list_teams',
      'rootly_list_environments',
      'rootly_list_incident_types',
      'rootly_list_functionalities',
      'rootly_list_retrospectives',
      'rootly_delete_incident',
      'rootly_get_alert',
      'rootly_update_alert',
      'rootly_acknowledge_alert',
      'rootly_resolve_alert',
      'rootly_create_action_item',
      'rootly_list_action_items',
      'rootly_list_users',
      'rootly_list_on_calls',
      'rootly_list_schedules',
      'rootly_list_escalation_policies',
      'rootly_list_causes',
      'rootly_list_playbooks',
      'rootly_mitigate_incident',
      'rootly_resolve_incident',
      'rootly_assign_incident_role',
      'rootly_unassign_incident_role',
      'rootly_add_subscribers',
      'rootly_remove_subscribers',
      'rootly_create_status_page_event',
      'rootly_update_action_item',
      'rootly_delete_action_item',
      'rootly_snooze_alert',
      'rootly_escalate_alert',
      'rootly_list_incident_events',
      'rootly_run_workflow',
      'rootly_list_incident_roles',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const baseParams: Record<string, unknown> = {
          apiKey: params.apiKey,
        }

        switch (params.operation) {
          case 'rootly_create_incident':
            return {
              ...baseParams,
              title: params.title,
              summary: params.createSummary,
              severityId: params.createSeverityId,
              status: params.createStatus,
              kind: params.createKind,
              serviceIds: params.createServiceIds,
              environmentIds: params.createEnvironmentIds,
              groupIds: params.createGroupIds,
              incidentTypeIds: params.createIncidentTypeIds,
              functionalityIds: params.createFunctionalityIds,
              labels: params.createLabels,
              private: params.createPrivate ? params.createPrivate === 'true' : undefined,
            }

          case 'rootly_get_incident':
            return {
              ...baseParams,
              incidentId: params.getIncidentId,
            }

          case 'rootly_update_incident':
            return {
              ...baseParams,
              incidentId: params.updateIncidentId,
              title: params.updateTitle,
              summary: params.updateSummary,
              status: params.updateStatus,
              severityId: params.updateSeverityId,
              kind: params.updateKind,
              private: params.updatePrivate ? params.updatePrivate === 'true' : undefined,
              mitigationMessage: params.mitigationMessage,
              resolutionMessage: params.resolutionMessage,
              cancellationMessage: params.cancellationMessage,
              serviceIds: params.updateServiceIds,
              environmentIds: params.updateEnvironmentIds,
              groupIds: params.updateGroupIds,
              incidentTypeIds: params.updateIncidentTypeIds,
              functionalityIds: params.updateFunctionalityIds,
              labels: params.updateLabels,
            }

          case 'rootly_list_incidents':
            return {
              ...baseParams,
              status: params.listIncidentsStatus,
              search: params.listIncidentsSearch,
              severity: params.listIncidentsSeverity,
              services: params.listIncidentsServices,
              teams: params.listIncidentsTeams,
              environments: params.listIncidentsEnvironments,
              sort: params.listIncidentsSort,
              pageSize: params.listIncidentsPageSize
                ? Number(params.listIncidentsPageSize)
                : undefined,
              pageNumber: params.listIncidentsPageNumber
                ? Number(params.listIncidentsPageNumber)
                : undefined,
            }

          case 'rootly_create_alert':
            return {
              ...baseParams,
              summary: params.alertSummary,
              description: params.alertDescription,
              source: params.alertSource,
              status: params.alertStatus,
              serviceIds: params.alertServiceIds,
              groupIds: params.alertGroupIds,
              environmentIds: params.alertEnvironmentIds,
              externalId: params.alertExternalId,
              deduplicationKey: params.alertDeduplicationKey,
              externalUrl: params.alertExternalUrl,
            }

          case 'rootly_list_alerts':
            return {
              ...baseParams,
              status: params.listAlertsStatus,
              source: params.listAlertsSource,
              services: params.listAlertsServices,
              environments: params.listAlertsEnvironments,
              groups: params.listAlertsGroups,
              pageSize: params.listAlertsPageSize ? Number(params.listAlertsPageSize) : undefined,
              pageNumber: params.listAlertsPageNumber
                ? Number(params.listAlertsPageNumber)
                : undefined,
            }

          case 'rootly_add_incident_event':
            return {
              ...baseParams,
              incidentId: params.eventIncidentId,
              event: params.eventText,
              visibility: params.eventVisibility,
            }

          case 'rootly_list_services':
            return {
              ...baseParams,
              search: params.servicesSearch,
              pageSize: params.servicesPageSize ? Number(params.servicesPageSize) : undefined,
              pageNumber: params.servicesPageNumber ? Number(params.servicesPageNumber) : undefined,
            }

          case 'rootly_list_severities':
            return {
              ...baseParams,
              search: params.severitiesSearch,
              pageSize: params.severitiesPageSize ? Number(params.severitiesPageSize) : undefined,
              pageNumber: params.severitiesPageNumber
                ? Number(params.severitiesPageNumber)
                : undefined,
            }

          case 'rootly_list_teams':
            return {
              ...baseParams,
              search: params.teamsSearch,
              pageSize: params.teamsPageSize ? Number(params.teamsPageSize) : undefined,
              pageNumber: params.teamsPageNumber ? Number(params.teamsPageNumber) : undefined,
            }

          case 'rootly_list_environments':
            return {
              ...baseParams,
              search: params.environmentsSearch,
              pageSize: params.environmentsPageSize
                ? Number(params.environmentsPageSize)
                : undefined,
              pageNumber: params.environmentsPageNumber
                ? Number(params.environmentsPageNumber)
                : undefined,
            }

          case 'rootly_list_incident_types':
            return {
              ...baseParams,
              search: params.incidentTypesSearch,
              pageSize: params.incidentTypesPageSize
                ? Number(params.incidentTypesPageSize)
                : undefined,
              pageNumber: params.incidentTypesPageNumber
                ? Number(params.incidentTypesPageNumber)
                : undefined,
            }

          case 'rootly_list_functionalities':
            return {
              ...baseParams,
              search: params.functionalitiesSearch,
              pageSize: params.functionalitiesPageSize
                ? Number(params.functionalitiesPageSize)
                : undefined,
              pageNumber: params.functionalitiesPageNumber
                ? Number(params.functionalitiesPageNumber)
                : undefined,
            }

          case 'rootly_list_retrospectives':
            return {
              ...baseParams,
              status: params.retrospectivesStatus,
              search: params.retrospectivesSearch,
              pageSize: params.retrospectivesPageSize
                ? Number(params.retrospectivesPageSize)
                : undefined,
              pageNumber: params.retrospectivesPageNumber
                ? Number(params.retrospectivesPageNumber)
                : undefined,
            }

          case 'rootly_delete_incident':
            return {
              ...baseParams,
              incidentId: params.deleteIncidentId,
            }

          case 'rootly_get_alert':
            return {
              ...baseParams,
              alertId: params.getAlertId,
            }

          case 'rootly_update_alert':
            return {
              ...baseParams,
              alertId: params.updateAlertId,
              summary: params.updateAlertSummary,
              description: params.updateAlertDescription,
              source: params.updateAlertSource,
              serviceIds: params.updateAlertServiceIds,
              groupIds: params.updateAlertGroupIds,
              environmentIds: params.updateAlertEnvironmentIds,
              externalId: params.updateAlertExternalId,
              externalUrl: params.updateAlertExternalUrl,
              deduplicationKey: params.updateAlertDeduplicationKey,
            }

          case 'rootly_acknowledge_alert':
            return {
              ...baseParams,
              alertId: params.ackAlertId,
            }

          case 'rootly_resolve_alert':
            return {
              ...baseParams,
              alertId: params.resolveAlertId,
              resolutionMessage: params.resolveResolutionMessage,
              resolveRelatedIncidents: params.resolveRelatedIncidents
                ? params.resolveRelatedIncidents === 'true'
                : undefined,
            }

          case 'rootly_create_action_item':
            return {
              ...baseParams,
              incidentId: params.actionItemIncidentId,
              summary: params.actionItemSummary,
              description: params.actionItemDescription,
              kind: params.actionItemKind,
              priority: params.actionItemPriority,
              status: params.actionItemStatus,
              assignedToUserId: params.actionItemAssignedToUserId,
              dueDate: params.actionItemDueDate,
            }

          case 'rootly_list_action_items':
            return {
              ...baseParams,
              incidentId: params.listActionItemsIncidentId,
              pageSize: params.listActionItemsPageSize
                ? Number(params.listActionItemsPageSize)
                : undefined,
              pageNumber: params.listActionItemsPageNumber
                ? Number(params.listActionItemsPageNumber)
                : undefined,
            }

          case 'rootly_list_users':
            return {
              ...baseParams,
              search: params.usersSearch,
              email: params.usersEmail,
              pageSize: params.usersPageSize ? Number(params.usersPageSize) : undefined,
              pageNumber: params.usersPageNumber ? Number(params.usersPageNumber) : undefined,
            }

          case 'rootly_list_on_calls':
            return {
              ...baseParams,
              scheduleIds: params.onCallsScheduleIds,
              escalationPolicyIds: params.onCallsEscalationPolicyIds,
              userIds: params.onCallsUserIds,
              serviceIds: params.onCallsServiceIds,
            }

          case 'rootly_list_schedules':
            return {
              ...baseParams,
              search: params.schedulesSearch,
              pageSize: params.schedulesPageSize ? Number(params.schedulesPageSize) : undefined,
              pageNumber: params.schedulesPageNumber
                ? Number(params.schedulesPageNumber)
                : undefined,
            }

          case 'rootly_list_escalation_policies':
            return {
              ...baseParams,
              search: params.escalationPoliciesSearch,
              pageSize: params.escalationPoliciesPageSize
                ? Number(params.escalationPoliciesPageSize)
                : undefined,
              pageNumber: params.escalationPoliciesPageNumber
                ? Number(params.escalationPoliciesPageNumber)
                : undefined,
            }

          case 'rootly_list_causes':
            return {
              ...baseParams,
              search: params.causesSearch,
              pageSize: params.causesPageSize ? Number(params.causesPageSize) : undefined,
              pageNumber: params.causesPageNumber ? Number(params.causesPageNumber) : undefined,
            }

          case 'rootly_list_playbooks':
            return {
              ...baseParams,
              pageSize: params.playbooksPageSize ? Number(params.playbooksPageSize) : undefined,
              pageNumber: params.playbooksPageNumber
                ? Number(params.playbooksPageNumber)
                : undefined,
            }

          case 'rootly_mitigate_incident':
            return {
              ...baseParams,
              incidentId: params.mitigateIncidentId,
              mitigationMessage: params.mitigateMessage,
            }

          case 'rootly_resolve_incident':
            return {
              ...baseParams,
              incidentId: params.resolveIncidentId,
              resolutionMessage: params.resolveIncidentMessage,
            }

          case 'rootly_assign_incident_role':
            return {
              ...baseParams,
              incidentId: params.assignRoleIncidentId,
              userId: params.assignRoleUserId,
              incidentRoleId: params.assignRoleId,
            }

          case 'rootly_unassign_incident_role':
            return {
              ...baseParams,
              incidentId: params.unassignRoleIncidentId,
              userId: params.unassignRoleUserId,
              incidentRoleId: params.unassignRoleId,
            }

          case 'rootly_add_subscribers':
            return {
              ...baseParams,
              incidentId: params.addSubsIncidentId,
              userIds: params.addSubsUserIds,
            }

          case 'rootly_remove_subscribers':
            return {
              ...baseParams,
              incidentId: params.removeSubsIncidentId,
              userIds: params.removeSubsUserIds,
            }

          case 'rootly_create_status_page_event':
            return {
              ...baseParams,
              incidentId: params.statusEventIncidentId,
              event: params.statusEventText,
              status: params.statusEventStatus,
              statusPageId: params.statusEventStatusPageId,
              notifySubscribers: params.statusEventNotify
                ? params.statusEventNotify === 'true'
                : undefined,
              shouldTweet: params.statusEventTweet ? params.statusEventTweet === 'true' : undefined,
            }

          case 'rootly_update_action_item':
            return {
              ...baseParams,
              actionItemId: params.updateActionItemId,
              summary: params.updateActionItemSummary,
              description: params.updateActionItemDescription,
              status: params.updateActionItemStatus,
              priority: params.updateActionItemPriority,
              kind: params.updateActionItemKind,
              assignedToUserId: params.updateActionItemAssignee,
              dueDate: params.updateActionItemDueDate,
            }

          case 'rootly_delete_action_item':
            return {
              ...baseParams,
              actionItemId: params.deleteActionItemId,
            }

          case 'rootly_snooze_alert':
            return {
              ...baseParams,
              alertId: params.snoozeAlertId,
              delayMinutes: params.snoozeDelayMinutes
                ? Number(params.snoozeDelayMinutes)
                : undefined,
            }

          case 'rootly_escalate_alert':
            return {
              ...baseParams,
              alertId: params.escalateAlertId,
              escalationPolicyId: params.escalatePolicyId,
              escalationPolicyLevel: params.escalatePolicyLevel
                ? Number(params.escalatePolicyLevel)
                : undefined,
            }

          case 'rootly_list_incident_events':
            return {
              ...baseParams,
              incidentId: params.listEventsIncidentId,
              pageSize: params.listEventsPageSize ? Number(params.listEventsPageSize) : undefined,
              pageNumber: params.listEventsPageNumber
                ? Number(params.listEventsPageNumber)
                : undefined,
            }

          case 'rootly_run_workflow':
            return {
              ...baseParams,
              workflowId: params.runWorkflowId,
              incidentId: params.runWorkflowIncidentId,
              alertId: params.runWorkflowAlertId,
              immediate: params.runWorkflowImmediate
                ? params.runWorkflowImmediate === 'true'
                : undefined,
              checkConditions: params.runWorkflowCheckConditions
                ? params.runWorkflowCheckConditions === 'true'
                : undefined,
            }

          case 'rootly_list_incident_roles':
            return {
              ...baseParams,
              search: params.incidentRolesSearch,
              pageSize: params.incidentRolesPageSize
                ? Number(params.incidentRolesPageSize)
                : undefined,
              pageNumber: params.incidentRolesPageNumber
                ? Number(params.incidentRolesPageNumber)
                : undefined,
            }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Rootly API key' },
    title: { type: 'string', description: 'Incident title' },
    createSummary: { type: 'string', description: 'Incident summary' },
    createSeverityId: { type: 'string', description: 'Severity ID' },
    createStatus: { type: 'string', description: 'Incident status' },
    createKind: { type: 'string', description: 'Incident kind' },
    createServiceIds: { type: 'string', description: 'Service IDs' },
    createEnvironmentIds: { type: 'string', description: 'Environment IDs' },
    createGroupIds: { type: 'string', description: 'Team IDs' },
    createIncidentTypeIds: { type: 'string', description: 'Incident type IDs' },
    createFunctionalityIds: { type: 'string', description: 'Functionality IDs' },
    createLabels: { type: 'string', description: 'Labels as JSON' },
    createPrivate: { type: 'string', description: 'Whether incident is private' },
    getIncidentId: { type: 'string', description: 'Incident ID to retrieve' },
    updateIncidentId: { type: 'string', description: 'Incident ID to update' },
    updateTitle: { type: 'string', description: 'Updated title' },
    updateSummary: { type: 'string', description: 'Updated summary' },
    updateStatus: { type: 'string', description: 'Updated status' },
    updateSeverityId: { type: 'string', description: 'Updated severity ID' },
    mitigationMessage: { type: 'string', description: 'Mitigation message' },
    resolutionMessage: { type: 'string', description: 'Resolution message' },
    updateServiceIds: { type: 'string', description: 'Updated service IDs' },
    updateEnvironmentIds: { type: 'string', description: 'Updated environment IDs' },
    updateGroupIds: { type: 'string', description: 'Updated team IDs' },
    updateKind: { type: 'string', description: 'Updated kind' },
    updatePrivate: { type: 'string', description: 'Whether incident is private' },
    updateIncidentTypeIds: { type: 'string', description: 'Updated incident type IDs' },
    updateFunctionalityIds: { type: 'string', description: 'Updated functionality IDs' },
    updateLabels: { type: 'string', description: 'Updated labels as JSON' },
    cancellationMessage: { type: 'string', description: 'Cancellation message' },
    listIncidentsStatus: { type: 'string', description: 'Filter by status' },
    listIncidentsSearch: { type: 'string', description: 'Search incidents' },
    listIncidentsSeverity: { type: 'string', description: 'Filter by severity' },
    listIncidentsServices: { type: 'string', description: 'Filter by services' },
    listIncidentsTeams: { type: 'string', description: 'Filter by teams' },
    listIncidentsEnvironments: { type: 'string', description: 'Filter by environments' },
    listIncidentsSort: { type: 'string', description: 'Sort order' },
    listIncidentsPageSize: { type: 'string', description: 'Page size' },
    listIncidentsPageNumber: { type: 'string', description: 'Page number' },
    alertSummary: { type: 'string', description: 'Alert summary' },
    alertDescription: { type: 'string', description: 'Alert description' },
    alertSource: { type: 'string', description: 'Alert source' },
    alertServiceIds: { type: 'string', description: 'Alert service IDs' },
    alertGroupIds: { type: 'string', description: 'Alert team IDs' },
    alertEnvironmentIds: { type: 'string', description: 'Alert environment IDs' },
    alertStatus: { type: 'string', description: 'Alert status' },
    alertExternalId: { type: 'string', description: 'External alert ID' },
    alertDeduplicationKey: { type: 'string', description: 'Deduplication key' },
    alertExternalUrl: { type: 'string', description: 'External URL' },
    listAlertsStatus: { type: 'string', description: 'Filter alerts by status' },
    listAlertsSource: { type: 'string', description: 'Filter alerts by source' },
    listAlertsServices: { type: 'string', description: 'Filter alerts by services' },
    listAlertsEnvironments: { type: 'string', description: 'Filter alerts by environments' },
    listAlertsGroups: { type: 'string', description: 'Filter alerts by teams' },
    listAlertsPageSize: { type: 'string', description: 'Alerts page size' },
    listAlertsPageNumber: { type: 'string', description: 'Alerts page number' },
    eventIncidentId: { type: 'string', description: 'Incident ID for event' },
    eventText: { type: 'string', description: 'Event description' },
    eventVisibility: { type: 'string', description: 'Event visibility' },
    servicesSearch: { type: 'string', description: 'Search services' },
    servicesPageSize: { type: 'string', description: 'Services page size' },
    servicesPageNumber: { type: 'string', description: 'Services page number' },
    severitiesSearch: { type: 'string', description: 'Search severities' },
    severitiesPageSize: { type: 'string', description: 'Severities page size' },
    severitiesPageNumber: { type: 'string', description: 'Severities page number' },
    teamsSearch: { type: 'string', description: 'Search teams' },
    teamsPageSize: { type: 'string', description: 'Teams page size' },
    teamsPageNumber: { type: 'string', description: 'Teams page number' },
    environmentsSearch: { type: 'string', description: 'Search environments' },
    environmentsPageSize: { type: 'string', description: 'Environments page size' },
    environmentsPageNumber: { type: 'string', description: 'Environments page number' },
    incidentTypesSearch: { type: 'string', description: 'Search incident types' },
    incidentTypesPageSize: { type: 'string', description: 'Incident types page size' },
    incidentTypesPageNumber: { type: 'string', description: 'Incident types page number' },
    functionalitiesSearch: { type: 'string', description: 'Search functionalities' },
    functionalitiesPageSize: { type: 'string', description: 'Functionalities page size' },
    functionalitiesPageNumber: { type: 'string', description: 'Functionalities page number' },
    retrospectivesStatus: { type: 'string', description: 'Filter retrospectives by status' },
    retrospectivesSearch: { type: 'string', description: 'Search retrospectives' },
    retrospectivesPageSize: { type: 'string', description: 'Retrospectives page size' },
    retrospectivesPageNumber: { type: 'string', description: 'Retrospectives page number' },
    deleteIncidentId: { type: 'string', description: 'Incident ID to delete' },
    getAlertId: { type: 'string', description: 'Alert ID to retrieve' },
    updateAlertId: { type: 'string', description: 'Alert ID to update' },
    updateAlertSummary: { type: 'string', description: 'Updated alert summary' },
    updateAlertDescription: { type: 'string', description: 'Updated alert description' },
    updateAlertSource: { type: 'string', description: 'Updated alert source' },
    updateAlertServiceIds: { type: 'string', description: 'Updated alert service IDs' },
    updateAlertGroupIds: { type: 'string', description: 'Updated alert team IDs' },
    updateAlertEnvironmentIds: { type: 'string', description: 'Updated alert environment IDs' },
    updateAlertExternalId: { type: 'string', description: 'Updated external alert ID' },
    updateAlertExternalUrl: { type: 'string', description: 'Updated external URL' },
    updateAlertDeduplicationKey: { type: 'string', description: 'Updated deduplication key' },
    ackAlertId: { type: 'string', description: 'Alert ID to acknowledge' },
    resolveAlertId: { type: 'string', description: 'Alert ID to resolve' },
    resolveResolutionMessage: { type: 'string', description: 'Resolution message' },
    resolveRelatedIncidents: { type: 'string', description: 'Resolve related incidents' },
    actionItemIncidentId: { type: 'string', description: 'Incident ID for action item' },
    actionItemSummary: { type: 'string', description: 'Action item summary' },
    actionItemDescription: { type: 'string', description: 'Action item description' },
    actionItemKind: { type: 'string', description: 'Action item kind' },
    actionItemPriority: { type: 'string', description: 'Action item priority' },
    actionItemStatus: { type: 'string', description: 'Action item status' },
    actionItemAssignedToUserId: { type: 'string', description: 'Assigned user ID' },
    actionItemDueDate: { type: 'string', description: 'Action item due date' },
    listActionItemsIncidentId: { type: 'string', description: 'Incident ID for action items' },
    listActionItemsPageSize: { type: 'string', description: 'Action items page size' },
    listActionItemsPageNumber: { type: 'string', description: 'Action items page number' },
    usersSearch: { type: 'string', description: 'Search users' },
    usersEmail: { type: 'string', description: 'Filter users by email' },
    usersPageSize: { type: 'string', description: 'Users page size' },
    usersPageNumber: { type: 'string', description: 'Users page number' },
    onCallsScheduleIds: { type: 'string', description: 'Filter on-calls by schedule IDs' },
    onCallsEscalationPolicyIds: {
      type: 'string',
      description: 'Filter on-calls by escalation policy IDs',
    },
    onCallsUserIds: { type: 'string', description: 'Filter on-calls by user IDs' },
    onCallsServiceIds: { type: 'string', description: 'Filter on-calls by service IDs' },
    schedulesSearch: { type: 'string', description: 'Search schedules' },
    schedulesPageSize: { type: 'string', description: 'Schedules page size' },
    schedulesPageNumber: { type: 'string', description: 'Schedules page number' },
    escalationPoliciesSearch: { type: 'string', description: 'Search escalation policies' },
    escalationPoliciesPageSize: { type: 'string', description: 'Escalation policies page size' },
    escalationPoliciesPageNumber: {
      type: 'string',
      description: 'Escalation policies page number',
    },
    causesSearch: { type: 'string', description: 'Search causes' },
    causesPageSize: { type: 'string', description: 'Causes page size' },
    causesPageNumber: { type: 'string', description: 'Causes page number' },
    playbooksPageSize: { type: 'string', description: 'Playbooks page size' },
    playbooksPageNumber: { type: 'string', description: 'Playbooks page number' },
    mitigateIncidentId: { type: 'string', description: 'Incident ID to mitigate' },
    mitigateMessage: { type: 'string', description: 'Mitigation message' },
    resolveIncidentId: { type: 'string', description: 'Incident ID to resolve' },
    resolveIncidentMessage: { type: 'string', description: 'Resolution message' },
    assignRoleIncidentId: { type: 'string', description: 'Incident ID for role assignment' },
    assignRoleUserId: { type: 'string', description: 'User ID to assign' },
    assignRoleId: { type: 'string', description: 'Incident role ID to assign' },
    unassignRoleIncidentId: { type: 'string', description: 'Incident ID for role removal' },
    unassignRoleUserId: { type: 'string', description: 'User ID to unassign' },
    unassignRoleId: { type: 'string', description: 'Incident role ID to remove' },
    addSubsIncidentId: { type: 'string', description: 'Incident ID for subscribers' },
    addSubsUserIds: { type: 'string', description: 'User IDs to subscribe' },
    removeSubsIncidentId: { type: 'string', description: 'Incident ID for unsubscribe' },
    removeSubsUserIds: { type: 'string', description: 'User IDs to unsubscribe' },
    statusEventIncidentId: { type: 'string', description: 'Incident ID for status page event' },
    statusEventText: { type: 'string', description: 'Status page update message' },
    statusEventStatus: { type: 'string', description: 'Status page event status' },
    statusEventStatusPageId: { type: 'string', description: 'Status page ID' },
    statusEventNotify: { type: 'string', description: 'Notify subscribers' },
    statusEventTweet: { type: 'string', description: 'Post to Twitter/X' },
    updateActionItemId: { type: 'string', description: 'Action item ID to update' },
    updateActionItemSummary: { type: 'string', description: 'Updated action item title' },
    updateActionItemDescription: { type: 'string', description: 'Updated action item description' },
    updateActionItemStatus: { type: 'string', description: 'Updated action item status' },
    updateActionItemPriority: { type: 'string', description: 'Updated action item priority' },
    updateActionItemKind: { type: 'string', description: 'Updated action item kind' },
    updateActionItemAssignee: { type: 'string', description: 'Assigned user ID' },
    updateActionItemDueDate: { type: 'string', description: 'Updated due date' },
    deleteActionItemId: { type: 'string', description: 'Action item ID to delete' },
    snoozeAlertId: { type: 'string', description: 'Alert ID to snooze' },
    snoozeDelayMinutes: { type: 'string', description: 'Minutes to snooze' },
    escalateAlertId: { type: 'string', description: 'Alert ID to escalate' },
    escalatePolicyId: { type: 'string', description: 'Escalation policy ID' },
    escalatePolicyLevel: { type: 'string', description: 'Escalation policy level' },
    listEventsIncidentId: { type: 'string', description: 'Incident ID for events' },
    listEventsPageSize: { type: 'string', description: 'Events page size' },
    listEventsPageNumber: { type: 'string', description: 'Events page number' },
    runWorkflowId: { type: 'string', description: 'Workflow ID to run' },
    runWorkflowIncidentId: { type: 'string', description: 'Incident ID for workflow run' },
    runWorkflowAlertId: { type: 'string', description: 'Alert ID for workflow run' },
    runWorkflowImmediate: { type: 'string', description: 'Run immediately' },
    runWorkflowCheckConditions: { type: 'string', description: 'Check workflow conditions' },
    incidentRolesSearch: { type: 'string', description: 'Search incident roles' },
    incidentRolesPageSize: { type: 'string', description: 'Incident roles page size' },
    incidentRolesPageNumber: { type: 'string', description: 'Incident roles page number' },
  },
  outputs: {
    incident: {
      type: 'json',
      description: 'Incident data (id, title, status, summary, severity, url, timestamps)',
    },
    incidents: {
      type: 'json',
      description: 'List of incidents (id, title, status, summary, severity, url, timestamps)',
    },
    alert: {
      type: 'json',
      description: 'Alert data (id, summary, description, status, source, externalUrl)',
    },
    alerts: {
      type: 'json',
      description: 'List of alerts (id, summary, description, status, source, externalUrl)',
    },
    eventId: { type: 'string', description: 'Created event ID' },
    event: { type: 'string', description: 'Event description' },
    visibility: { type: 'string', description: 'Event visibility' },
    occurredAt: { type: 'string', description: 'When the event occurred' },
    createdAt: { type: 'string', description: 'Creation date' },
    updatedAt: { type: 'string', description: 'Last update date' },
    services: {
      type: 'json',
      description: 'List of services (id, name, slug, description, color)',
    },
    severities: {
      type: 'json',
      description: 'List of severities (id, name, slug, severity, color, position)',
    },
    teams: { type: 'json', description: 'List of teams (id, name, slug, description, color)' },
    environments: {
      type: 'json',
      description: 'List of environments (id, name, slug, description, color)',
    },
    incidentTypes: {
      type: 'json',
      description: 'List of incident types (id, name, slug, description, color)',
    },
    functionalities: {
      type: 'json',
      description: 'List of functionalities (id, name, slug, description, color)',
    },
    retrospectives: {
      type: 'json',
      description: 'List of retrospectives (id, title, status, url, timestamps)',
    },
    users: {
      type: 'json',
      description: 'List of users (id, name, email)',
    },
    onCalls: {
      type: 'json',
      description:
        'List of on-call entries (userId, userName, scheduleId, scheduleName, escalationPolicyId)',
    },
    schedules: {
      type: 'json',
      description: 'List of schedules (id, name, description)',
    },
    escalationPolicies: {
      type: 'json',
      description: 'List of escalation policies (id, name, description)',
    },
    causes: {
      type: 'json',
      description: 'List of causes (id, name, slug, description)',
    },
    playbooks: {
      type: 'json',
      description: 'List of playbooks (id, title, summary)',
    },
    actionItem: {
      type: 'json',
      description: 'Action item data (id, summary, description, kind, priority, status, dueDate)',
    },
    actionItems: {
      type: 'json',
      description:
        'List of action items (id, summary, description, kind, priority, status, dueDate)',
    },
    statusPageEvent: {
      type: 'json',
      description: 'Status page event (id, event, status, statusPageId, notifySubscribers)',
    },
    events: {
      type: 'json',
      description: 'List of incident timeline events (id, event, visibility, occurredAt)',
    },
    workflowRun: {
      type: 'json',
      description: 'Triggered workflow run (id, workflowId, status, triggeredBy, timestamps)',
    },
    incidentRoles: {
      type: 'json',
      description: 'List of incident roles (id, name, slug, summary, enabled)',
    },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    message: { type: 'string', description: 'Operation result message' },
    totalCount: { type: 'number', description: 'Total count of items returned' },
  },
}

export const RootlyBlockMeta = {
  tags: ['incident-management', 'monitoring'],
  url: 'https://rootly.com',
  templates: [
    {
      icon: RootlyIcon,
      title: 'Rootly incident war-room',
      prompt:
        'Build a scheduled workflow that polls Rootly for newly opened incidents, creates a Slack war-room channel for each, invites responders, posts the incident summary, and keeps the channel topic in sync with severity.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly retro generator',
      prompt:
        'Create a scheduled workflow that polls Rootly for recently closed incidents, drafts the retrospective doc, pulls the Slack thread and timeline, and assigns owners for follow-up actions in Linear.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack', 'linear'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly weekly digest',
      prompt:
        'Build a scheduled weekly workflow that summarizes Rootly incident counts, MTTR, top affected services, and outstanding action items, and posts a digest to leadership Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly customer-comms drafter',
      prompt:
        'Create a workflow that drafts and queues customer-facing status updates during a Rootly incident based on severity and impacted services, holding for approval before publishing.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly action-item tracker',
      prompt:
        'Build a workflow that tracks Rootly follow-up actions across incidents, opens Linear tickets, and writes a tables-based dashboard that flags overdue items by owner.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly on-call digest',
      prompt:
        'Create a scheduled daily workflow that summarizes the past 24 hours of Rootly pages, the on-call responder load by person, and writes a digest to the SRE Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly + LangSmith agent-incident tracker',
      prompt:
        'Build a workflow that for each Rootly incident involving an AI agent attaches the LangSmith trace, captures the failure mode, and writes the agent-quality regression analysis.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'engineering'],
      alsoIntegrations: ['langsmith'],
    },
  ],
  skills: [
    {
      name: 'declare-incident',
      description: 'Open a Rootly incident with the right severity, service, and team assigned.',
      content:
        '# Declare Incident\n\nSpin up a structured Rootly incident from an alert or report.\n\n## Steps\n1. Run list_severities, list_services, and list_teams to resolve the correct ids.\n2. Run create_incident with a clear title, summary, severity, affected service, and owning team.\n3. Capture the returned incident id.\n4. Add an opening timeline note with add_incident_event.\n\n## Output\nReturn the incident id, severity, assigned team, and a link. Confirm the opening event was logged.',
    },
    {
      name: 'post-incident-update',
      description: 'Append a status update event to an active Rootly incident timeline.',
      content:
        '# Post Incident Update\n\nKeep an incident timeline current.\n\n## Steps\n1. Run get_incident to confirm the current state.\n2. Run add_incident_event with the update text (mitigation steps, customer impact, next checkpoint).\n3. Run update_incident if the severity or status has changed.\n\n## Output\nReturn the appended event and the current incident status.',
    },
    {
      name: 'triage-alerts',
      description:
        'List open Rootly alerts, acknowledge them, and escalate to an incident if needed.',
      content:
        '# Triage Alerts\n\nWork through the open alert queue.\n\n## Steps\n1. Run list_alerts to pull open alerts.\n2. For each, run get_alert for detail and run acknowledge_alert to claim it.\n3. If an alert warrants response, run create_incident and link it.\n4. Run resolve_alert once the alert is handled.\n\n## Output\nReturn how many alerts were acknowledged, resolved, and escalated to incidents.',
    },
    {
      name: 'check-on-call',
      description:
        'Look up who is currently on call across Rootly schedules and escalation policies.',
      content:
        '# Check On Call\n\nFind the right person to page right now.\n\n## Steps\n1. Run list_schedules to enumerate on-call schedules.\n2. Run list_on_calls to read the current rotation members.\n3. Cross-reference list_escalation_policies for the escalation path.\n\n## Output\nReturn the current on-call person per schedule and the escalation order.',
    },
    {
      name: 'track-action-items',
      description: 'Create and list retrospective action items tied to a Rootly incident.',
      content:
        '# Track Action Items\n\nCapture and follow up on postmortem action items.\n\n## Steps\n1. Run get_incident to confirm the incident context.\n2. Run create_action_item for each follow-up with a clear owner and description.\n3. Run list_action_items to review open items for the incident.\n\n## Output\nReturn the created action items and the list of outstanding follow-ups.',
    },
  ],
} as const satisfies BlockMeta
