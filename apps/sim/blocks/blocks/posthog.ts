import { PosthogIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { PostHogResponse } from '@/tools/posthog/types'

export const PostHogBlock: BlockConfig<PostHogResponse> = {
  type: 'posthog',
  name: 'PostHog',
  description: 'Product analytics and feature management',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate PostHog into your workflow. Track events, manage feature flags, analyze user behavior, run experiments, create surveys, and access session recordings.',
  docsLink: 'https://docs.sim.ai/tools/posthog',
  category: 'tools',
  bgColor: '#1D4AFF',
  icon: PosthogIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Core Data Operations
        { label: '📊 Core Data', id: 'section_core_data', disabled: true },
        { label: 'Capture Event', id: 'posthog_capture_event' },
        { label: 'Batch Events', id: 'posthog_batch_events' },
        { label: 'List Events', id: 'posthog_list_events' },
        { label: 'List Persons', id: 'posthog_list_persons' },
        { label: 'Get Person', id: 'posthog_get_person' },
        { label: 'Delete Person', id: 'posthog_delete_person' },
        { label: 'Run Query (HogQL)', id: 'posthog_query' },
        // Analytics
        { label: '📈 Analytics', id: 'section_analytics', disabled: true },
        { label: 'List Insights', id: 'posthog_list_insights' },
        { label: 'Get Insight', id: 'posthog_get_insight' },
        { label: 'Create Insight', id: 'posthog_create_insight' },
        { label: 'List Dashboards', id: 'posthog_list_dashboards' },
        { label: 'Get Dashboard', id: 'posthog_get_dashboard' },
        { label: 'List Actions', id: 'posthog_list_actions' },
        { label: 'List Cohorts', id: 'posthog_list_cohorts' },
        { label: 'Get Cohort', id: 'posthog_get_cohort' },
        { label: 'Create Cohort', id: 'posthog_create_cohort' },
        { label: 'List Annotations', id: 'posthog_list_annotations' },
        { label: 'Create Annotation', id: 'posthog_create_annotation' },
        // Feature Management
        { label: '🚩 Feature Management', id: 'section_features', disabled: true },
        { label: 'List Feature Flags', id: 'posthog_list_feature_flags' },
        { label: 'Get Feature Flag', id: 'posthog_get_feature_flag' },
        { label: 'Create Feature Flag', id: 'posthog_create_feature_flag' },
        { label: 'Update Feature Flag', id: 'posthog_update_feature_flag' },
        { label: 'Delete Feature Flag', id: 'posthog_delete_feature_flag' },
        { label: 'Evaluate Flags', id: 'posthog_evaluate_flags' },
        { label: 'List Experiments', id: 'posthog_list_experiments' },
        { label: 'Get Experiment', id: 'posthog_get_experiment' },
        { label: 'Create Experiment', id: 'posthog_create_experiment' },
        { label: 'List Early Access Features', id: 'posthog_list_early_access_features' },
        { label: 'Create Early Access Feature', id: 'posthog_create_early_access_feature' },
        // User Engagement
        { label: '💬 User Engagement', id: 'section_engagement', disabled: true },
        { label: 'List Surveys', id: 'posthog_list_surveys' },
        { label: 'Get Survey', id: 'posthog_get_survey' },
        { label: 'Create Survey', id: 'posthog_create_survey' },
        { label: 'Update Survey', id: 'posthog_update_survey' },
        { label: 'List Session Recordings', id: 'posthog_list_session_recordings' },
        { label: 'Get Session Recording', id: 'posthog_get_session_recording' },
        { label: 'List Recording Playlists', id: 'posthog_list_recording_playlists' },
        { label: 'Create Recording Playlist', id: 'posthog_create_recording_playlist' },
        // Data Management
        { label: '🗂️ Data Management', id: 'section_data_mgmt', disabled: true },
        { label: 'List Event Definitions', id: 'posthog_list_event_definitions' },
        { label: 'Get Event Definition', id: 'posthog_get_event_definition' },
        { label: 'Update Event Definition', id: 'posthog_update_event_definition' },
        { label: 'List Property Definitions', id: 'posthog_list_property_definitions' },
        { label: 'Get Property Definition', id: 'posthog_get_property_definition' },
        { label: 'Update Property Definition', id: 'posthog_update_property_definition' },
        // Configuration
        { label: '⚙️ Configuration', id: 'section_config', disabled: true },
        { label: 'List Projects', id: 'posthog_list_projects' },
        { label: 'Get Project', id: 'posthog_get_project' },
        { label: 'List Organizations', id: 'posthog_list_organizations' },
        { label: 'Get Organization', id: 'posthog_get_organization' },
      ],
      value: () => 'posthog_capture_event',
    },

    // Common fields
    {
      id: 'region',
      title: 'Region',
      type: 'dropdown',
      options: [
        { label: 'US Cloud', id: 'us' },
        { label: 'EU Cloud', id: 'eu' },
      ],
      value: () => 'us',
    },

    // API Keys (conditional based on operation)
    {
      id: 'projectApiKey',
      title: 'Project API Key',
      type: 'short-input',
      placeholder: 'Enter your PostHog project API key',
      password: true,
      condition: (params) => {
        const publicOps = [
          'posthog_capture_event',
          'posthog_batch_events',
          'posthog_evaluate_flags',
        ]
        return publicOps.includes(params.operation as string)
      },
      required: (params) => {
        const publicOps = [
          'posthog_capture_event',
          'posthog_batch_events',
          'posthog_evaluate_flags',
        ]
        return publicOps.includes(params.operation as string)
      },
    },
    {
      id: 'personalApiKey',
      title: 'Personal API Key',
      type: 'short-input',
      placeholder: 'Enter your PostHog personal API key',
      password: true,
      condition: (params) => {
        const publicOps = [
          'posthog_capture_event',
          'posthog_batch_events',
          'posthog_evaluate_flags',
        ]
        return !publicOps.includes(params.operation as string)
      },
      required: (params) => {
        const publicOps = [
          'posthog_capture_event',
          'posthog_batch_events',
          'posthog_evaluate_flags',
        ]
        return !publicOps.includes(params.operation as string)
      },
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Enter your PostHog project ID',
      condition: (params) => {
        const noProjectIdOps = [
          'posthog_capture_event',
          'posthog_batch_events',
          'posthog_evaluate_flags',
          'posthog_list_projects',
          'posthog_get_project',
          'posthog_list_organizations',
          'posthog_get_organization',
        ]
        return !noProjectIdOps.includes(params.operation as string)
      },
      required: (params) => {
        const noProjectIdOps = [
          'posthog_capture_event',
          'posthog_batch_events',
          'posthog_evaluate_flags',
          'posthog_list_projects',
          'posthog_get_project',
          'posthog_list_organizations',
          'posthog_get_organization',
        ]
        return !noProjectIdOps.includes(params.operation as string)
      },
    },

    // Capture Event fields
    {
      id: 'event',
      title: 'Event Name',
      type: 'short-input',
      placeholder: 'e.g., page_view, button_clicked',
      condition: { field: 'operation', value: 'posthog_capture_event' },
      required: true,
    },
    {
      id: 'distinctId',
      title: 'Distinct ID',
      type: 'short-input',
      placeholder: 'Unique identifier for the user',
      condition: (params) => {
        return ['posthog_capture_event', 'posthog_evaluate_flags'].includes(
          params.operation as string
        )
      },
      required: (params) => {
        return ['posthog_capture_event', 'posthog_evaluate_flags'].includes(
          params.operation as string
        )
      },
    },
    {
      id: 'properties',
      title: 'Properties (JSON)',
      type: 'long-input',
      placeholder: '{"key": "value"}',
      condition: { field: 'operation', value: 'posthog_capture_event' },
    },
    {
      id: 'timestamp',
      title: 'Timestamp (ISO 8601)',
      type: 'short-input',
      placeholder: '2024-01-01T12:00:00Z',
      condition: { field: 'operation', value: 'posthog_capture_event' },
    },

    // Batch Events fields
    {
      id: 'batch',
      title: 'Batch Events (JSON Array)',
      type: 'long-input',
      placeholder: '[{"event": "page_view", "distinct_id": "user123", "properties": {...}}]',
      condition: { field: 'operation', value: 'posthog_batch_events' },
      required: true,
    },

    // Query fields
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'HogQL query or JSON object',
      condition: (params) => {
        return ['posthog_query', 'posthog_create_cohort'].includes(params.operation as string)
      },
      required: (params) => {
        return params.operation === 'posthog_query'
      },
    },
    {
      id: 'values',
      title: 'Query Values (JSON)',
      type: 'long-input',
      placeholder: '{"param1": "value1"}',
      condition: { field: 'operation', value: 'posthog_query' },
    },

    // ID fields for get/update/delete operations
    {
      id: 'personId',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'Person ID or UUID',
      condition: (params) => {
        return ['posthog_get_person', 'posthog_delete_person'].includes(params.operation as string)
      },
      required: (params) => {
        return ['posthog_get_person', 'posthog_delete_person'].includes(params.operation as string)
      },
    },
    {
      id: 'insightId',
      title: 'Insight ID',
      type: 'short-input',
      placeholder: 'Insight ID',
      condition: { field: 'operation', value: 'posthog_get_insight' },
      required: true,
    },
    {
      id: 'dashboardId',
      title: 'Dashboard ID',
      type: 'short-input',
      placeholder: 'Dashboard ID',
      condition: { field: 'operation', value: 'posthog_get_dashboard' },
      required: true,
    },
    {
      id: 'cohortId',
      title: 'Cohort ID',
      type: 'short-input',
      placeholder: 'Cohort ID',
      condition: { field: 'operation', value: 'posthog_get_cohort' },
      required: true,
    },
    {
      id: 'featureFlagId',
      title: 'Feature Flag ID',
      type: 'short-input',
      placeholder: 'Feature Flag ID',
      condition: (params) => {
        return [
          'posthog_get_feature_flag',
          'posthog_update_feature_flag',
          'posthog_delete_feature_flag',
        ].includes(params.operation as string)
      },
      required: (params) => {
        return [
          'posthog_get_feature_flag',
          'posthog_update_feature_flag',
          'posthog_delete_feature_flag',
        ].includes(params.operation as string)
      },
    },
    {
      id: 'experimentId',
      title: 'Experiment ID',
      type: 'short-input',
      placeholder: 'Experiment ID',
      condition: { field: 'operation', value: 'posthog_get_experiment' },
      required: true,
    },
    {
      id: 'surveyId',
      title: 'Survey ID',
      type: 'short-input',
      placeholder: 'Survey ID',
      condition: (params) => {
        return ['posthog_get_survey', 'posthog_update_survey'].includes(params.operation as string)
      },
      required: (params) => {
        return ['posthog_get_survey', 'posthog_update_survey'].includes(params.operation as string)
      },
    },
    {
      id: 'recordingId',
      title: 'Recording ID',
      type: 'short-input',
      placeholder: 'Session Recording ID',
      condition: { field: 'operation', value: 'posthog_get_session_recording' },
      required: true,
    },
    {
      id: 'eventDefinitionId',
      title: 'Event Definition ID',
      type: 'short-input',
      placeholder: 'Event Definition ID',
      condition: (params) => {
        return ['posthog_get_event_definition', 'posthog_update_event_definition'].includes(
          params.operation as string
        )
      },
      required: (params) => {
        return ['posthog_get_event_definition', 'posthog_update_event_definition'].includes(
          params.operation as string
        )
      },
    },
    {
      id: 'propertyDefinitionId',
      title: 'Property Definition ID',
      type: 'short-input',
      placeholder: 'Property Definition ID',
      condition: (params) => {
        return ['posthog_get_property_definition', 'posthog_update_property_definition'].includes(
          params.operation as string
        )
      },
      required: (params) => {
        return ['posthog_get_property_definition', 'posthog_update_property_definition'].includes(
          params.operation as string
        )
      },
    },

    // Create/Update fields (name, description, etc.)
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Enter name',
      condition: (params) => {
        const createUpdateOps = [
          'posthog_create_insight',
          'posthog_create_cohort',
          'posthog_create_annotation',
          'posthog_create_feature_flag',
          'posthog_update_feature_flag',
          'posthog_create_experiment',
          'posthog_create_early_access_feature',
          'posthog_create_survey',
          'posthog_update_survey',
          'posthog_create_recording_playlist',
        ]
        return createUpdateOps.includes(params.operation as string)
      },
      required: (params) => {
        const requiredOps = [
          'posthog_create_feature_flag',
          'posthog_create_experiment',
          'posthog_create_early_access_feature',
          'posthog_create_survey',
        ]
        return requiredOps.includes(params.operation as string)
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter description',
      condition: (params) => {
        const descOps = [
          'posthog_create_insight',
          'posthog_create_cohort',
          'posthog_create_feature_flag',
          'posthog_update_feature_flag',
          'posthog_create_experiment',
          'posthog_create_early_access_feature',
          'posthog_create_survey',
          'posthog_update_survey',
          'posthog_create_recording_playlist',
          'posthog_update_event_definition',
          'posthog_update_property_definition',
        ]
        return descOps.includes(params.operation as string)
      },
    },

    // Feature Flag specific fields
    {
      id: 'key',
      title: 'Flag Key',
      type: 'short-input',
      placeholder: 'feature_flag_key',
      condition: (params) => {
        return ['posthog_create_feature_flag', 'posthog_update_feature_flag'].includes(
          params.operation as string
        )
      },
      required: (params) => {
        return params.operation === 'posthog_create_feature_flag'
      },
    },
    {
      id: 'filters',
      title: 'Filters (JSON)',
      type: 'long-input',
      placeholder: '{"groups": [...]}',
      condition: (params) => {
        return [
          'posthog_create_insight',
          'posthog_create_feature_flag',
          'posthog_update_feature_flag',
          'posthog_create_cohort',
        ].includes(params.operation as string)
      },
    },
    {
      id: 'active',
      title: 'Active',
      type: 'switch',
      condition: (params) => {
        return ['posthog_create_feature_flag', 'posthog_update_feature_flag'].includes(
          params.operation as string
        )
      },
    },
    {
      id: 'rolloutPercentage',
      title: 'Rollout Percentage',
      type: 'short-input',
      placeholder: '100',
      condition: (params) => {
        return ['posthog_create_feature_flag', 'posthog_update_feature_flag'].includes(
          params.operation as string
        )
      },
    },

    // Cohort fields
    {
      id: 'groups',
      title: 'Groups (JSON Array)',
      type: 'long-input',
      placeholder: '[{"properties": [...]}]',
      condition: { field: 'operation', value: 'posthog_create_cohort' },
    },

    // Annotation fields
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Annotation content',
      condition: { field: 'operation', value: 'posthog_create_annotation' },
      required: true,
    },
    {
      id: 'dateMarker',
      title: 'Date Marker (ISO 8601)',
      type: 'short-input',
      placeholder: '2024-01-01T12:00:00Z',
      condition: { field: 'operation', value: 'posthog_create_annotation' },
      required: true,
    },
    {
      id: 'scope',
      title: 'Scope',
      type: 'dropdown',
      options: [
        { label: 'Project', id: 'project' },
        { label: 'Dashboard Item', id: 'dashboard_item' },
      ],
      value: () => 'project',
      condition: { field: 'operation', value: 'posthog_create_annotation' },
    },

    // Experiment fields
    {
      id: 'featureFlagKey',
      title: 'Feature Flag Key',
      type: 'short-input',
      placeholder: 'experiment_flag_key',
      condition: { field: 'operation', value: 'posthog_create_experiment' },
      required: true,
    },
    {
      id: 'parameters',
      title: 'Parameters (JSON)',
      type: 'long-input',
      placeholder: '{"minimum_detectable_effect": 5}',
      condition: { field: 'operation', value: 'posthog_create_experiment' },
    },

    // Survey fields
    {
      id: 'questions',
      title: 'Questions (JSON Array)',
      type: 'long-input',
      placeholder: '[{"type": "open", "question": "What do you think?"}]',
      condition: (params) => {
        return ['posthog_create_survey', 'posthog_update_survey'].includes(
          params.operation as string
        )
      },
      required: (params) => {
        return params.operation === 'posthog_create_survey'
      },
    },
    {
      id: 'surveyType',
      title: 'Survey Type',
      type: 'dropdown',
      options: [
        { label: 'Popover', id: 'popover' },
        { label: 'API', id: 'api' },
      ],
      value: () => 'popover',
      condition: (params) => {
        return ['posthog_create_survey', 'posthog_update_survey'].includes(
          params.operation as string
        )
      },
    },

    // Early Access Feature fields
    {
      id: 'stage',
      title: 'Stage',
      type: 'dropdown',
      options: [
        { label: 'Alpha', id: 'alpha' },
        { label: 'Beta', id: 'beta' },
        { label: 'General Availability', id: 'general-availability' },
      ],
      value: () => 'beta',
      condition: { field: 'operation', value: 'posthog_create_early_access_feature' },
    },
    {
      id: 'documentationUrl',
      title: 'Documentation URL',
      type: 'short-input',
      placeholder: 'https://docs.example.com/feature',
      condition: { field: 'operation', value: 'posthog_create_early_access_feature' },
    },

    // List operations - pagination fields
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: (params) => {
        const listOps = [
          'posthog_list_events',
          'posthog_list_persons',
          'posthog_list_insights',
          'posthog_list_dashboards',
          'posthog_list_actions',
          'posthog_list_cohorts',
          'posthog_list_annotations',
          'posthog_list_feature_flags',
          'posthog_list_experiments',
          'posthog_list_early_access_features',
          'posthog_list_surveys',
          'posthog_list_session_recordings',
          'posthog_list_recording_playlists',
          'posthog_list_event_definitions',
          'posthog_list_property_definitions',
        ]
        return listOps.includes(params.operation as string)
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: (params) => {
        const listOps = [
          'posthog_list_events',
          'posthog_list_persons',
          'posthog_list_insights',
          'posthog_list_dashboards',
          'posthog_list_actions',
          'posthog_list_cohorts',
          'posthog_list_annotations',
          'posthog_list_feature_flags',
          'posthog_list_experiments',
          'posthog_list_early_access_features',
          'posthog_list_surveys',
          'posthog_list_session_recordings',
          'posthog_list_recording_playlists',
          'posthog_list_event_definitions',
          'posthog_list_property_definitions',
        ]
        return listOps.includes(params.operation as string)
      },
    },

    // Search/Filter fields
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search query',
      condition: (params) => {
        return [
          'posthog_list_persons',
          'posthog_list_event_definitions',
          'posthog_list_property_definitions',
        ].includes(params.operation as string)
      },
    },

    // Tags field
    {
      id: 'tags',
      title: 'Tags (comma-separated)',
      type: 'short-input',
      placeholder: 'tag1, tag2, tag3',
      condition: (params) => {
        return ['posthog_update_event_definition', 'posthog_update_property_definition'].includes(
          params.operation as string
        )
      },
    },

    // Property type field
    {
      id: 'propertyType',
      title: 'Property Type',
      type: 'dropdown',
      options: [
        { label: 'DateTime', id: 'DateTime' },
        { label: 'String', id: 'String' },
        { label: 'Numeric', id: 'Numeric' },
        { label: 'Boolean', id: 'Boolean' },
      ],
      condition: { field: 'operation', value: 'posthog_update_property_definition' },
    },

    // Organization/Project ID fields
    {
      id: 'organizationId',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Organization ID',
      condition: { field: 'operation', value: 'posthog_get_organization' },
      required: true,
    },
    {
      id: 'projectIdParam',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Project ID',
      condition: { field: 'operation', value: 'posthog_get_project' },
      required: true,
    },
  ],

  tools: {
    access: [
      // Core Data
      'posthog_capture_event',
      'posthog_batch_events',
      'posthog_list_events',
      'posthog_list_persons',
      'posthog_get_person',
      'posthog_delete_person',
      'posthog_query',
      // Analytics
      'posthog_list_insights',
      'posthog_get_insight',
      'posthog_create_insight',
      'posthog_list_dashboards',
      'posthog_get_dashboard',
      'posthog_list_actions',
      'posthog_list_cohorts',
      'posthog_get_cohort',
      'posthog_create_cohort',
      'posthog_list_annotations',
      'posthog_create_annotation',
      // Feature Management
      'posthog_list_feature_flags',
      'posthog_get_feature_flag',
      'posthog_create_feature_flag',
      'posthog_update_feature_flag',
      'posthog_delete_feature_flag',
      'posthog_evaluate_flags',
      'posthog_list_experiments',
      'posthog_get_experiment',
      'posthog_create_experiment',
      'posthog_list_early_access_features',
      'posthog_create_early_access_feature',
      // Engagement
      'posthog_list_surveys',
      'posthog_get_survey',
      'posthog_create_survey',
      'posthog_update_survey',
      'posthog_list_session_recordings',
      'posthog_get_session_recording',
      'posthog_list_recording_playlists',
      'posthog_create_recording_playlist',
      // Data Management
      'posthog_list_event_definitions',
      'posthog_get_event_definition',
      'posthog_update_event_definition',
      'posthog_list_property_definitions',
      'posthog_get_property_definition',
      'posthog_update_property_definition',
      // Configuration
      'posthog_list_projects',
      'posthog_get_project',
      'posthog_list_organizations',
      'posthog_get_organization',
    ],
    config: {
      tool: (params) => {
        // Convert numeric parameters
        if (params.limit) params.limit = Number(params.limit)
        if (params.offset) params.offset = Number(params.offset)
        if (params.rolloutPercentage) params.rolloutPercentage = Number(params.rolloutPercentage)

        // Map projectIdParam to projectId for get_project operation
        if (params.operation === 'posthog_get_project' && params.projectIdParam) {
          params.projectId = params.projectIdParam
        }

        // Map personalApiKey to apiKey for all private endpoint tools
        if (params.personalApiKey) {
          params.apiKey = params.personalApiKey
        }

        // Map featureFlagId to flagId for feature flag operations
        const flagOps = [
          'posthog_get_feature_flag',
          'posthog_update_feature_flag',
          'posthog_delete_feature_flag',
        ]
        if (flagOps.includes(params.operation as string) && params.featureFlagId) {
          params.flagId = params.featureFlagId
        }

        return params.operation as string
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    region: { type: 'string', description: 'PostHog region (us or eu)' },
    projectApiKey: { type: 'string', description: 'Project API key for public endpoints' },
    personalApiKey: { type: 'string', description: 'Personal API key for private endpoints' },
    projectId: { type: 'string', description: 'PostHog project ID' },
    // Core Data
    event: { type: 'string', description: 'Event name' },
    distinctId: { type: 'string', description: 'Unique user identifier' },
    properties: { type: 'string', description: 'Event properties as JSON' },
    timestamp: { type: 'string', description: 'Event timestamp (ISO 8601)' },
    batch: { type: 'string', description: 'Batch events as JSON array' },
    query: { type: 'string', description: 'HogQL query or JSON object' },
    values: { type: 'string', description: 'Query parameters' },
    // IDs
    personId: { type: 'string', description: 'Person ID' },
    insightId: { type: 'string', description: 'Insight ID' },
    dashboardId: { type: 'string', description: 'Dashboard ID' },
    cohortId: { type: 'string', description: 'Cohort ID' },
    featureFlagId: { type: 'string', description: 'Feature Flag ID' },
    experimentId: { type: 'string', description: 'Experiment ID' },
    surveyId: { type: 'string', description: 'Survey ID' },
    recordingId: { type: 'string', description: 'Recording ID' },
    eventDefinitionId: { type: 'string', description: 'Event Definition ID' },
    propertyDefinitionId: { type: 'string', description: 'Property Definition ID' },
    organizationId: { type: 'string', description: 'Organization ID' },
    projectIdParam: { type: 'string', description: 'Project ID parameter' },
    // Common fields
    name: { type: 'string', description: 'Name' },
    description: { type: 'string', description: 'Description' },
    key: { type: 'string', description: 'Feature flag key' },
    filters: { type: 'string', description: 'Filters as JSON' },
    active: { type: 'boolean', description: 'Whether flag is active' },
    rolloutPercentage: { type: 'number', description: 'Rollout percentage (0-100)' },
    groups: { type: 'string', description: 'Cohort groups as JSON' },
    content: { type: 'string', description: 'Annotation content' },
    dateMarker: { type: 'string', description: 'Annotation date' },
    scope: { type: 'string', description: 'Annotation scope' },
    featureFlagKey: { type: 'string', description: 'Feature flag key for experiment' },
    parameters: { type: 'string', description: 'Experiment parameters as JSON' },
    questions: { type: 'string', description: 'Survey questions as JSON array' },
    surveyType: { type: 'string', description: 'Survey type (popover or api)' },
    stage: { type: 'string', description: 'Early access feature stage' },
    documentationUrl: { type: 'string', description: 'Documentation URL' },
    // List parameters
    limit: { type: 'number', description: 'Number of results to return' },
    offset: { type: 'number', description: 'Number of results to skip' },
    search: { type: 'string', description: 'Search query' },
    tags: { type: 'string', description: 'Tags (comma-separated)' },
    propertyType: { type: 'string', description: 'Property type' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    output: { type: 'json', description: 'Operation result data' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
