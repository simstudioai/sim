import { RootlyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { RootlyResponse } from '@/tools/rootly/types'

export const RootlyBlock: BlockConfig<RootlyResponse> = {
  type: 'rootly',
  name: 'Rootly',
  description: 'Manage incidents, alerts, and on-call with Rootly',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Rootly incident management into workflows. Create and manage incidents, alerts, services, severities, and retrospectives.',
  docsLink: 'https://docs.sim.ai/tools/rootly',
  category: 'tools',
  integrationType: IntegrationType.DeveloperTools,
  tags: ['incident-management', 'monitoring'],
  bgColor: '#6C72C8',
  icon: RootlyIcon,
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
      ],
      value: () => 'rootly_create_incident',
    },

    // Create Incident fields
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Incident title',
      condition: { field: 'operation', value: 'rootly_create_incident' },
      required: { field: 'operation', value: 'rootly_create_incident' },
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
        { label: 'In Triage', id: 'in_triage' },
        { label: 'Started', id: 'started' },
        { label: 'Detected', id: 'detected' },
        { label: 'Acknowledged', id: 'acknowledged' },
        { label: 'Mitigated', id: 'mitigated' },
        { label: 'Resolved', id: 'resolved' },
        { label: 'Closed', id: 'closed' },
        { label: 'Cancelled', id: 'cancelled' },
      ],
      condition: { field: 'operation', value: 'rootly_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'createKind',
      title: 'Kind',
      type: 'dropdown',
      options: [
        { label: 'Normal', id: 'normal' },
        { label: 'Test', id: 'test' },
        { label: 'Example', id: 'example' },
        { label: 'Backfilled', id: 'backfilled' },
        { label: 'Scheduled', id: 'scheduled' },
      ],
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

    // Get Incident fields
    {
      id: 'getIncidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'The ID of the incident to retrieve',
      condition: { field: 'operation', value: 'rootly_get_incident' },
      required: { field: 'operation', value: 'rootly_get_incident' },
    },

    // Update Incident fields
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
        { label: 'In Triage', id: 'in_triage' },
        { label: 'Started', id: 'started' },
        { label: 'Detected', id: 'detected' },
        { label: 'Acknowledged', id: 'acknowledged' },
        { label: 'Mitigated', id: 'mitigated' },
        { label: 'Resolved', id: 'resolved' },
        { label: 'Closed', id: 'closed' },
        { label: 'Cancelled', id: 'cancelled' },
      ],
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

    // List Incidents fields
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
      ],
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
        { label: 'Newest First', id: '-created_at' },
        { label: 'Oldest First', id: 'created_at' },
        { label: 'Recently Started', id: '-started_at' },
        { label: 'Recently Updated', id: '-updated_at' },
      ],
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

    // Create Alert fields
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
      mode: 'advanced',
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
      id: 'alertExternalUrl',
      title: 'External URL',
      type: 'short-input',
      placeholder: 'Link to external source',
      condition: { field: 'operation', value: 'rootly_create_alert' },
      mode: 'advanced',
    },

    // List Alerts fields
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
      ],
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
      id: 'listAlertsPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_alerts' },
      mode: 'advanced',
    },

    // Add Incident Event fields
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
        { label: 'Internal', id: 'internal' },
        { label: 'External', id: 'external' },
      ],
      condition: { field: 'operation', value: 'rootly_add_incident_event' },
      mode: 'advanced',
    },

    // List Services fields
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

    // List Severities fields
    {
      id: 'severitiesPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'rootly_list_severities' },
      mode: 'advanced',
    },

    // List Teams fields
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

    // List Environments fields
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

    // List Incident Types fields
    {
      id: 'incidentTypesSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search incident types...',
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

    // List Functionalities fields
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

    // List Retrospectives fields
    {
      id: 'retrospectivesStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Draft', id: 'draft' },
        { label: 'Published', id: 'published' },
      ],
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

    // API Key (common)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Rootly API key',
      password: true,
      required: true,
    },
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
              mitigationMessage: params.mitigationMessage,
              resolutionMessage: params.resolutionMessage,
              serviceIds: params.updateServiceIds,
              environmentIds: params.updateEnvironmentIds,
              groupIds: params.updateGroupIds,
            }

          case 'rootly_list_incidents':
            return {
              ...baseParams,
              status: params.listIncidentsStatus,
              search: params.listIncidentsSearch,
              severity: params.listIncidentsSeverity,
              services: params.listIncidentsServices,
              sort: params.listIncidentsSort,
              pageSize: params.listIncidentsPageSize
                ? Number(params.listIncidentsPageSize)
                : undefined,
            }

          case 'rootly_create_alert':
            return {
              ...baseParams,
              summary: params.alertSummary,
              description: params.alertDescription,
              source: params.alertSource,
              serviceIds: params.alertServiceIds,
              groupIds: params.alertGroupIds,
              deduplicationKey: params.alertDeduplicationKey,
              externalUrl: params.alertExternalUrl,
            }

          case 'rootly_list_alerts':
            return {
              ...baseParams,
              status: params.listAlertsStatus,
              source: params.listAlertsSource,
              pageSize: params.listAlertsPageSize ? Number(params.listAlertsPageSize) : undefined,
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
            }

          case 'rootly_list_severities':
            return {
              ...baseParams,
              pageSize: params.severitiesPageSize ? Number(params.severitiesPageSize) : undefined,
            }

          case 'rootly_list_teams':
            return {
              ...baseParams,
              search: params.teamsSearch,
              pageSize: params.teamsPageSize ? Number(params.teamsPageSize) : undefined,
            }

          case 'rootly_list_environments':
            return {
              ...baseParams,
              search: params.environmentsSearch,
              pageSize: params.environmentsPageSize
                ? Number(params.environmentsPageSize)
                : undefined,
            }

          case 'rootly_list_incident_types':
            return {
              ...baseParams,
              search: params.incidentTypesSearch,
              pageSize: params.incidentTypesPageSize
                ? Number(params.incidentTypesPageSize)
                : undefined,
            }

          case 'rootly_list_functionalities':
            return {
              ...baseParams,
              search: params.functionalitiesSearch,
              pageSize: params.functionalitiesPageSize
                ? Number(params.functionalitiesPageSize)
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
    listIncidentsStatus: { type: 'string', description: 'Filter by status' },
    listIncidentsSearch: { type: 'string', description: 'Search incidents' },
    listIncidentsSeverity: { type: 'string', description: 'Filter by severity' },
    listIncidentsServices: { type: 'string', description: 'Filter by services' },
    listIncidentsSort: { type: 'string', description: 'Sort order' },
    listIncidentsPageSize: { type: 'string', description: 'Page size' },
    alertSummary: { type: 'string', description: 'Alert summary' },
    alertDescription: { type: 'string', description: 'Alert description' },
    alertSource: { type: 'string', description: 'Alert source' },
    alertServiceIds: { type: 'string', description: 'Alert service IDs' },
    alertGroupIds: { type: 'string', description: 'Alert team IDs' },
    alertDeduplicationKey: { type: 'string', description: 'Deduplication key' },
    alertExternalUrl: { type: 'string', description: 'External URL' },
    listAlertsStatus: { type: 'string', description: 'Filter alerts by status' },
    listAlertsSource: { type: 'string', description: 'Filter alerts by source' },
    listAlertsPageSize: { type: 'string', description: 'Alerts page size' },
    eventIncidentId: { type: 'string', description: 'Incident ID for event' },
    eventText: { type: 'string', description: 'Event description' },
    eventVisibility: { type: 'string', description: 'Event visibility' },
    servicesSearch: { type: 'string', description: 'Search services' },
    servicesPageSize: { type: 'string', description: 'Services page size' },
    severitiesPageSize: { type: 'string', description: 'Severities page size' },
    teamsSearch: { type: 'string', description: 'Search teams' },
    teamsPageSize: { type: 'string', description: 'Teams page size' },
    environmentsSearch: { type: 'string', description: 'Search environments' },
    environmentsPageSize: { type: 'string', description: 'Environments page size' },
    incidentTypesSearch: { type: 'string', description: 'Search incident types' },
    incidentTypesPageSize: { type: 'string', description: 'Incident types page size' },
    functionalitiesSearch: { type: 'string', description: 'Search functionalities' },
    functionalitiesPageSize: { type: 'string', description: 'Functionalities page size' },
    retrospectivesStatus: { type: 'string', description: 'Filter retrospectives by status' },
    retrospectivesSearch: { type: 'string', description: 'Search retrospectives' },
    retrospectivesPageSize: { type: 'string', description: 'Retrospectives page size' },
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
    totalCount: { type: 'number', description: 'Total count of items returned' },
  },
}
