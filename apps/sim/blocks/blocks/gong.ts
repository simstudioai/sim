import { GongIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { GongResponse } from '@/tools/gong/types'
import { getTrigger } from '@/triggers'

export const GongBlock: BlockConfig<GongResponse> = {
  type: 'gong',
  name: 'Gong',
  description: 'Revenue intelligence and conversation analytics',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Gong into your workflow. Access call recordings, transcripts, user data, activity stats, scorecards, trackers, library content, coaching metrics, and more via the Gong API.',
  docsLink: 'https://docs.sim.ai/integrations/gong',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#8039DF',
  iconColor: '#8039DF',
  icon: GongIcon,
  triggerAllowed: true,
  subBlocks: [
    ...getTrigger('gong_webhook').subBlocks,
    ...getTrigger('gong_call_completed').subBlocks,
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Calls', id: 'list_calls' },
        { label: 'Create Call', id: 'create_call' },
        { label: 'Get Call', id: 'get_call' },
        { label: 'Get Call Transcript', id: 'get_call_transcript' },
        { label: 'Get Extensive Calls', id: 'get_extensive_calls' },
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Aggregate Activity', id: 'aggregate_activity' },
        { label: 'Day-by-Day Activity', id: 'day_by_day_activity' },
        { label: 'Aggregate by Period', id: 'aggregate_by_period' },
        { label: 'Interaction Stats', id: 'interaction_stats' },
        { label: 'Answered Scorecards', id: 'answered_scorecards' },
        { label: 'List Library Folders', id: 'list_library_folders' },
        { label: 'Get Folder Content', id: 'get_folder_content' },
        { label: 'List Scorecards', id: 'list_scorecards' },
        { label: 'List Trackers', id: 'list_trackers' },
        { label: 'List Workspaces', id: 'list_workspaces' },
        { label: 'List Flows', id: 'list_flows' },
        { label: 'Assign Flow Prospects', id: 'assign_flow_prospects' },
        { label: 'Unassign Flow Prospects', id: 'unassign_flow_prospects' },
        { label: 'Get Prospect Flows', id: 'get_prospect_flows' },
        { label: 'Get Coaching', id: 'get_coaching' },
        { label: 'Ask Anything', id: 'ask_anything' },
        { label: 'Get Brief', id: 'get_brief' },
        { label: 'Get Logs', id: 'get_logs' },
        { label: 'Lookup Email', id: 'lookup_email' },
        { label: 'Lookup Phone', id: 'lookup_phone' },
        { label: 'Purge Email Address', id: 'purge_email_address' },
        { label: 'Purge Phone Number', id: 'purge_phone_number' },
      ],
      value: () => 'list_calls',
    },

    // Create Call inputs
    {
      id: 'clientUniqueId',
      title: 'Client Unique ID',
      type: 'short-input',
      placeholder: 'Unique call ID from your source system',
      condition: { field: 'operation', value: 'create_call' },
      required: { field: 'operation', value: 'create_call' },
    },
    {
      id: 'actualStart',
      title: 'Actual Start',
      type: 'short-input',
      placeholder: '2018-02-17T02:30:00-08:00',
      condition: { field: 'operation', value: 'create_call' },
      required: { field: 'operation', value: 'create_call' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone) or include a timezone offset.

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the call start time...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'primaryUser',
      title: 'Primary User ID',
      type: 'short-input',
      placeholder: 'Gong user ID for the call host',
      condition: { field: 'operation', value: 'create_call' },
      required: { field: 'operation', value: 'create_call' },
    },
    {
      id: 'parties',
      title: 'Parties',
      type: 'long-input',
      placeholder: '[{"userId":"65192578128262669"}]',
      condition: { field: 'operation', value: 'create_call' },
      required: { field: 'operation', value: 'create_call' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Gong call parties.
Include the primary Gong user as an object with userId when provided. Parties can include name, phoneNumber, emailAddress, userId, mediaChannelId, and context.

Return ONLY the JSON array - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the call participants...',
      },
    },
    {
      id: 'direction',
      title: 'Direction',
      type: 'dropdown',
      options: [
        { label: 'Inbound', id: 'Inbound' },
        { label: 'Outbound', id: 'Outbound' },
        { label: 'Conference', id: 'Conference' },
        { label: 'Unknown', id: 'Unknown' },
      ],
      value: () => 'Inbound',
      condition: { field: 'operation', value: 'create_call' },
      required: { field: 'operation', value: 'create_call' },
    },
    {
      id: 'downloadMediaUrl',
      title: 'Download Media URL',
      type: 'short-input',
      placeholder: 'https://example.com/call-recording.mp3',
      condition: { field: 'operation', value: 'create_call' },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Discovery call with ACME',
      condition: { field: 'operation', value: 'create_call' },
    },
    {
      id: 'disposition',
      title: 'Disposition',
      type: 'short-input',
      placeholder: 'Connected',
      condition: { field: 'operation', value: 'create_call' },
      mode: 'advanced',
    },
    {
      id: 'purpose',
      title: 'Purpose',
      type: 'short-input',
      placeholder: 'Demo Call',
      condition: { field: 'operation', value: 'create_call' },
      mode: 'advanced',
    },
    {
      id: 'context',
      title: 'Context',
      type: 'long-input',
      placeholder:
        '[{"system":"Salesforce","objects":[{"objectType":"Opportunity","objectId":"006..."}]}]',
      condition: { field: 'operation', value: 'create_call' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Gong CRM context objects for the call.
Use objects with system and objects fields when external CRM records are provided.

Return ONLY the JSON array - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe CRM records to associate...',
      },
    },
    {
      id: 'callProviderCode',
      title: 'Call Provider Code',
      type: 'short-input',
      placeholder: 'zoom',
      condition: { field: 'operation', value: 'create_call' },
      mode: 'advanced',
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Gong call IDs based on the user's description.
Return ONLY the comma-separated list of IDs - no explanations, no extra text.`,
        placeholder: 'Describe the call IDs (e.g., "calls 123456 and 789012")...',
      },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Gong user IDs based on the user's description.
Return ONLY the comma-separated list of IDs - no explanations, no extra text.`,
        placeholder: 'Describe the user IDs...',
      },
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
      condition: {
        field: 'operation',
        value: [
          'aggregate_activity',
          'day_by_day_activity',
          'aggregate_by_period',
          'interaction_stats',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'aggregate_activity',
          'day_by_day_activity',
          'aggregate_by_period',
          'interaction_stats',
        ],
      },
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
      condition: {
        field: 'operation',
        value: [
          'aggregate_activity',
          'day_by_day_activity',
          'aggregate_by_period',
          'interaction_stats',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'aggregate_activity',
          'day_by_day_activity',
          'aggregate_by_period',
          'interaction_stats',
        ],
      },
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
      condition: {
        field: 'operation',
        value: [
          'aggregate_activity',
          'day_by_day_activity',
          'aggregate_by_period',
          'interaction_stats',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Gong user IDs based on the user's description.
Return ONLY the comma-separated list of IDs - no explanations, no extra text.`,
        placeholder: 'Describe the user IDs...',
      },
    },

    // Aggregate by Period inputs
    {
      id: 'aggregationPeriod',
      title: 'Aggregation Period',
      type: 'dropdown',
      options: [
        { label: 'Day', id: 'DAY' },
        { label: 'Week', id: 'WEEK' },
        { label: 'Month', id: 'MONTH' },
        { label: 'Quarter', id: 'QUARTER' },
        { label: 'Year', id: 'YEAR' },
      ],
      value: () => 'WEEK',
      condition: { field: 'operation', value: 'aggregate_by_period' },
      required: { field: 'operation', value: 'aggregate_by_period' },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Gong scorecard IDs based on the user's description.
Return ONLY the comma-separated list of IDs - no explanations, no extra text.`,
        placeholder: 'Describe the scorecard IDs...',
      },
    },
    {
      id: 'reviewedUserIds',
      title: 'Reviewed User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs (optional)',
      condition: { field: 'operation', value: 'answered_scorecards' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Gong user IDs based on the user's description.
Return ONLY the comma-separated list of IDs - no explanations, no extra text.`,
        placeholder: 'Describe the reviewed user IDs...',
      },
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
          'create_call',
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

    // Assign Flow Prospects / Get Prospect Flows inputs
    {
      id: 'flowId',
      title: 'Flow ID',
      type: 'short-input',
      placeholder: 'Enter the Gong Engage flow ID',
      condition: {
        field: 'operation',
        value: ['assign_flow_prospects', 'unassign_flow_prospects'],
      },
      required: { field: 'operation', value: 'assign_flow_prospects' },
    },
    {
      id: 'crmProspectId',
      title: 'CRM Prospect ID',
      type: 'short-input',
      placeholder: 'CRM contact or lead ID to unassign',
      condition: { field: 'operation', value: 'unassign_flow_prospects' },
      required: { field: 'operation', value: 'unassign_flow_prospects' },
    },
    {
      id: 'unassignedByUserEmail',
      title: 'Unassigned By User Email',
      type: 'short-input',
      placeholder: 'user@example.com (optional)',
      condition: { field: 'operation', value: 'unassign_flow_prospects' },
      mode: 'advanced',
    },
    {
      id: 'crmProspectsIds',
      title: 'CRM Prospect IDs',
      type: 'short-input',
      placeholder: 'Comma-separated CRM contact or lead IDs',
      condition: { field: 'operation', value: ['assign_flow_prospects', 'get_prospect_flows'] },
      required: { field: 'operation', value: ['assign_flow_prospects', 'get_prospect_flows'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of CRM prospect IDs based on the user's description.
Return ONLY the comma-separated list of IDs - no explanations, no extra text.`,
        placeholder: 'Describe the CRM prospect IDs...',
      },
    },
    {
      id: 'flowInstanceOwnerEmail',
      title: 'Flow Instance Owner Email',
      type: 'short-input',
      placeholder: 'user@example.com',
      condition: { field: 'operation', value: 'assign_flow_prospects' },
      required: { field: 'operation', value: 'assign_flow_prospects' },
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

    // Ask Anything / Get Brief inputs
    {
      id: 'entityWorkspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Gong workspace ID',
      condition: { field: 'operation', value: ['ask_anything', 'get_brief'] },
      required: { field: 'operation', value: ['ask_anything', 'get_brief'] },
    },
    {
      id: 'crmEntityType',
      title: 'CRM Entity Type',
      type: 'dropdown',
      options: [
        { label: 'Account', id: 'ACCOUNT' },
        { label: 'Contact', id: 'CONTACT' },
        { label: 'Deal', id: 'DEAL' },
        { label: 'Lead', id: 'LEAD' },
      ],
      value: () => 'ACCOUNT',
      condition: { field: 'operation', value: ['ask_anything', 'get_brief'] },
      required: { field: 'operation', value: ['ask_anything', 'get_brief'] },
    },
    {
      id: 'crmEntityId',
      title: 'CRM Entity ID',
      type: 'short-input',
      placeholder: 'CRM ID of the account, contact, deal, or lead',
      condition: { field: 'operation', value: ['ask_anything', 'get_brief'] },
      required: { field: 'operation', value: ['ask_anything', 'get_brief'] },
    },
    {
      id: 'question',
      title: 'Question',
      type: 'long-input',
      placeholder: 'What are the main objections raised by this account?',
      condition: { field: 'operation', value: 'ask_anything' },
      required: { field: 'operation', value: 'ask_anything' },
    },
    {
      id: 'briefName',
      title: 'Brief Name',
      type: 'short-input',
      placeholder: 'Brief name configured in Gong Agent Studio',
      condition: { field: 'operation', value: 'get_brief' },
      required: { field: 'operation', value: 'get_brief' },
    },
    {
      id: 'timePeriod',
      title: 'Time Period',
      type: 'dropdown',
      options: [
        { label: 'Last 7 days', id: 'LAST_7DAYS' },
        { label: 'Last 30 days', id: 'LAST_30DAYS' },
        { label: 'Last 90 days', id: 'LAST_90DAYS' },
        { label: 'Last 90 days since last activity', id: 'LAST_90_DAYS_SINCE_LAST_ACTIVITY' },
        { label: 'Last year since last activity', id: 'LAST_YEAR_SINCE_LAST_ACTIVITY' },
        { label: 'Last year', id: 'LAST_YEAR' },
        { label: 'This week', id: 'THIS_WEEK' },
        { label: 'This month', id: 'THIS_MONTH' },
        { label: 'This quarter', id: 'THIS_QUARTER' },
        { label: 'This year', id: 'THIS_YEAR' },
        { label: 'Custom range', id: 'CUSTOM_RANGE' },
        { label: 'All conversations', id: 'ALL_CONVERSATIONS' },
      ],
      value: () => 'LAST_30DAYS',
      condition: { field: 'operation', value: ['ask_anything', 'get_brief'] },
      required: { field: 'operation', value: ['ask_anything', 'get_brief'] },
    },
    {
      id: 'entityFromDateTime',
      title: 'From Date/Time',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      condition: {
        field: 'operation',
        value: ['ask_anything', 'get_brief'],
        and: { field: 'timePeriod', value: 'CUSTOM_RANGE' },
      },
      required: {
        field: 'operation',
        value: ['ask_anything', 'get_brief'],
        and: { field: 'timePeriod', value: 'CUSTOM_RANGE' },
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "beginning of last quarter")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'entityToDateTime',
      title: 'To Date/Time',
      type: 'short-input',
      placeholder: '2024-01-31T23:59:59Z',
      condition: {
        field: 'operation',
        value: ['ask_anything', 'get_brief'],
        and: { field: 'timePeriod', value: 'CUSTOM_RANGE' },
      },
      required: {
        field: 'operation',
        value: ['ask_anything', 'get_brief'],
        and: { field: 'timePeriod', value: 'CUSTOM_RANGE' },
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "end of last quarter")...',
        generationType: 'timestamp',
      },
    },

    // Get Logs inputs
    {
      id: 'logType',
      title: 'Log Type',
      type: 'short-input',
      placeholder: 'Type of logs to retrieve',
      condition: { field: 'operation', value: 'get_logs' },
      required: { field: 'operation', value: 'get_logs' },
    },
    {
      id: 'logsFromDateTime',
      title: 'From Date/Time',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'get_logs' },
      required: { field: 'operation', value: 'get_logs' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "beginning of this week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'logsToDateTime',
      title: 'To Date/Time',
      type: 'short-input',
      placeholder: '2024-01-31T23:59:59Z (optional)',
      condition: { field: 'operation', value: 'get_logs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "now")...',
        generationType: 'timestamp',
      },
    },

    // Lookup Email / Purge Email Address inputs
    {
      id: 'emailAddress',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'user@example.com',
      condition: { field: 'operation', value: ['lookup_email', 'purge_email_address'] },
      required: { field: 'operation', value: ['lookup_email', 'purge_email_address'] },
    },

    // Lookup Phone / Purge Phone Number inputs
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+1234567890',
      condition: { field: 'operation', value: ['lookup_phone', 'purge_phone_number'] },
      required: { field: 'operation', value: ['lookup_phone', 'purge_phone_number'] },
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
          'day_by_day_activity',
          'aggregate_by_period',
          'interaction_stats',
          'answered_scorecards',
          'list_flows',
          'get_logs',
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
      'gong_create_call',
      'gong_get_call',
      'gong_get_call_transcript',
      'gong_get_extensive_calls',
      'gong_list_users',
      'gong_get_user',
      'gong_aggregate_activity',
      'gong_day_by_day_activity',
      'gong_aggregate_by_period',
      'gong_interaction_stats',
      'gong_answered_scorecards',
      'gong_list_library_folders',
      'gong_get_folder_content',
      'gong_list_scorecards',
      'gong_list_trackers',
      'gong_list_workspaces',
      'gong_list_flows',
      'gong_assign_flow_prospects',
      'gong_unassign_flow_prospects',
      'gong_get_prospect_flows',
      'gong_get_coaching',
      'gong_ask_anything',
      'gong_get_brief',
      'gong_get_logs',
      'gong_lookup_email',
      'gong_lookup_phone',
      'gong_purge_email_address',
      'gong_purge_phone_number',
    ],
    config: {
      tool: (params) => `gong_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        // Map operation-specific subBlock IDs to tool param names, gated by the
        // selected operation so stale values from other operations never leak in
        const operation = params.operation as string
        if (operation === 'get_call_transcript' || operation === 'get_extensive_calls') {
          if (params.transcriptFromDateTime) result.fromDateTime = params.transcriptFromDateTime
          if (params.transcriptToDateTime) result.toDateTime = params.transcriptToDateTime
        }
        if (
          [
            'aggregate_activity',
            'day_by_day_activity',
            'aggregate_by_period',
            'interaction_stats',
          ].includes(operation)
        ) {
          if (params.statsFromDate) result.fromDate = params.statsFromDate
          if (params.statsToDate) result.toDate = params.statsToDate
        }
        if (operation === 'get_coaching') {
          if (params.coachingWorkspaceId) result.workspaceId = params.coachingWorkspaceId
          if (params.coachingFromDate) result.fromDate = params.coachingFromDate
          if (params.coachingToDate) result.toDate = params.coachingToDate
        }
        if (operation === 'ask_anything' || operation === 'get_brief') {
          if (params.entityWorkspaceId) result.workspaceId = params.entityWorkspaceId
          if (params.entityFromDateTime) result.fromDateTime = params.entityFromDateTime
          if (params.entityToDateTime) result.toDateTime = params.entityToDateTime
        }
        if (operation === 'get_logs') {
          if (params.logsFromDateTime) result.fromDateTime = params.logsFromDateTime
          if (params.logsToDateTime) result.toDateTime = params.logsToDateTime
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    accessKey: { type: 'string', description: 'Gong API Access Key' },
    accessKeySecret: { type: 'string', description: 'Gong API Access Key Secret' },
    clientUniqueId: { type: 'string', description: 'Unique source-system call ID' },
    actualStart: { type: 'string', description: 'Actual call start date/time' },
    primaryUser: { type: 'string', description: 'Gong user ID for the call host' },
    parties: { type: 'json', description: 'Call party array' },
    direction: { type: 'string', description: 'Call direction' },
    downloadMediaUrl: { type: 'string', description: 'URL where Gong can download call media' },
    title: { type: 'string', description: 'Call title' },
    disposition: { type: 'string', description: 'Call disposition' },
    purpose: { type: 'string', description: 'Call purpose' },
    context: { type: 'json', description: 'Call CRM context array' },
    callProviderCode: { type: 'string', description: 'Provider conferencing or telephony code' },
    fromDateTime: {
      type: 'string',
      description: 'Start date/time in ISO-8601 format (list calls)',
    },
    toDateTime: { type: 'string', description: 'End date/time in ISO-8601 format (list calls)' },
    callId: { type: 'string', description: 'Gong call ID' },
    callIds: { type: 'string', description: 'Comma-separated call IDs' },
    userId: { type: 'string', description: 'Gong user ID' },
    userIds: { type: 'string', description: 'Comma-separated user IDs' },
    aggregationPeriod: {
      type: 'string',
      description: 'Calendar period for aggregate-by-period (DAY/WEEK/MONTH/QUARTER/YEAR)',
    },
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
    flowId: { type: 'string', description: 'Gong Engage flow ID' },
    crmProspectsIds: { type: 'string', description: 'Comma-separated CRM prospect IDs' },
    crmProspectId: { type: 'string', description: 'Single CRM prospect ID to unassign' },
    unassignedByUserEmail: {
      type: 'string',
      description: 'Email of the Gong user requesting the unassignment',
    },
    crmEntityType: {
      type: 'string',
      description: 'CRM entity type (ACCOUNT, CONTACT, DEAL, or LEAD)',
    },
    crmEntityId: { type: 'string', description: 'CRM ID of the entity' },
    question: { type: 'string', description: 'Natural-language question to ask about the entity' },
    briefName: { type: 'string', description: 'Name of the brief configured in Gong Agent Studio' },
    timePeriod: {
      type: 'string',
      description: 'Time period of conversations to consider (e.g. LAST_30DAYS, CUSTOM_RANGE)',
    },
    logType: { type: 'string', description: 'Type of Gong logs to retrieve' },
    flowInstanceOwnerEmail: {
      type: 'string',
      description: 'Email of the Gong user who owns the flow instance and its to-dos',
    },
    emailAddress: {
      type: 'string',
      description: 'Email address to look up or purge',
    },
    phoneNumber: {
      type: 'string',
      description: 'Phone number to look up or purge',
    },
    cursor: { type: 'string', description: 'Pagination cursor' },
  },
  outputs: {
    // Shared across most operations
    requestId: { type: 'string', description: 'Gong request reference ID for troubleshooting' },
    cursor: { type: 'string', description: 'Pagination cursor for the next page' },
    totalRecords: { type: 'number', description: 'Total number of records matching the filter' },
    currentPageSize: { type: 'number', description: 'Number of records in the current page' },
    currentPageNumber: { type: 'number', description: 'Current page number' },

    // list_calls / get_extensive_calls / get_folder_content / lookup_email / lookup_phone
    calls: {
      type: 'json',
      description:
        'Calls returned by the operation (shape varies: call list, extensive calls, folder calls, or call references)',
    },

    // create_call / get_call
    callId: { type: 'string', description: 'Gong call ID of the created call' },
    url: { type: 'string', description: 'URL to the call in the Gong web app' },
    id: { type: 'string', description: 'Gong ID of the returned call or user' },
    title: { type: 'string', description: 'Call title' },
    scheduled: { type: 'string', description: 'Scheduled call time (ISO-8601)' },
    started: { type: 'string', description: 'Recording start time (ISO-8601)' },
    duration: { type: 'number', description: 'Call duration in seconds' },
    direction: { type: 'string', description: 'Call direction (Inbound/Outbound)' },
    system: { type: 'string', description: 'Communication platform used' },
    scope: { type: 'string', description: "Call scope: 'Internal', 'External', or 'Unknown'" },
    media: { type: 'string', description: 'Media type (e.g., Video)' },
    language: { type: 'string', description: 'Language code (ISO-639-2B)' },
    primaryUserId: { type: 'string', description: 'Host team member identifier' },
    workspaceId: { type: 'string', description: 'Workspace identifier' },
    sdrDisposition: { type: 'string', description: 'SDR disposition classification' },
    clientUniqueId: {
      type: 'string',
      description: 'Call identifier from the origin recording system',
    },
    customData: { type: 'string', description: 'Metadata provided during call creation' },
    purpose: { type: 'string', description: 'Call purpose' },
    meetingUrl: { type: 'string', description: 'Web conference provider URL' },
    isPrivate: { type: 'boolean', description: 'Whether the call is private' },
    calendarEventId: { type: 'string', description: 'Calendar event identifier' },

    // get_call_transcript
    callTranscripts: {
      type: 'json',
      description:
        'Call transcripts: [{callId, transcript: [{speakerId, topic, sentences: [{start, end, text}]}]}]',
    },

    // list_users / get_user
    users: { type: 'json', description: 'List of Gong users with profile and settings fields' },
    emailAddress: { type: 'string', description: 'User email address' },
    created: { type: 'string', description: 'User creation timestamp (ISO-8601)' },
    active: { type: 'boolean', description: 'Whether the user is active' },
    emailAliases: { type: 'json', description: "User's alternative email addresses" },
    trustedEmailAddress: { type: 'string', description: 'Trusted email address for the user' },
    firstName: { type: 'string', description: 'User first name' },
    lastName: { type: 'string', description: 'User last name' },
    phoneNumber: { type: 'string', description: 'User phone number' },
    extension: { type: 'string', description: 'Phone extension number' },
    personalMeetingUrls: { type: 'json', description: 'Personal meeting URLs' },
    settings: { type: 'json', description: 'User settings (recording, import, and consent flags)' },
    managerId: { type: 'string', description: 'Manager user ID' },
    meetingConsentPageUrl: { type: 'string', description: 'Meeting consent page URL' },
    spokenLanguages: { type: 'json', description: 'Languages spoken: [{language, primary}]' },

    // aggregate_activity / interaction_stats / day_by_day_activity / aggregate_by_period
    usersActivity: { type: 'json', description: 'Aggregated activity stats per user' },
    usersDetailedActivities: {
      type: 'json',
      description: 'Day-by-day activity per user: call IDs grouped by activity type per day',
    },
    usersAggregateActivity: {
      type: 'json',
      description: 'Aggregated activity per user grouped into time periods (with fromDate/toDate)',
    },
    peopleInteractionStats: {
      type: 'json',
      description:
        'Interaction stats per user: [{userId, userEmailAddress, personInteractionStats: [{name, value}]}]',
    },
    timeZone: { type: 'string', description: "The company's defined timezone in Gong" },
    fromDateTime: { type: 'string', description: 'Start of results (ISO-8601)' },
    toDateTime: { type: 'string', description: 'End of results (ISO-8601)' },

    // answered_scorecards
    answeredScorecards: {
      type: 'json',
      description: 'Answered scorecards with scores and answers',
    },

    // list_library_folders / get_folder_content
    folders: {
      type: 'json',
      description: 'Library folders: [{id, name, parentFolderId, createdBy, updated}]',
    },
    folderId: { type: 'string', description: 'Library folder ID' },
    folderName: { type: 'string', description: 'Library folder display name' },
    createdBy: { type: 'string', description: 'User ID who created the folder' },
    updated: { type: 'string', description: "Folder's last update time (ISO-8601)" },

    // list_scorecards
    scorecards: { type: 'json', description: 'Scorecard definitions with questions' },

    // list_trackers
    trackers: { type: 'json', description: 'Keyword/smart tracker definitions' },

    // list_workspaces
    workspaces: { type: 'json', description: 'Gong workspaces: [{id, name, description}]' },

    // list_flows
    flows: {
      type: 'json',
      description:
        'Gong Engage flows: [{id, name, folderId, folderName, visibility, creationDate, exclusive}]',
    },

    // assign_flow_prospects / get_prospect_flows
    prospectsAssigned: {
      type: 'json',
      description:
        'Prospects assigned to (or enrolled in) flows: [{flowId, flowName, crmProspectId, flowInstanceId, flowInstanceOwnerEmail, flowInstanceOwnerFullName, flowInstanceCreateDate, flowInstanceStatus, workspaceId, exclusive}]',
    },
    prospectsNotAssigned: {
      type: 'json',
      description:
        'Prospects that failed to be assigned to a flow: [{flowId, crmProspectId, errorCode, errorMessage}]',
    },

    // get_coaching
    coachingData: {
      type: 'json',
      description: "Coaching data per manager's team with direct-report metrics",
    },

    // unassign_flow_prospects
    unassignedFlowInstanceIds: {
      type: 'json',
      description: 'IDs of the flow instances the prospect was removed from',
    },

    // ask_anything / get_brief
    numOfCallsSearched: {
      type: 'number',
      description: 'Number of calls used to generate the answer or brief',
    },
    numOfEmailsSearched: {
      type: 'number',
      description: 'Number of emails used to generate the answer or brief',
    },
    answer: {
      type: 'json',
      description: 'Generated answer sections: [{answerItems, callFindings, emailFindings}]',
    },
    briefSections: {
      type: 'json',
      description:
        'Generated brief sections: [{title, sectionSummary, briefSectionType, conversationFindings, webFindings}]',
    },

    // get_logs
    logEntries: {
      type: 'json',
      description: 'Log entries: [{userId, userEmailAddress, userFullName, eventTime, logRecord}]',
    },

    // lookup_email / lookup_phone
    emails: {
      type: 'json',
      description: 'Related email messages: [{id, from, sentTime, mailbox, messageHash}]',
    },
    meetings: { type: 'json', description: 'Related meetings: [{id}]' },
    customerData: {
      type: 'json',
      description: 'Linked external-system (CRM) objects referencing the contact',
    },
    customerEngagement: {
      type: 'json',
      description: 'Customer engagement events (e.g., viewing shared calls)',
    },
    suppliedPhoneNumber: {
      type: 'string',
      description: 'The phone number supplied in the lookup request',
    },
    matchingPhoneNumbers: {
      type: 'json',
      description: 'Phone numbers in the system matching the supplied number',
    },
    emailAddresses: {
      type: 'json',
      description: 'Email addresses associated with the phone number',
    },
  },
  triggers: {
    enabled: true,
    available: ['gong_webhook', 'gong_call_completed'],
  },
}

export const GongBlockMeta = {
  tags: ['meeting', 'sales-engagement', 'speech-to-text'],
  url: 'https://www.gong.io',
  templates: [
    {
      icon: GongIcon,
      title: 'Sales call analyzer',
      prompt:
        'Build a workflow that pulls call transcripts from Gong after each sales call, identifies key objections raised, action items promised, and competitor mentions, updates the deal record in my CRM, and posts a call summary with next steps to the Slack deal channel.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GongIcon,
      title: 'Gong objection tracker',
      prompt:
        'Build a scheduled weekly workflow that scans Gong sales calls for recurring objections, scores frequency and stage, and writes a competitive-intel digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GongIcon,
      title: 'Gong deal-risk surfacer',
      prompt:
        'Create a workflow that monitors Gong conversation intelligence signals, identifies deals at risk based on talk patterns, and posts a Slack alert to the AE and manager.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GongIcon,
      title: 'Gong coaching dashboard',
      prompt:
        'Build a scheduled weekly workflow that pulls Gong per-rep metrics — talk ratio, longest monologue, question rate — and writes a coaching table for managers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
    },
    {
      icon: GongIcon,
      title: 'Gong customer-quote miner',
      prompt:
        'Create a workflow that processes Gong customer interview calls, extracts notable quotes and themes, and writes them to a marketing research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: GongIcon,
      title: 'Gong CRM auto-updater',
      prompt:
        'Build a workflow that runs after a Gong sales call, summarizes objections and next steps, and updates the linked Salesforce or HubSpot opportunity with notes.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce', 'hubspot'],
    },
    {
      icon: GongIcon,
      title: 'Gong competitor-mention tracker',
      prompt:
        'Create a workflow that scans Gong calls for competitor mentions, captures context and outcome, and writes the competitive intel to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
  ],
  skills: [
    {
      name: 'summarize-call',
      description:
        'Pull a Gong call transcript and produce a structured recap with topics, objections, and next steps.',
      content:
        '# Summarize Call\n\nUse Gong to turn a recorded call into a clean recap.\n\n## Steps\n1. Get the call by its call ID to read the metadata (participants, duration, account).\n2. Get the call transcript for the same call ID.\n3. Identify the main topics, customer objections, and agreed next steps from the transcript.\n\n## Output\nReturn a recap: a short overview, key topics discussed, objections raised, and a list of next steps with owners. Keep it grounded in the transcript.',
    },
    {
      name: 'extract-deal-signals',
      description:
        'Read a Gong call transcript and extract CRM-ready deal signals like decision-maker, competitor, and next step.',
      content:
        '# Extract Deal Signals\n\nUse Gong to turn conversation content into structured deal attributes.\n\n## Steps\n1. Get the call transcript for the given call ID.\n2. Scan for high-value signals: decision-maker, budget, timeline, competitor mentions, use case, and the agreed next step with its date.\n3. Normalize each signal into a structured field.\n\n## Output\nReturn a structured object of deal attributes (decision_maker, competitor, next_step, next_step_date, use_case, and any others found). Leave fields null when not mentioned rather than guessing, so they can be written to CRM.',
    },
    {
      name: 'review-recent-calls',
      description:
        'List recent Gong calls in a date range and produce a digest of themes and follow-ups across them.',
      content:
        '# Review Recent Calls\n\nUse Gong to summarize a batch of recent calls.\n\n## Steps\n1. List calls (or use Get Extensive Calls) filtered by a date range and optionally by user or workspace.\n2. For the most relevant calls, get the transcript to pull themes and outcomes.\n3. Roll the findings up into recurring themes, common objections, and open follow-ups across the calls.\n\n## Output\nReturn a digest: a per-call one-liner, the cross-call themes, and a consolidated follow-up list. Note any call missing a clear next step.',
    },
  ],
} as const satisfies BlockMeta
