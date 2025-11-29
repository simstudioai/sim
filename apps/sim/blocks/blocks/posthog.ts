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
  bgColor: '#E0E0E0',
  icon: PosthogIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Core Data Operations
        { label: 'Capture Event', id: 'posthog_capture_event' },
        { label: 'Batch Events', id: 'posthog_batch_events' },
        { label: 'List Events', id: 'posthog_list_events' },
        { label: 'List Persons', id: 'posthog_list_persons' },
        { label: 'Get Person', id: 'posthog_get_person' },
        { label: 'Delete Person', id: 'posthog_delete_person' },
        { label: 'Run Query (HogQL)', id: 'posthog_query' },
        // Analytics
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
        { label: 'List Feature Flags', id: 'posthog_list_feature_flags' },
        { label: 'Get Feature Flag', id: 'posthog_get_feature_flag' },
        { label: 'Create Feature Flag', id: 'posthog_create_feature_flag' },
        { label: 'Update Feature Flag', id: 'posthog_update_feature_flag' },
        { label: 'Delete Feature Flag', id: 'posthog_delete_feature_flag' },
        { label: 'Evaluate Flags', id: 'posthog_evaluate_flags' },
        { label: 'List Experiments', id: 'posthog_list_experiments' },
        { label: 'Get Experiment', id: 'posthog_get_experiment' },
        { label: 'Create Experiment', id: 'posthog_create_experiment' },
        // User Engagement
        { label: 'List Surveys', id: 'posthog_list_surveys' },
        { label: 'Get Survey', id: 'posthog_get_survey' },
        { label: 'Create Survey', id: 'posthog_create_survey' },
        { label: 'Update Survey', id: 'posthog_update_survey' },
        { label: 'List Session Recordings', id: 'posthog_list_session_recordings' },
        { label: 'Get Session Recording', id: 'posthog_get_session_recording' },
        { label: 'List Recording Playlists', id: 'posthog_list_recording_playlists' },
        // Data Management
        { label: 'List Event Definitions', id: 'posthog_list_event_definitions' },
        { label: 'Get Event Definition', id: 'posthog_get_event_definition' },
        { label: 'Update Event Definition', id: 'posthog_update_event_definition' },
        { label: 'List Property Definitions', id: 'posthog_list_property_definitions' },
        { label: 'Get Property Definition', id: 'posthog_get_property_definition' },
        { label: 'Update Property Definition', id: 'posthog_update_property_definition' },
        // Configuration
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
      required: {
        field: 'operation',
        value: [
          // Feature Flags
          'posthog_create_feature_flag',
          'posthog_update_feature_flag',
          'posthog_delete_feature_flag',
          'posthog_get_feature_flag',
          'posthog_list_feature_flags',
          // Experiments
          'posthog_create_experiment',
          'posthog_get_experiment',
          'posthog_list_experiments',
          // Data Management
          'posthog_list_property_definitions',
          'posthog_get_property_definition',
          'posthog_update_property_definition',
          'posthog_list_event_definitions',
          'posthog_get_event_definition',
          'posthog_update_event_definition',
          // Core Operations (with personalApiKey)
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
          // Surveys & Recordings
          'posthog_list_surveys',
          'posthog_get_survey',
          'posthog_create_survey',
          'posthog_update_survey',
          'posthog_list_session_recordings',
          'posthog_get_session_recording',
          'posthog_list_recording_playlists',
          // Configuration
          'posthog_list_projects',
          'posthog_get_project',
          'posthog_list_organizations',
          'posthog_get_organization',
        ],
      },
    },

    // API Keys (conditional based on operation)
    {
      id: 'projectApiKey',
      title: 'Project API Key',
      type: 'short-input',
      placeholder: 'Enter your PostHog project API key',
      password: true,
      condition: {
        field: 'operation',
        value: ['posthog_capture_event', 'posthog_batch_events', 'posthog_evaluate_flags'],
      },
      required: true,
    },
    {
      id: 'personalApiKey',
      title: 'Personal API Key',
      type: 'short-input',
      placeholder: 'Enter your PostHog personal API key',
      password: true,
      condition: {
        field: 'operation',
        value: ['posthog_capture_event', 'posthog_batch_events', 'posthog_evaluate_flags'],
        not: true,
      },
      required: true,
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Enter your PostHog project ID',
      condition: {
        field: 'operation',
        value: [
          'posthog_capture_event',
          'posthog_batch_events',
          'posthog_evaluate_flags',
          'posthog_list_projects',
          'posthog_get_project',
          'posthog_list_organizations',
          'posthog_get_organization',
        ],
        not: true,
      },
      required: true,
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
      condition: {
        field: 'operation',
        value: ['posthog_capture_event', 'posthog_evaluate_flags'],
      },
      required: true,
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

    // Evaluate Flags fields
    {
      id: 'groups',
      title: 'Groups (JSON)',
      type: 'long-input',
      placeholder: '{"company": "company_id_in_your_db"}',
      condition: { field: 'operation', value: 'posthog_evaluate_flags' },
    },
    {
      id: 'personProperties',
      title: 'Person Properties (JSON)',
      type: 'long-input',
      placeholder: '{"email": "user@example.com", "plan": "enterprise"}',
      condition: { field: 'operation', value: 'posthog_evaluate_flags' },
    },
    {
      id: 'groupProperties',
      title: 'Group Properties (JSON)',
      type: 'long-input',
      placeholder: '{"plan": "enterprise", "seats": 100}',
      condition: { field: 'operation', value: 'posthog_evaluate_flags' },
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
      condition: {
        field: 'operation',
        value: 'posthog_query',
      },
      required: true,
    },
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'HogQL query or JSON object',
      condition: {
        field: 'operation',
        value: 'posthog_create_cohort',
      },
    },
    {
      id: 'values',
      title: 'Query Values (JSON)',
      type: 'long-input',
      placeholder: '{"param1": "value1"}',
      condition: { field: 'operation', value: 'posthog_query' },
    },

    // List Events filters
    {
      id: 'eventFilter',
      title: 'Event Name Filter',
      type: 'short-input',
      placeholder: 'e.g., page_view, button_clicked',
      condition: { field: 'operation', value: 'posthog_list_events' },
    },
    {
      id: 'before',
      title: 'Before (ISO 8601)',
      type: 'short-input',
      placeholder: '2024-01-01T12:00:00Z',
      condition: { field: 'operation', value: 'posthog_list_events' },
    },
    {
      id: 'after',
      title: 'After (ISO 8601)',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'posthog_list_events' },
    },
    {
      id: 'distinctIdFilter',
      title: 'Distinct ID Filter',
      type: 'short-input',
      placeholder: 'user123',
      condition: {
        field: 'operation',
        value: ['posthog_list_events', 'posthog_list_persons'],
      },
    },

    // ID fields for get/update/delete operations
    {
      id: 'personId',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'Person ID or UUID',
      condition: {
        field: 'operation',
        value: ['posthog_get_person', 'posthog_delete_person'],
      },
      required: true,
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
      condition: {
        field: 'operation',
        value: [
          'posthog_get_feature_flag',
          'posthog_update_feature_flag',
          'posthog_delete_feature_flag',
        ],
      },
      required: true,
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
      condition: {
        field: 'operation',
        value: ['posthog_get_survey', 'posthog_update_survey'],
      },
      required: true,
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
      condition: {
        field: 'operation',
        value: ['posthog_get_event_definition', 'posthog_update_event_definition'],
      },
      required: true,
    },
    {
      id: 'propertyDefinitionId',
      title: 'Property Definition ID',
      type: 'short-input',
      placeholder: 'Property Definition ID',
      condition: {
        field: 'operation',
        value: ['posthog_get_property_definition', 'posthog_update_property_definition'],
      },
      required: true,
    },

    // Create/Update fields (name, description, etc.)
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Enter name',
      condition: {
        field: 'operation',
        value: [
          'posthog_create_insight',
          'posthog_create_cohort',
          'posthog_create_annotation',
          'posthog_create_feature_flag',
          'posthog_update_feature_flag',
          'posthog_create_experiment',
          'posthog_create_survey',
          'posthog_update_survey',
        ],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter description',
      condition: {
        field: 'operation',
        value: [
          'posthog_create_insight',
          'posthog_create_cohort',
          'posthog_create_feature_flag',
          'posthog_update_feature_flag',
          'posthog_create_experiment',
          'posthog_create_survey',
          'posthog_update_survey',
          'posthog_update_event_definition',
          'posthog_update_property_definition',
        ],
      },
    },

    // Feature Flag specific fields
    {
      id: 'key',
      title: 'Flag Key',
      type: 'short-input',
      placeholder: 'feature_flag_key',
      condition: {
        field: 'operation',
        value: 'posthog_create_feature_flag',
      },
      required: true,
    },
    {
      id: 'key',
      title: 'Flag Key',
      type: 'short-input',
      placeholder: 'feature_flag_key',
      condition: {
        field: 'operation',
        value: 'posthog_update_feature_flag',
      },
    },
    {
      id: 'filters',
      title: 'Filters (JSON)',
      type: 'long-input',
      placeholder: '{"groups": [...]}',
      condition: {
        field: 'operation',
        value: [
          'posthog_create_insight',
          'posthog_create_feature_flag',
          'posthog_update_feature_flag',
          'posthog_create_cohort',
          'posthog_create_experiment',
        ],
      },
    },

    // Insight specific fields
    {
      id: 'insightQuery',
      title: 'Query (JSON)',
      type: 'long-input',
      placeholder: '{"kind": "HogQLQuery", "query": "SELECT ..."}',
      condition: { field: 'operation', value: 'posthog_create_insight' },
    },
    {
      id: 'dashboards',
      title: 'Dashboard IDs (comma-separated)',
      type: 'short-input',
      placeholder: '123, 456, 789',
      condition: { field: 'operation', value: 'posthog_create_insight' },
    },
    {
      id: 'insightTags',
      title: 'Tags (comma-separated)',
      type: 'short-input',
      placeholder: 'analytics, revenue, important',
      condition: { field: 'operation', value: 'posthog_create_insight' },
    },

    // Feature Flag fields
    {
      id: 'active',
      title: 'Active',
      type: 'switch',
      value: () => 'true',
      condition: {
        field: 'operation',
        value: ['posthog_create_feature_flag', 'posthog_update_feature_flag'],
      },
    },
    {
      id: 'rolloutPercentage',
      title: 'Rollout Percentage',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['posthog_create_feature_flag', 'posthog_update_feature_flag'],
      },
    },
    {
      id: 'ensureExperienceContinuity',
      title: 'Ensure Experience Continuity',
      type: 'switch',
      value: () => 'false',
      condition: {
        field: 'operation',
        value: ['posthog_create_feature_flag', 'posthog_update_feature_flag'],
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
    {
      id: 'isStatic',
      title: 'Static Cohort',
      type: 'switch',
      value: () => 'false',
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
    {
      id: 'variants',
      title: 'Variants (JSON)',
      type: 'long-input',
      placeholder: '{"control": 50, "test": 50}',
      condition: { field: 'operation', value: 'posthog_create_experiment' },
    },
    {
      id: 'experimentStartDate',
      title: 'Start Date (ISO 8601)',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'posthog_create_experiment' },
    },
    {
      id: 'experimentEndDate',
      title: 'End Date (ISO 8601)',
      type: 'short-input',
      placeholder: '2024-12-31T23:59:59Z',
      condition: { field: 'operation', value: 'posthog_create_experiment' },
    },

    // Survey fields
    {
      id: 'questions',
      title: 'Questions (JSON Array)',
      type: 'long-input',
      placeholder: '[{"type": "open", "question": "What do you think?"}]',
      condition: {
        field: 'operation',
        value: 'posthog_create_survey',
      },
      required: true,
    },
    {
      id: 'questions',
      title: 'Questions (JSON Array)',
      type: 'long-input',
      placeholder: '[{"type": "open", "question": "What do you think?"}]',
      condition: {
        field: 'operation',
        value: 'posthog_update_survey',
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
      condition: {
        field: 'operation',
        value: ['posthog_create_survey', 'posthog_update_survey'],
      },
    },
    {
      id: 'surveyStartDate',
      title: 'Start Date (ISO 8601)',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      condition: {
        field: 'operation',
        value: ['posthog_create_survey', 'posthog_update_survey'],
      },
    },
    {
      id: 'surveyEndDate',
      title: 'End Date (ISO 8601)',
      type: 'short-input',
      placeholder: '2024-12-31T23:59:59Z',
      condition: {
        field: 'operation',
        value: ['posthog_create_survey', 'posthog_update_survey'],
      },
    },
    {
      id: 'appearance',
      title: 'Appearance (JSON)',
      type: 'long-input',
      placeholder: '{"backgroundColor": "#ffffff", "position": "right"}',
      condition: {
        field: 'operation',
        value: ['posthog_create_survey', 'posthog_update_survey'],
      },
    },
    {
      id: 'conditions',
      title: 'Conditions (JSON)',
      type: 'long-input',
      placeholder: '{"url": "contains", "value": "/checkout"}',
      condition: {
        field: 'operation',
        value: ['posthog_create_survey', 'posthog_update_survey'],
      },
    },
    {
      id: 'targetingFlagFilters',
      title: 'Targeting Flag Filters (JSON)',
      type: 'long-input',
      placeholder: '{"groups": [...]}',
      condition: {
        field: 'operation',
        value: ['posthog_create_survey', 'posthog_update_survey'],
      },
    },
    {
      id: 'linkedFlagId',
      title: 'Linked Feature Flag ID',
      type: 'short-input',
      placeholder: 'Feature flag ID',
      condition: {
        field: 'operation',
        value: ['posthog_create_survey', 'posthog_update_survey'],
      },
    },
    {
      id: 'responsesLimit',
      title: 'Responses Limit',
      type: 'short-input',
      placeholder: '1000',
      condition: {
        field: 'operation',
        value: ['posthog_create_survey', 'posthog_update_survey'],
      },
    },

    // List operations - pagination fields
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: [
          'posthog_list_events',
          'posthog_list_persons',
          'posthog_list_insights',
          'posthog_list_dashboards',
          'posthog_list_actions',
          'posthog_list_cohorts',
          'posthog_list_annotations',
          'posthog_list_feature_flags',
          'posthog_list_experiments',
          'posthog_list_surveys',
          'posthog_list_session_recordings',
          'posthog_list_recording_playlists',
          'posthog_list_event_definitions',
          'posthog_list_property_definitions',
        ],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: {
        field: 'operation',
        value: [
          'posthog_list_events',
          'posthog_list_persons',
          'posthog_list_insights',
          'posthog_list_dashboards',
          'posthog_list_actions',
          'posthog_list_cohorts',
          'posthog_list_annotations',
          'posthog_list_feature_flags',
          'posthog_list_experiments',
          'posthog_list_surveys',
          'posthog_list_session_recordings',
          'posthog_list_recording_playlists',
          'posthog_list_event_definitions',
          'posthog_list_property_definitions',
        ],
      },
    },

    // Search/Filter fields
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search query',
      condition: {
        field: 'operation',
        value: [
          'posthog_list_persons',
          'posthog_list_event_definitions',
          'posthog_list_property_definitions',
        ],
      },
    },

    // Tags field
    {
      id: 'tags',
      title: 'Tags (comma-separated)',
      type: 'short-input',
      placeholder: 'tag1, tag2, tag3',
      condition: {
        field: 'operation',
        value: ['posthog_update_event_definition', 'posthog_update_property_definition'],
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
      // Engagement
      'posthog_list_surveys',
      'posthog_get_survey',
      'posthog_create_survey',
      'posthog_update_survey',
      'posthog_list_session_recordings',
      'posthog_get_session_recording',
      'posthog_list_recording_playlists',
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

        // Map surveyType to type for survey operations
        if (
          (params.operation === 'posthog_create_survey' ||
            params.operation === 'posthog_update_survey') &&
          params.surveyType
        ) {
          params.type = params.surveyType
        }

        // Map isStatic for cohorts
        if (params.operation === 'posthog_create_cohort' && params.isStatic !== undefined) {
          params.is_static = params.isStatic
        }

        // Map dateMarker to date_marker for annotations
        if (params.operation === 'posthog_create_annotation' && params.dateMarker) {
          params.date_marker = params.dateMarker
        }

        // Map propertyType to property_type
        if (params.operation === 'posthog_update_property_definition' && params.propertyType) {
          params.property_type = params.propertyType
        }

        // Map insightQuery to query for insights
        if (params.operation === 'posthog_create_insight' && params.insightQuery) {
          params.query = params.insightQuery
        }

        // Map insightTags to tags for insights
        if (params.operation === 'posthog_create_insight' && params.insightTags) {
          params.tags = params.insightTags
        }

        // Map eventFilter to event for list_events
        if (params.operation === 'posthog_list_events' && params.eventFilter) {
          params.event = params.eventFilter
        }

        // Map distinctIdFilter to distinctId for list operations
        if (
          (params.operation === 'posthog_list_events' ||
            params.operation === 'posthog_list_persons') &&
          params.distinctIdFilter
        ) {
          params.distinctId = params.distinctIdFilter
        }

        // Map experiment date fields
        if (params.operation === 'posthog_create_experiment') {
          if (params.experimentStartDate) {
            params.startDate = params.experimentStartDate
          }
          if (params.experimentEndDate) {
            params.endDate = params.experimentEndDate
          }
        }

        // Map survey date fields
        if (
          params.operation === 'posthog_create_survey' ||
          params.operation === 'posthog_update_survey'
        ) {
          if (params.surveyStartDate) {
            params.startDate = params.surveyStartDate
          }
          if (params.surveyEndDate) {
            params.endDate = params.surveyEndDate
          }
        }

        // Convert responsesLimit to number
        if (params.responsesLimit) {
          params.responsesLimit = Number(params.responsesLimit)
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
