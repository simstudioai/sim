import { AmplitudeIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'

export const AmplitudeBlock: BlockConfig = {
  type: 'amplitude',
  name: 'Amplitude',
  description: 'Track events and query analytics from Amplitude',
  longDescription:
    'Integrate Amplitude into your workflow to track events, identify users and groups, search for users, query analytics, and retrieve revenue data.',
  docsLink: 'https://docs.sim.ai/tools/amplitude',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  tags: ['data-analytics', 'marketing'],
  bgColor: '#1B1F3B',
  icon: AmplitudeIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Event', id: 'send_event' },
        { label: 'Identify User', id: 'identify_user' },
        { label: 'Group Identify', id: 'group_identify' },
        { label: 'User Search', id: 'user_search' },
        { label: 'User Activity', id: 'user_activity' },
        { label: 'User Profile', id: 'user_profile' },
        { label: 'Event Segmentation', id: 'event_segmentation' },
        { label: 'Get Active Users', id: 'get_active_users' },
        { label: 'Real-time Active Users', id: 'realtime_active_users' },
        { label: 'List Events', id: 'list_events' },
        { label: 'Get Revenue', id: 'get_revenue' },
      ],
      value: () => 'send_event',
    },

    // API Key (required for all operations)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Amplitude API Key',
      password: true,
      condition: {
        field: 'operation',
        value: 'user_profile',
        not: true,
      },
    },

    // API Key for user_profile (not required - uses only secretKey)
    // User Profile uses Api-Key header with secret key only

    // Secret Key (required for Dashboard REST API operations + User Profile)
    {
      id: 'secretKey',
      title: 'Secret Key',
      type: 'short-input',
      required: {
        field: 'operation',
        value: [
          'user_search',
          'user_activity',
          'user_profile',
          'event_segmentation',
          'get_active_users',
          'realtime_active_users',
          'list_events',
          'get_revenue',
        ],
      },
      placeholder: 'Enter your Amplitude Secret Key',
      password: true,
      condition: {
        field: 'operation',
        value: [
          'user_search',
          'user_activity',
          'user_profile',
          'event_segmentation',
          'get_active_users',
          'realtime_active_users',
          'list_events',
          'get_revenue',
        ],
      },
    },

    // --- Send Event fields ---
    {
      id: 'eventType',
      title: 'Event Type',
      type: 'short-input',
      required: { field: 'operation', value: 'send_event' },
      placeholder: 'e.g., page_view, purchase, signup',
      condition: { field: 'operation', value: 'send_event' },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'User identifier',
      condition: { field: 'operation', value: ['send_event', 'identify_user'] },
    },
    {
      id: 'profileUserId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'External user ID (required if no Device ID)',
      condition: { field: 'operation', value: 'user_profile' },
    },
    {
      id: 'deviceId',
      title: 'Device ID',
      type: 'short-input',
      placeholder: 'Device identifier',
      condition: { field: 'operation', value: ['send_event', 'identify_user'] },
      mode: 'advanced',
    },
    {
      id: 'profileDeviceId',
      title: 'Device ID',
      type: 'short-input',
      placeholder: 'Device ID (required if no User ID)',
      condition: { field: 'operation', value: 'user_profile' },
      mode: 'advanced',
    },
    {
      id: 'eventProperties',
      title: 'Event Properties',
      type: 'long-input',
      placeholder: '{"button": "signup", "page": "/home"}',
      condition: { field: 'operation', value: 'send_event' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of event properties for an Amplitude event. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'sendEventUserProperties',
      title: 'User Properties',
      type: 'long-input',
      placeholder: '{"$set": {"plan": "premium"}}',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of user properties for Amplitude. Use $set, $setOnce, $add, $append, or $unset operations. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'platform',
      title: 'Platform',
      type: 'short-input',
      placeholder: 'e.g., Web, iOS, Android',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'appVersion',
      title: 'App Version',
      type: 'short-input',
      placeholder: 'e.g., 1.0.0',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'insertId',
      title: 'Insert ID',
      type: 'short-input',
      placeholder: 'Unique ID for deduplication',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'price',
      title: 'Price',
      type: 'short-input',
      placeholder: '9.99',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'quantity',
      title: 'Quantity',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'revenue',
      title: 'Revenue',
      type: 'short-input',
      placeholder: '9.99',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'productId',
      title: 'Product ID',
      type: 'short-input',
      placeholder: 'Product identifier',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'revenueType',
      title: 'Revenue Type',
      type: 'short-input',
      placeholder: 'e.g., purchase, refund',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'Two-letter country code (e.g., US)',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'Language code (e.g., en)',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'ip',
      title: 'IP Address',
      type: 'short-input',
      placeholder: 'IP for geo-location (use "$remote" for request IP)',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },
    {
      id: 'time',
      title: 'Timestamp',
      type: 'short-input',
      placeholder: 'Milliseconds since epoch',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in milliseconds since epoch for the current time. Return ONLY the number - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'Session start time in milliseconds (-1 for no session)',
      condition: { field: 'operation', value: 'send_event' },
      mode: 'advanced',
    },

    // --- Identify User fields ---
    {
      id: 'identifyUserProperties',
      title: 'User Properties',
      type: 'long-input',
      required: { field: 'operation', value: 'identify_user' },
      placeholder: '{"$set": {"plan": "premium", "company": "Acme"}}',
      condition: { field: 'operation', value: 'identify_user' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of user properties for Amplitude Identify API. Use $set, $setOnce, $add, $append, or $unset operations. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },

    // --- Group Identify fields ---
    {
      id: 'groupType',
      title: 'Group Type',
      type: 'short-input',
      required: { field: 'operation', value: 'group_identify' },
      placeholder: 'e.g., company, org_id',
      condition: { field: 'operation', value: 'group_identify' },
    },
    {
      id: 'groupValue',
      title: 'Group Value',
      type: 'short-input',
      required: { field: 'operation', value: 'group_identify' },
      placeholder: 'e.g., Acme Corp',
      condition: { field: 'operation', value: 'group_identify' },
    },
    {
      id: 'groupProperties',
      title: 'Group Properties',
      type: 'long-input',
      required: { field: 'operation', value: 'group_identify' },
      placeholder: '{"$set": {"industry": "tech", "employee_count": 500}}',
      condition: { field: 'operation', value: 'group_identify' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of group properties for Amplitude Group Identify API. Use $set, $setOnce, $add, $append, or $unset operations. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },

    // --- User Search fields ---
    {
      id: 'searchUser',
      title: 'User',
      type: 'short-input',
      required: { field: 'operation', value: 'user_search' },
      placeholder: 'User ID, Device ID, or Amplitude ID',
      condition: { field: 'operation', value: 'user_search' },
    },

    // --- User Activity fields ---
    {
      id: 'amplitudeId',
      title: 'Amplitude ID',
      type: 'short-input',
      required: { field: 'operation', value: 'user_activity' },
      placeholder: 'Amplitude internal user ID',
      condition: { field: 'operation', value: 'user_activity' },
    },
    {
      id: 'activityOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'user_activity' },
      mode: 'advanced',
    },
    {
      id: 'activityLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '1000',
      condition: { field: 'operation', value: 'user_activity' },
      mode: 'advanced',
    },
    {
      id: 'activityDirection',
      title: 'Direction',
      type: 'dropdown',
      options: [
        { label: 'Latest First', id: 'latest' },
        { label: 'Earliest First', id: 'earliest' },
      ],
      value: () => 'latest',
      condition: { field: 'operation', value: 'user_activity' },
      mode: 'advanced',
    },

    // --- User Profile fields ---
    {
      id: 'getAmpProps',
      title: 'Include User Properties',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'user_profile' },
      mode: 'advanced',
    },
    {
      id: 'getCohortIds',
      title: 'Include Cohort IDs',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'user_profile' },
      mode: 'advanced',
    },
    {
      id: 'getComputations',
      title: 'Include Computed Properties',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'user_profile' },
      mode: 'advanced',
    },

    // --- Event Segmentation fields ---
    {
      id: 'segmentationEventType',
      title: 'Event Type',
      type: 'short-input',
      required: { field: 'operation', value: 'event_segmentation' },
      placeholder: 'Event type to analyze',
      condition: { field: 'operation', value: 'event_segmentation' },
    },
    {
      id: 'segmentationStart',
      title: 'Start Date',
      type: 'short-input',
      required: { field: 'operation', value: 'event_segmentation' },
      placeholder: 'YYYYMMDD',
      condition: { field: 'operation', value: 'event_segmentation' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYYMMDD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'segmentationEnd',
      title: 'End Date',
      type: 'short-input',
      required: { field: 'operation', value: 'event_segmentation' },
      placeholder: 'YYYYMMDD',
      condition: { field: 'operation', value: 'event_segmentation' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYYMMDD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'segmentationMetric',
      title: 'Metric',
      type: 'dropdown',
      options: [
        { label: 'Uniques', id: 'uniques' },
        { label: 'Totals', id: 'totals' },
        { label: '% DAU', id: 'pct_dau' },
        { label: 'Average', id: 'average' },
        { label: 'Histogram', id: 'histogram' },
        { label: 'Sums', id: 'sums' },
        { label: 'Value Average', id: 'value_avg' },
        { label: 'Formula', id: 'formula' },
      ],
      value: () => 'uniques',
      condition: { field: 'operation', value: 'event_segmentation' },
      mode: 'advanced',
    },
    {
      id: 'segmentationInterval',
      title: 'Interval',
      type: 'dropdown',
      options: [
        { label: 'Daily', id: '1' },
        { label: 'Weekly', id: '7' },
        { label: 'Monthly', id: '30' },
      ],
      value: () => '1',
      condition: { field: 'operation', value: 'event_segmentation' },
      mode: 'advanced',
    },
    {
      id: 'segmentationGroupBy',
      title: 'Group By',
      type: 'short-input',
      placeholder: 'Property name (prefix custom with "gp:")',
      condition: { field: 'operation', value: 'event_segmentation' },
      mode: 'advanced',
    },
    {
      id: 'segmentationLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max group-by values (max 1000)',
      condition: { field: 'operation', value: 'event_segmentation' },
      mode: 'advanced',
    },

    // --- Get Active Users fields ---
    {
      id: 'activeUsersStart',
      title: 'Start Date',
      type: 'short-input',
      required: { field: 'operation', value: 'get_active_users' },
      placeholder: 'YYYYMMDD',
      condition: { field: 'operation', value: 'get_active_users' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYYMMDD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'activeUsersEnd',
      title: 'End Date',
      type: 'short-input',
      required: { field: 'operation', value: 'get_active_users' },
      placeholder: 'YYYYMMDD',
      condition: { field: 'operation', value: 'get_active_users' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYYMMDD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'activeUsersMetric',
      title: 'Metric',
      type: 'dropdown',
      options: [
        { label: 'Active Users', id: 'active' },
        { label: 'New Users', id: 'new' },
      ],
      value: () => 'active',
      condition: { field: 'operation', value: 'get_active_users' },
      mode: 'advanced',
    },
    {
      id: 'activeUsersInterval',
      title: 'Interval',
      type: 'dropdown',
      options: [
        { label: 'Daily', id: '1' },
        { label: 'Weekly', id: '7' },
        { label: 'Monthly', id: '30' },
      ],
      value: () => '1',
      condition: { field: 'operation', value: 'get_active_users' },
      mode: 'advanced',
    },

    // --- Get Revenue fields ---
    {
      id: 'revenueStart',
      title: 'Start Date',
      type: 'short-input',
      required: { field: 'operation', value: 'get_revenue' },
      placeholder: 'YYYYMMDD',
      condition: { field: 'operation', value: 'get_revenue' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYYMMDD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'revenueEnd',
      title: 'End Date',
      type: 'short-input',
      required: { field: 'operation', value: 'get_revenue' },
      placeholder: 'YYYYMMDD',
      condition: { field: 'operation', value: 'get_revenue' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYYMMDD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'revenueMetric',
      title: 'Metric',
      type: 'dropdown',
      options: [
        { label: 'ARPU', id: '0' },
        { label: 'ARPPU', id: '1' },
        { label: 'Total Revenue', id: '2' },
        { label: 'Paying Users', id: '3' },
      ],
      value: () => '2',
      condition: { field: 'operation', value: 'get_revenue' },
      mode: 'advanced',
    },
    {
      id: 'revenueInterval',
      title: 'Interval',
      type: 'dropdown',
      options: [
        { label: 'Daily', id: '1' },
        { label: 'Weekly', id: '7' },
        { label: 'Monthly', id: '30' },
      ],
      value: () => '1',
      condition: { field: 'operation', value: 'get_revenue' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'amplitude_send_event',
      'amplitude_identify_user',
      'amplitude_group_identify',
      'amplitude_user_search',
      'amplitude_user_activity',
      'amplitude_user_profile',
      'amplitude_event_segmentation',
      'amplitude_get_active_users',
      'amplitude_realtime_active_users',
      'amplitude_list_events',
      'amplitude_get_revenue',
    ],
    config: {
      tool: (params) => `amplitude_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}

        switch (params.operation) {
          case 'send_event':
            if (params.sendEventUserProperties)
              result.userProperties = params.sendEventUserProperties
            break

          case 'identify_user':
            if (params.identifyUserProperties) result.userProperties = params.identifyUserProperties
            break

          case 'user_search':
            if (params.searchUser) result.user = params.searchUser
            break

          case 'user_activity':
            if (params.activityOffset) result.offset = params.activityOffset
            if (params.activityLimit) result.limit = params.activityLimit
            if (params.activityDirection) result.direction = params.activityDirection
            break

          case 'user_profile':
            if (params.profileUserId) result.userId = params.profileUserId
            if (params.profileDeviceId) result.deviceId = params.profileDeviceId
            break

          case 'event_segmentation':
            if (params.segmentationEventType) result.eventType = params.segmentationEventType
            if (params.segmentationStart) result.start = params.segmentationStart
            if (params.segmentationEnd) result.end = params.segmentationEnd
            if (params.segmentationMetric) result.metric = params.segmentationMetric
            if (params.segmentationInterval) result.interval = params.segmentationInterval
            if (params.segmentationGroupBy) result.groupBy = params.segmentationGroupBy
            if (params.segmentationLimit) result.limit = params.segmentationLimit
            break

          case 'get_active_users':
            if (params.activeUsersStart) result.start = params.activeUsersStart
            if (params.activeUsersEnd) result.end = params.activeUsersEnd
            if (params.activeUsersMetric) result.metric = params.activeUsersMetric
            if (params.activeUsersInterval) result.interval = params.activeUsersInterval
            break

          case 'get_revenue':
            if (params.revenueStart) result.start = params.revenueStart
            if (params.revenueEnd) result.end = params.revenueEnd
            if (params.revenueMetric) result.metric = params.revenueMetric
            if (params.revenueInterval) result.interval = params.revenueInterval
            break
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Amplitude API Key' },
    secretKey: { type: 'string', description: 'Amplitude Secret Key' },
    eventType: { type: 'string', description: 'Event type name' },
    userId: { type: 'string', description: 'User ID' },
    deviceId: { type: 'string', description: 'Device ID' },
    eventProperties: { type: 'string', description: 'Event properties JSON' },
    sendEventUserProperties: { type: 'string', description: 'User properties for send event' },
    identifyUserProperties: { type: 'string', description: 'User properties for identify' },
    groupType: { type: 'string', description: 'Group type classification' },
    groupValue: { type: 'string', description: 'Group identifier value' },
    groupProperties: { type: 'string', description: 'Group properties JSON' },
    searchUser: { type: 'string', description: 'User to search for' },
    amplitudeId: { type: 'string', description: 'Amplitude internal user ID' },
    profileUserId: { type: 'string', description: 'User ID for profile lookup' },
    profileDeviceId: { type: 'string', description: 'Device ID for profile lookup' },
    segmentationEventType: { type: 'string', description: 'Event type to analyze' },
    segmentationStart: { type: 'string', description: 'Segmentation start date' },
    segmentationEnd: { type: 'string', description: 'Segmentation end date' },
    activeUsersStart: { type: 'string', description: 'Active users start date' },
    activeUsersEnd: { type: 'string', description: 'Active users end date' },
    revenueStart: { type: 'string', description: 'Revenue start date' },
    revenueEnd: { type: 'string', description: 'Revenue end date' },
  },

  outputs: {
    code: {
      type: 'number',
      description: 'Response status code',
    },
    message: {
      type: 'string',
      description: 'Response message (identify_user, group_identify)',
    },
    eventsIngested: {
      type: 'number',
      description: 'Number of events ingested (send_event)',
    },
    matches: {
      type: 'json',
      description: 'User search matches (amplitudeId, userId)',
    },
    events: {
      type: 'json',
      description: 'Event list (list_events, user_activity)',
    },
    userData: {
      type: 'json',
      description: 'User metadata (user_activity)',
    },
    series: {
      type: 'json',
      description: 'Time-series data (segmentation, active_users, revenue, realtime)',
    },
    seriesLabels: {
      type: 'json',
      description: 'Labels for each data series (segmentation, realtime, revenue)',
    },
    seriesMeta: {
      type: 'json',
      description: 'Metadata labels for data series (active_users)',
    },
    seriesCollapsed: {
      type: 'json',
      description: 'Collapsed aggregate totals per series (segmentation)',
    },
    xValues: {
      type: 'json',
      description: 'X-axis date/time values for chart data',
    },
  },
}
