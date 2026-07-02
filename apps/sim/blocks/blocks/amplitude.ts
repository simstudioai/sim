import { AmplitudeIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'

export const AmplitudeBlock: BlockConfig = {
  type: 'amplitude',
  name: 'Amplitude',
  description: 'Track events and query analytics from Amplitude',
  longDescription:
    'Integrate Amplitude into your workflow to track events, identify users and groups, search for users, query analytics, analyze funnels and retention, and retrieve revenue data.',
  docsLink: 'https://docs.sim.ai/integrations/amplitude',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#13294B',
  iconColor: '#1E61F0',
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
        { label: 'Funnels', id: 'funnels' },
        { label: 'Retention', id: 'retention' },
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
          'funnels',
          'retention',
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
          'funnels',
          'retention',
        ],
      },
    },

    // Data Residency (all operations except User Profile, which is US-only)
    {
      id: 'dataResidency',
      title: 'Data Residency',
      type: 'dropdown',
      options: [
        { label: 'US (default)', id: 'us' },
        { label: 'EU', id: 'eu' },
      ],
      value: () => 'us',
      condition: { field: 'operation', value: 'user_profile', not: true },
      mode: 'advanced',
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
        { label: 'Real-time', id: '-300000' },
        { label: 'Hourly', id: '-3600000' },
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
      id: 'segmentationGroupBy2',
      title: 'Group By (2nd Property)',
      type: 'short-input',
      placeholder: 'Second property name (prefix custom with "gp:")',
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
    {
      id: 'segmentationFilters',
      title: 'Filters',
      type: 'long-input',
      placeholder:
        '[{"subprop_type":"event","subprop_key":"city","subprop_op":"is","subprop_value":["San Francisco"]}]',
      condition: { field: 'operation', value: 'event_segmentation' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Amplitude event segmentation filter objects, each with subprop_type ("event" or "user"), subprop_key, subprop_op (e.g. "is", "is not", "contains"), and subprop_value (array of strings). Return ONLY the JSON array - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'segmentationFormula',
      title: 'Formula',
      type: 'short-input',
      placeholder: 'e.g., UNIQUES(A)/UNIQUES(B) — required when Metric is Formula',
      condition: {
        field: 'operation',
        value: 'event_segmentation',
        and: { field: 'segmentationMetric', value: 'formula' },
      },
      required: {
        field: 'operation',
        value: 'event_segmentation',
        and: { field: 'segmentationMetric', value: 'formula' },
      },
      mode: 'advanced',
    },
    {
      id: 'segmentationSegment',
      title: 'Segment Definition',
      type: 'long-input',
      placeholder: 'JSON segment definition(s)',
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
    {
      id: 'activeUsersGroupBy',
      title: 'Group By',
      type: 'short-input',
      placeholder: 'Property name',
      condition: { field: 'operation', value: 'get_active_users' },
      mode: 'advanced',
    },
    {
      id: 'activeUsersSegment',
      title: 'Segment Definition',
      type: 'long-input',
      placeholder: 'JSON segment definition(s)',
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
    {
      id: 'revenueGroupBy',
      title: 'Group By',
      type: 'short-input',
      placeholder: 'Property name (limit: one)',
      condition: { field: 'operation', value: 'get_revenue' },
      mode: 'advanced',
    },
    {
      id: 'revenueSegment',
      title: 'Segment Definition',
      type: 'long-input',
      placeholder: 'JSON segment definition(s)',
      condition: { field: 'operation', value: 'get_revenue' },
      mode: 'advanced',
    },

    // --- Funnels fields ---
    {
      id: 'funnelEvents',
      title: 'Funnel Steps',
      type: 'long-input',
      required: { field: 'operation', value: 'funnels' },
      placeholder: '[{"event_type":"signup"},{"event_type":"purchase"}]',
      condition: { field: 'operation', value: 'funnels' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Amplitude event objects, one per funnel step in order, each with an "event_type" key. Return ONLY the JSON array - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'funnelStart',
      title: 'Start Date',
      type: 'short-input',
      required: { field: 'operation', value: 'funnels' },
      placeholder: 'YYYYMMDD',
      condition: { field: 'operation', value: 'funnels' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYYMMDD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'funnelEnd',
      title: 'End Date',
      type: 'short-input',
      required: { field: 'operation', value: 'funnels' },
      placeholder: 'YYYYMMDD',
      condition: { field: 'operation', value: 'funnels' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYYMMDD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'funnelMode',
      title: 'Funnel Mode',
      type: 'dropdown',
      options: [
        { label: 'Ordered', id: 'ordered' },
        { label: 'Unordered', id: 'unordered' },
        { label: 'Sequential', id: 'sequential' },
      ],
      value: () => 'ordered',
      condition: { field: 'operation', value: 'funnels' },
      mode: 'advanced',
    },
    {
      id: 'funnelUserType',
      title: 'User Type',
      type: 'dropdown',
      options: [
        { label: 'Active', id: 'active' },
        { label: 'New', id: 'new' },
      ],
      value: () => 'active',
      condition: { field: 'operation', value: 'funnels' },
      mode: 'advanced',
    },
    {
      id: 'funnelInterval',
      title: 'Interval',
      type: 'dropdown',
      options: [
        { label: 'Real-time', id: '-300000' },
        { label: 'Hourly', id: '-3600000' },
        { label: 'Daily', id: '1' },
        { label: 'Weekly', id: '7' },
        { label: 'Monthly', id: '30' },
      ],
      value: () => '1',
      condition: { field: 'operation', value: 'funnels' },
      mode: 'advanced',
    },
    {
      id: 'funnelConversionWindowSeconds',
      title: 'Conversion Window (seconds)',
      type: 'short-input',
      placeholder: '2592000 (30 days)',
      condition: { field: 'operation', value: 'funnels' },
      mode: 'advanced',
    },
    {
      id: 'funnelGroupBy',
      title: 'Group By',
      type: 'short-input',
      placeholder: 'Property name (limit: one)',
      condition: { field: 'operation', value: 'funnels' },
      mode: 'advanced',
    },
    {
      id: 'funnelLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max group-by values (max 1000)',
      condition: { field: 'operation', value: 'funnels' },
      mode: 'advanced',
    },
    {
      id: 'funnelSegment',
      title: 'Segment Definition',
      type: 'long-input',
      placeholder: 'JSON segment definition(s)',
      condition: { field: 'operation', value: 'funnels' },
      mode: 'advanced',
    },

    // --- Retention fields ---
    {
      id: 'retentionStartEvent',
      title: 'Starting Event',
      type: 'short-input',
      required: { field: 'operation', value: 'retention' },
      placeholder: '{"event_type":"_new"}',
      condition: { field: 'operation', value: 'retention' },
    },
    {
      id: 'retentionReturnEvent',
      title: 'Returning Event',
      type: 'short-input',
      required: { field: 'operation', value: 'retention' },
      placeholder: '{"event_type":"_all"}',
      condition: { field: 'operation', value: 'retention' },
    },
    {
      id: 'retentionStart',
      title: 'Start Date',
      type: 'short-input',
      required: { field: 'operation', value: 'retention' },
      placeholder: 'YYYYMMDD',
      condition: { field: 'operation', value: 'retention' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYYMMDD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'retentionEnd',
      title: 'End Date',
      type: 'short-input',
      required: { field: 'operation', value: 'retention' },
      placeholder: 'YYYYMMDD',
      condition: { field: 'operation', value: 'retention' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYYMMDD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'retentionMode',
      title: 'Retention Mode',
      type: 'dropdown',
      options: [
        { label: 'N-Day', id: 'n-day' },
        { label: 'Rolling', id: 'rolling' },
        { label: 'Bracket', id: 'bracket' },
      ],
      value: () => 'n-day',
      condition: { field: 'operation', value: 'retention' },
      mode: 'advanced',
    },
    {
      id: 'retentionBrackets',
      title: 'Retention Brackets',
      type: 'short-input',
      placeholder: '[[0,4]] — required when Retention Mode is Bracket',
      condition: {
        field: 'operation',
        value: 'retention',
        and: { field: 'retentionMode', value: 'bracket' },
      },
      required: {
        field: 'operation',
        value: 'retention',
        and: { field: 'retentionMode', value: 'bracket' },
      },
      mode: 'advanced',
    },
    {
      id: 'retentionInterval',
      title: 'Interval',
      type: 'dropdown',
      options: [
        { label: 'Daily', id: '1' },
        { label: 'Weekly', id: '7' },
        { label: 'Monthly', id: '30' },
      ],
      value: () => '1',
      condition: { field: 'operation', value: 'retention' },
      mode: 'advanced',
    },
    {
      id: 'retentionGroupBy',
      title: 'Group By',
      type: 'short-input',
      placeholder: 'Property name (limit: one)',
      condition: { field: 'operation', value: 'retention' },
      mode: 'advanced',
    },
    {
      id: 'retentionSegment',
      title: 'Segment Definition',
      type: 'long-input',
      placeholder: 'JSON segment definition(s)',
      condition: { field: 'operation', value: 'retention' },
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
      'amplitude_funnels',
      'amplitude_retention',
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
            if (params.segmentationGroupBy2) result.groupBy2 = params.segmentationGroupBy2
            if (params.segmentationLimit) result.limit = params.segmentationLimit
            if (params.segmentationFilters) result.filters = params.segmentationFilters
            if (params.segmentationFormula) result.formula = params.segmentationFormula
            if (params.segmentationSegment) result.segment = params.segmentationSegment
            break

          case 'get_active_users':
            if (params.activeUsersStart) result.start = params.activeUsersStart
            if (params.activeUsersEnd) result.end = params.activeUsersEnd
            if (params.activeUsersMetric) result.metric = params.activeUsersMetric
            if (params.activeUsersInterval) result.interval = params.activeUsersInterval
            if (params.activeUsersGroupBy) result.groupBy = params.activeUsersGroupBy
            if (params.activeUsersSegment) result.segment = params.activeUsersSegment
            break

          case 'get_revenue':
            if (params.revenueStart) result.start = params.revenueStart
            if (params.revenueEnd) result.end = params.revenueEnd
            if (params.revenueMetric) result.metric = params.revenueMetric
            if (params.revenueInterval) result.interval = params.revenueInterval
            if (params.revenueGroupBy) result.groupBy = params.revenueGroupBy
            if (params.revenueSegment) result.segment = params.revenueSegment
            break

          case 'funnels':
            if (params.funnelEvents) result.events = params.funnelEvents
            if (params.funnelStart) result.start = params.funnelStart
            if (params.funnelEnd) result.end = params.funnelEnd
            if (params.funnelMode) result.mode = params.funnelMode
            if (params.funnelUserType) result.userType = params.funnelUserType
            if (params.funnelInterval) result.interval = params.funnelInterval
            if (params.funnelConversionWindowSeconds)
              result.conversionWindowSeconds = params.funnelConversionWindowSeconds
            if (params.funnelGroupBy) result.groupBy = params.funnelGroupBy
            if (params.funnelLimit) result.limit = params.funnelLimit
            if (params.funnelSegment) result.segment = params.funnelSegment
            break

          case 'retention':
            if (params.retentionStartEvent) result.startEvent = params.retentionStartEvent
            if (params.retentionReturnEvent) result.returnEvent = params.retentionReturnEvent
            if (params.retentionStart) result.start = params.retentionStart
            if (params.retentionEnd) result.end = params.retentionEnd
            if (params.retentionMode) result.retentionMode = params.retentionMode
            if (params.retentionBrackets) result.retentionBrackets = params.retentionBrackets
            if (params.retentionInterval) result.interval = params.retentionInterval
            if (params.retentionGroupBy) result.groupBy = params.retentionGroupBy
            if (params.retentionSegment) result.segment = params.retentionSegment
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
    dataResidency: { type: 'string', description: 'Data residency region: "us" or "eu"' },
    segmentationFilters: { type: 'string', description: 'Event segmentation filters JSON' },
    segmentationFormula: { type: 'string', description: 'Event segmentation formula expression' },
    segmentationGroupBy2: {
      type: 'string',
      description: 'Event segmentation second group-by property',
    },
    segmentationSegment: {
      type: 'string',
      description: 'Event segmentation segment definition JSON',
    },
    activeUsersGroupBy: { type: 'string', description: 'Active users group-by property' },
    activeUsersSegment: { type: 'string', description: 'Active users segment definition JSON' },
    revenueGroupBy: { type: 'string', description: 'Revenue group-by property' },
    revenueSegment: { type: 'string', description: 'Revenue segment definition JSON' },
    funnelEvents: { type: 'string', description: 'Funnel step event objects JSON array' },
    funnelStart: { type: 'string', description: 'Funnel analysis start date' },
    funnelEnd: { type: 'string', description: 'Funnel analysis end date' },
    funnelGroupBy: { type: 'string', description: 'Funnel group-by property' },
    funnelSegment: { type: 'string', description: 'Funnel segment definition JSON' },
    retentionStartEvent: { type: 'string', description: 'Retention starting event JSON object' },
    retentionReturnEvent: { type: 'string', description: 'Retention returning event JSON object' },
    retentionStart: { type: 'string', description: 'Retention analysis start date' },
    retentionEnd: { type: 'string', description: 'Retention analysis end date' },
    retentionGroupBy: { type: 'string', description: 'Retention group-by property' },
    retentionSegment: { type: 'string', description: 'Retention segment definition JSON' },
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
    payloadSizeBytes: {
      type: 'number',
      description: 'Size of the ingested payload in bytes (send_event)',
    },
    serverUploadTime: {
      type: 'number',
      description: 'Server-side upload timestamp (send_event)',
    },
    matches: {
      type: 'json',
      description: 'User search matches (amplitudeId, userId)',
    },
    type: {
      type: 'string',
      description: 'Match type, e.g. match_user_or_device_id (user_search)',
    },
    userId: {
      type: 'string',
      description: 'External user ID (user_profile)',
    },
    deviceId: {
      type: 'string',
      description: 'Device ID (user_profile)',
    },
    ampProps: {
      type: 'json',
      description:
        'Amplitude user properties (library, first_used, last_used, custom) (user_profile)',
    },
    cohortIds: {
      type: 'json',
      description: 'Cohort IDs the user belongs to (user_profile)',
    },
    computations: {
      type: 'json',
      description: 'Computed user properties (user_profile)',
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
      description:
        'Time-series data (segmentation, active_users, realtime: number[][]; revenue: [{dates, values}]; retention: [{dates, values, combined}])',
    },
    seriesLabels: {
      type: 'json',
      description: 'Labels for each data series (segmentation, realtime, revenue)',
    },
    seriesMeta: {
      type: 'json',
      description: 'Metadata labels for data series (active_users, retention)',
    },
    seriesCollapsed: {
      type: 'json',
      description: 'Collapsed aggregate totals per series (segmentation)',
    },
    xValues: {
      type: 'json',
      description: 'X-axis date/time values for chart data (segmentation, active_users, realtime)',
    },
    funnels: {
      type: 'json',
      description:
        'Funnel results per segment (stepByStep, cumulative, medianTransTimes, dayFunnels, etc.) (funnels)',
    },
  },
}

export const AmplitudeBlockMeta = {
  tags: ['data-analytics', 'marketing'],
  url: 'https://amplitude.com',
  templates: [
    {
      icon: AmplitudeIcon,
      title: 'Product analytics digest',
      prompt:
        'Create a scheduled weekly workflow that pulls key product metrics from Amplitude — active users, event segmentation for top events, and revenue — generates an executive summary with week-over-week trends, and posts it to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'reporting', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude event regression watcher',
      prompt:
        'Build a scheduled workflow that runs event segmentation on key Amplitude events every morning, compares the counts against the trailing 14-day baseline, and posts a Slack alert when any event drops more than a configurable threshold.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude active-user tracker',
      prompt:
        'Create a scheduled workflow that pulls daily and monthly active users from Amplitude, writes the values into a tracking table, and feeds the trend to downstream marketing automations.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'sync'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude revenue digest',
      prompt:
        'Build a scheduled weekly workflow that pulls Amplitude revenue data, breaks it down by week-over-week change, and posts a digest to the product Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude + PostHog cross-tool dashboard',
      prompt:
        'Build a scheduled workflow that aggregates equivalent active-user and event metrics from both Amplitude and PostHog, writes a side-by-side comparison to a table, and surfaces discrepancies to the product team in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis', 'reporting'],
      alsoIntegrations: ['posthog', 'slack'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude + Fathom unified analytics',
      prompt:
        'Build a scheduled workflow that joins Amplitude product analytics with Fathom web analytics, writes a unified active-user and engagement report, and surfaces anomalies.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['fathom'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude + Hex deep-dive notebook',
      prompt:
        'Create a workflow that triggers a Hex deep-dive notebook when an Amplitude metric crosses an anomaly threshold, runs analysis, and posts the notebook output to Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['hex', 'slack'],
    },
  ],
  skills: [
    {
      name: 'track-product-event',
      description:
        'Send a behavioral event to Amplitude with user and event properties for analytics.',
      content:
        '# Track Product Event\n\nLog a user action to Amplitude so it shows up in analytics.\n\n## Steps\n1. Determine the event name and the user identifier (user ID or device ID).\n2. Attach relevant event properties (plan, source, value) and user properties.\n3. Send the event to Amplitude.\n\n## Output\nConfirm the event was sent with its name and the user it was attributed to. Note any required field that was missing.',
    },
    {
      name: 'segment-event-counts',
      description:
        'Run Amplitude event segmentation over a date range and report unique and total counts, optionally grouped by a property.',
      content:
        '# Segment Event Counts\n\nMeasure how often an event fires in Amplitude over a time window.\n\n## Steps\n1. Identify the event type and the start and end dates (YYYYMMDD) to analyze.\n2. Pick the measurement (uniques, totals, or average) and the interval (daily, weekly, monthly).\n3. Optionally group by a user or event property to break the counts down by segment.\n4. Run the event segmentation query and read the resulting time series.\n\n## Output\nThe series of counts per interval, the segment breakdown if grouped, and a callout of the largest movement versus the start of the range.',
    },
    {
      name: 'summarize-engagement-metrics',
      description:
        'Pull Amplitude active users, top events, and revenue and summarize product engagement for a period.',
      content:
        '# Summarize Engagement Metrics\n\nProduce a short product engagement summary from Amplitude data.\n\n## Steps\n1. Query active and new users for the target period.\n2. Pull the most-triggered events with event segmentation to see what users do most.\n3. Pull revenue metrics for the same period.\n4. Compare each against the prior period to spot trends.\n\n## Output\nA concise summary: active users, top events, revenue, and notable trends versus the prior period.',
    },
    {
      name: 'lookup-user-activity',
      description:
        'Find a user in Amplitude by ID and pull their recent event activity and profile properties.',
      content:
        '# Lookup User Activity\n\nInvestigate a single user in Amplitude for support or debugging.\n\n## Steps\n1. Search for the user by user ID, device ID, or Amplitude ID to resolve their Amplitude ID.\n2. Pull the user activity stream for that Amplitude ID, ordered latest first.\n3. Optionally fetch the user profile to see their current properties.\n\n## Output\nA timeline of the user recent events plus key profile properties. Note the time range covered.',
    },
    {
      name: 'analyze-conversion-funnel',
      description:
        'Run an Amplitude funnel across a sequence of events to find conversion rates and drop-off points.',
      content:
        '# Analyze Conversion Funnel\n\nMeasure how users progress through a multi-step flow in Amplitude.\n\n## Steps\n1. Define the ordered sequence of events that make up the funnel (e.g., signup, activation, purchase).\n2. Pick the date range and, if useful, a property to group by.\n3. Run the funnel query and read the step-by-step and cumulative conversion numbers.\n\n## Output\nConversion counts and rates at each step, the biggest drop-off point, and any group-by breakdown.',
    },
  ],
} as const satisfies BlockMeta
