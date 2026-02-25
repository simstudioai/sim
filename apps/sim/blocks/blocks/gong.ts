import { GongIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { GongResponse } from '@/tools/gong/types'

export const GongBlock: BlockConfig<GongResponse> = {
  type: 'gong',
  name: 'Gong',
  description: 'Revenue intelligence and conversation analytics',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Gong into your workflow. Access call recordings, transcripts, user data, activity stats, scorecards, trackers, library content, coaching metrics, and more via the Gong API.',
  docsLink: 'https://docs.sim.ai/tools/gong',
  category: 'tools',
  bgColor: '#8039DF',
  icon: GongIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Calls', id: 'list_calls' },
        { label: 'Get Call', id: 'get_call' },
        { label: 'Get Call Transcript', id: 'get_call_transcript' },
        { label: 'Get Extensive Calls', id: 'get_extensive_calls' },
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Aggregate Activity', id: 'aggregate_activity' },
        { label: 'Interaction Stats', id: 'interaction_stats' },
        { label: 'Answered Scorecards', id: 'answered_scorecards' },
        { label: 'List Library Folders', id: 'list_library_folders' },
        { label: 'Get Folder Content', id: 'get_folder_content' },
        { label: 'List Scorecards', id: 'list_scorecards' },
        { label: 'List Trackers', id: 'list_trackers' },
        { label: 'List Workspaces', id: 'list_workspaces' },
        { label: 'List Flows', id: 'list_flows' },
        { label: 'Get Coaching', id: 'get_coaching' },
        { label: 'Lookup Email', id: 'lookup_email' },
        { label: 'Lookup Phone', id: 'lookup_phone' },
      ],
      value: () => 'list_calls',
    },

    // List Calls inputs
    {
      id: 'fromDateTime',
      title: 'From Date/Time',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      condition: {
        field: 'operation',
        value: ['list_calls'],
      },
      required: { field: 'operation', value: 'list_calls' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Today's date at 00:00:00Z
- "beginning of this week" -> Monday of the current week at 00:00:00Z
- "start of month" -> First day of current month at 00:00:00Z
- "last week" -> 7 days ago at 00:00:00Z

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "beginning of last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'toDateTime',
      title: 'To Date/Time',
      type: 'short-input',
      placeholder: '2024-01-31T23:59:59Z',
      condition: {
        field: 'operation',
        value: ['list_calls'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "now" -> Current date and time in UTC
- "end of this week" -> Sunday of the current week at 23:59:59Z
- "end of month" -> Last day of current month at 23:59:59Z
- "yesterday" -> Yesterday at 23:59:59Z

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "end of last month")...',
        generationType: 'timestamp',
      },
    },

    // Get Call inputs
    {
      id: 'callId',
      title: 'Call ID',
      type: 'short-input',
      placeholder: 'Enter the Gong call ID',
      condition: { field: 'operation', value: 'get_call' },
      required: { field: 'operation', value: 'get_call' },
    },

    // Get Call Transcript / Get Extensive Calls inputs
    {
      id: 'callIds',
      title: 'Call IDs',
      type: 'short-input',
      placeholder: 'Comma-separated call IDs (optional)',
      condition: { field: 'operation', value: ['get_call_transcript', 'get_extensive_calls'] },
    },
    {
      id: 'transcriptFromDateTime',
      title: 'From Date/Time',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z (optional)',
      condition: { field: 'operation', value: ['get_call_transcript', 'get_extensive_calls'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Today's date at 00:00:00Z
- "beginning of this week" -> Monday of the current week at 00:00:00Z
- "start of month" -> First day of current month at 00:00:00Z

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "start of last week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'transcriptToDateTime',
      title: 'To Date/Time',
      type: 'short-input',
      placeholder: '2024-01-31T23:59:59Z (optional)',
      condition: { field: 'operation', value: ['get_call_transcript', 'get_extensive_calls'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "now" -> Current date and time in UTC
- "end of this week" -> Sunday of the current week at 23:59:59Z
- "end of month" -> Last day of current month at 23:59:59Z

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "end of last week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'primaryUserIds',
      title: 'Primary User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs (optional)',
      condition: { field: 'operation', value: 'get_extensive_calls' },
      mode: 'advanced',
    },

    // List Users inputs
    {
      id: 'includeAvatars',
      title: 'Include Avatars',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_users' },
      mode: 'advanced',
    },

    // Get User inputs
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter the Gong user ID',
      condition: { field: 'operation', value: 'get_user' },
      required: { field: 'operation', value: 'get_user' },
    },

    // Aggregate Activity & Interaction Stats inputs
    {
      id: 'statsFromDate',
      title: 'From Date',
      type: 'short-input',
      placeholder: '2024-01-01 (YYYY-MM-DD, inclusive)',
      condition: { field: 'operation', value: ['aggregate_activity', 'interaction_stats'] },
      required: { field: 'operation', value: ['aggregate_activity', 'interaction_stats'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date string in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Today's date
- "beginning of this month" -> First day of current month
- "start of last quarter" -> First day of the previous quarter
- "30 days ago" -> Date 30 days in the past

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "beginning of last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'statsToDate',
      title: 'To Date',
      type: 'short-input',
      placeholder: '2024-01-31 (YYYY-MM-DD, exclusive)',
      condition: { field: 'operation', value: ['aggregate_activity', 'interaction_stats'] },
      required: { field: 'operation', value: ['aggregate_activity', 'interaction_stats'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date string in YYYY-MM-DD format based on the user's description.
The date is exclusive (results up to but not including this date).
Examples:
- "today" -> Today's date
- "end of this month" -> First day of next month
- "end of last quarter" -> First day of current quarter

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "end of last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'userIds',
      title: 'User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs (optional)',
      condition: { field: 'operation', value: ['aggregate_activity', 'interaction_stats'] },
      mode: 'advanced',
    },

    // Answered Scorecards inputs
    {
      id: 'callFromDate',
      title: 'Call From Date',
      type: 'short-input',
      placeholder: '2024-01-01 (YYYY-MM-DD, optional)',
      condition: { field: 'operation', value: 'answered_scorecards' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date string in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Today's date
- "beginning of this month" -> First day of current month
- "start of last quarter" -> First day of the previous quarter

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the call start date...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'callToDate',
      title: 'Call To Date',
      type: 'short-input',
      placeholder: '2024-01-31 (YYYY-MM-DD, optional)',
      condition: { field: 'operation', value: 'answered_scorecards' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date string in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Today's date
- "end of this month" -> First day of next month

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the call end date...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'reviewFromDate',
      title: 'Review From Date',
      type: 'short-input',
      placeholder: '2024-01-01 (YYYY-MM-DD, optional)',
      condition: { field: 'operation', value: 'answered_scorecards' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a date string in YYYY-MM-DD format based on the user's description.
Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the review start date...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'reviewToDate',
      title: 'Review To Date',
      type: 'short-input',
      placeholder: '2024-01-31 (YYYY-MM-DD, optional)',
      condition: { field: 'operation', value: 'answered_scorecards' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a date string in YYYY-MM-DD format based on the user's description.
Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the review end date...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'scorecardIds',
      title: 'Scorecard IDs',
      type: 'short-input',
      placeholder: 'Comma-separated scorecard IDs (optional)',
      condition: { field: 'operation', value: 'answered_scorecards' },
      mode: 'advanced',
    },
    {
      id: 'reviewedUserIds',
      title: 'Reviewed User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs (optional)',
      condition: { field: 'operation', value: 'answered_scorecards' },
      mode: 'advanced',
    },

    // Get Folder Content inputs
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'Enter the library folder ID',
      condition: { field: 'operation', value: 'get_folder_content' },
      required: { field: 'operation', value: 'get_folder_content' },
    },

    // Workspace ID (shared by multiple operations)
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Gong workspace ID (optional)',
      condition: {
        field: 'operation',
        value: [
          'list_calls',
          'get_call_transcript',
          'get_extensive_calls',
          'list_library_folders',
          'list_flows',
          'list_trackers',
        ],
      },
      mode: 'advanced',
    },

    // List Flows inputs
    {
      id: 'flowOwnerEmail',
      title: 'Flow Owner Email',
      type: 'short-input',
      placeholder: 'user@example.com',
      condition: { field: 'operation', value: 'list_flows' },
      required: { field: 'operation', value: 'list_flows' },
    },

    // Get Coaching inputs
    {
      id: 'managerId',
      title: 'Manager ID',
      type: 'short-input',
      placeholder: 'Manager user ID',
      condition: { field: 'operation', value: 'get_coaching' },
      required: { field: 'operation', value: 'get_coaching' },
    },
    {
      id: 'coachingWorkspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Gong workspace ID',
      condition: { field: 'operation', value: 'get_coaching' },
      required: { field: 'operation', value: 'get_coaching' },
    },
    {
      id: 'coachingFromDate',
      title: 'From Date',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'get_coaching' },
      required: { field: 'operation', value: 'get_coaching' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Today's date at 00:00:00Z
- "beginning of this month" -> First day of current month at 00:00:00Z
- "start of last quarter" -> First day of the previous quarter at 00:00:00Z

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "beginning of last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'coachingToDate',
      title: 'To Date',
      type: 'short-input',
      placeholder: '2024-01-31T23:59:59Z',
      condition: { field: 'operation', value: 'get_coaching' },
      required: { field: 'operation', value: 'get_coaching' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "now" -> Current date and time in UTC
- "end of this month" -> Last day of current month at 23:59:59Z
- "end of last quarter" -> Last day of the previous quarter at 23:59:59Z

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "end of last month")...',
        generationType: 'timestamp',
      },
    },

    // Lookup Email inputs
    {
      id: 'emailAddress',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'user@example.com',
      condition: { field: 'operation', value: 'lookup_email' },
      required: { field: 'operation', value: 'lookup_email' },
    },

    // Lookup Phone inputs
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+1234567890',
      condition: { field: 'operation', value: 'lookup_phone' },
      required: { field: 'operation', value: 'lookup_phone' },
    },

    // Pagination cursor (shared)
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor (optional)',
      condition: {
        field: 'operation',
        value: [
          'list_calls',
          'get_call_transcript',
          'get_extensive_calls',
          'list_users',
          'aggregate_activity',
          'interaction_stats',
          'answered_scorecards',
          'list_flows',
        ],
      },
      mode: 'advanced',
    },

    // API credentials
    {
      id: 'accessKey',
      title: 'Access Key',
      type: 'short-input',
      placeholder: 'Enter your Gong API access key',
      password: true,
      required: true,
    },
    {
      id: 'accessKeySecret',
      title: 'Access Key Secret',
      type: 'short-input',
      placeholder: 'Enter your Gong API access key secret',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'gong_list_calls',
      'gong_get_call',
      'gong_get_call_transcript',
      'gong_get_extensive_calls',
      'gong_list_users',
      'gong_get_user',
      'gong_aggregate_activity',
      'gong_interaction_stats',
      'gong_answered_scorecards',
      'gong_list_library_folders',
      'gong_get_folder_content',
      'gong_list_scorecards',
      'gong_list_trackers',
      'gong_list_workspaces',
      'gong_list_flows',
      'gong_get_coaching',
      'gong_lookup_email',
      'gong_lookup_phone',
    ],
    config: {
      tool: (params) => `gong_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        // Map operation-specific subBlock IDs to tool param names
        if (params.transcriptFromDateTime) result.fromDateTime = params.transcriptFromDateTime
        if (params.transcriptToDateTime) result.toDateTime = params.transcriptToDateTime
        if (params.statsFromDate) result.fromDate = params.statsFromDate
        if (params.statsToDate) result.toDate = params.statsToDate
        if (params.callFromDate) result.callFromDate = params.callFromDate
        if (params.callToDate) result.callToDate = params.callToDate
        if (params.reviewFromDate) result.reviewFromDate = params.reviewFromDate
        if (params.reviewToDate) result.reviewToDate = params.reviewToDate
        if (params.coachingWorkspaceId) result.workspaceId = params.coachingWorkspaceId
        if (params.coachingFromDate) result.fromDate = params.coachingFromDate
        if (params.coachingToDate) result.toDate = params.coachingToDate
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    accessKey: { type: 'string', description: 'Gong API Access Key' },
    accessKeySecret: { type: 'string', description: 'Gong API Access Key Secret' },
    fromDateTime: {
      type: 'string',
      description: 'Start date/time in ISO-8601 format (list calls)',
    },
    toDateTime: { type: 'string', description: 'End date/time in ISO-8601 format (list calls)' },
    callId: { type: 'string', description: 'Gong call ID' },
    callIds: { type: 'string', description: 'Comma-separated call IDs' },
    userId: { type: 'string', description: 'Gong user ID' },
    userIds: { type: 'string', description: 'Comma-separated user IDs' },
    statsFromDate: { type: 'string', description: 'Start date in YYYY-MM-DD format (stats)' },
    statsToDate: { type: 'string', description: 'End date in YYYY-MM-DD format (stats)' },
    callFromDate: { type: 'string', description: 'Call start date in YYYY-MM-DD (scorecards)' },
    callToDate: { type: 'string', description: 'Call end date in YYYY-MM-DD (scorecards)' },
    reviewFromDate: { type: 'string', description: 'Review start date in YYYY-MM-DD (scorecards)' },
    reviewToDate: { type: 'string', description: 'Review end date in YYYY-MM-DD (scorecards)' },
    scorecardIds: { type: 'string', description: 'Comma-separated scorecard IDs' },
    reviewedUserIds: { type: 'string', description: 'Comma-separated reviewed user IDs' },
    primaryUserIds: {
      type: 'string',
      description: 'Comma-separated primary user IDs (extensive calls)',
    },
    folderId: { type: 'string', description: 'Library folder ID' },
    workspaceId: { type: 'string', description: 'Gong workspace ID' },
    managerId: { type: 'string', description: 'Manager user ID for coaching' },
    flowOwnerEmail: {
      type: 'string',
      description: 'Email of a Gong user to retrieve personal and company flows',
    },
    emailAddress: { type: 'string', description: 'Email address to look up' },
    phoneNumber: { type: 'string', description: 'Phone number to look up' },
    cursor: { type: 'string', description: 'Pagination cursor' },
  },
  outputs: {
    response: {
      type: 'json',
      description: 'Gong API response data',
    },
  },
}
