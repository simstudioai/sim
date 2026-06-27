import { PipedriveIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { PipedriveBlockDisplay } from '@/blocks/blocks/pipedrive.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { PipedriveResponse } from '@/tools/pipedrive/types'

export const PipedriveBlock: BlockConfig<PipedriveResponse> = {
  ...PipedriveBlockDisplay,
  authMode: AuthMode.OAuth,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get All Deals', id: 'get_all_deals' },
        { label: 'Get Deal', id: 'get_deal' },
        { label: 'Create Deal', id: 'create_deal' },
        { label: 'Update Deal', id: 'update_deal' },
        { label: 'Get Files', id: 'get_files' },
        { label: 'Get Mail Threads', id: 'get_mail_messages' },
        { label: 'Get Mail Thread Messages', id: 'get_mail_thread' },
        { label: 'Get Pipelines', id: 'get_pipelines' },
        { label: 'Get Pipeline Deals', id: 'get_pipeline_deals' },
        { label: 'Get Projects', id: 'get_projects' },
        { label: 'Create Project', id: 'create_project' },
        { label: 'Get Activities', id: 'get_activities' },
        { label: 'Create Activity', id: 'create_activity' },
        { label: 'Update Activity', id: 'update_activity' },
        { label: 'Get Leads', id: 'get_leads' },
        { label: 'Create Lead', id: 'create_lead' },
        { label: 'Update Lead', id: 'update_lead' },
        { label: 'Delete Lead', id: 'delete_lead' },
      ],
      value: () => 'get_all_deals',
    },
    {
      id: 'credential',
      title: 'Pipedrive Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'pipedrive',
      requiredScopes: getScopesForService('pipedrive'),
      placeholder: 'Select Pipedrive account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Pipedrive Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All (not deleted)', id: '' },
        { label: 'Open', id: 'open' },
        { label: 'Won', id: 'won' },
        { label: 'Lost', id: 'lost' },
      ],
      value: () => '',
      condition: { field: 'operation', value: ['get_all_deals'] },
    },
    {
      id: 'person_id',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'Filter by person ID',
      condition: { field: 'operation', value: ['get_all_deals'] },
    },
    {
      id: 'org_id',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Filter by organization ID',
      condition: { field: 'operation', value: ['get_all_deals'] },
    },
    {
      id: 'pipelineSelector',
      title: 'Pipeline',
      type: 'project-selector',
      canonicalParamId: 'pipeline_id',
      serviceId: 'pipedrive',
      selectorKey: 'pipedrive.pipelines',
      placeholder: 'Select pipeline',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['get_all_deals', 'create_deal', 'get_pipeline_deals'],
      },
      required: { field: 'operation', value: 'get_pipeline_deals' },
    },
    {
      id: 'pipeline_id',
      title: 'Pipeline ID',
      type: 'short-input',
      canonicalParamId: 'pipeline_id',
      placeholder: 'Enter pipeline ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_all_deals', 'create_deal', 'get_pipeline_deals'],
      },
      required: { field: 'operation', value: 'get_pipeline_deals' },
    },
    {
      id: 'updated_since',
      title: 'Updated Since',
      type: 'short-input',
      placeholder: 'Date (2025-01-01T10:20:00Z)',
      condition: { field: 'operation', value: ['get_all_deals'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "2 hours ago" -> Calculate the timestamp 2 hours before now

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "last week", "yesterday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (default 100, max 500)',
      condition: { field: 'operation', value: ['get_all_deals'] },
    },
    {
      id: 'deal_id',
      title: 'Deal ID',
      type: 'short-input',
      placeholder: 'Enter deal ID',
      required: true,
      condition: { field: 'operation', value: ['get_deal', 'update_deal'] },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Enter deal title',
      required: true,
      condition: { field: 'operation', value: ['create_deal'] },
    },
    {
      id: 'value',
      title: 'Value',
      type: 'short-input',
      placeholder: 'Monetary value ',
      condition: { field: 'operation', value: ['create_deal', 'update_deal'] },
    },
    {
      id: 'currency',
      title: 'Currency',
      type: 'short-input',
      placeholder: 'Currency code (e.g., USD, EUR)',
      condition: { field: 'operation', value: ['create_deal'] },
    },
    {
      id: 'person_id',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'Associated person ID ',
      condition: { field: 'operation', value: ['create_deal'] },
    },
    {
      id: 'org_id',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Associated organization ID ',
      condition: { field: 'operation', value: ['create_deal'] },
    },
    {
      id: 'stage_id',
      title: 'Stage ID',
      type: 'short-input',
      placeholder: 'Stage ID ',
      condition: { field: 'operation', value: ['create_deal', 'update_deal'] },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Open', id: 'open' },
        { label: 'Won', id: 'won' },
        { label: 'Lost', id: 'lost' },
      ],
      value: () => 'open',
      condition: { field: 'operation', value: ['create_deal', 'update_deal'] },
    },
    {
      id: 'expected_close_date',
      title: 'Expected Close Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD ',
      condition: { field: 'operation', value: ['create_deal', 'update_deal'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "next Friday" -> Calculate the next Friday's date
- "end of month" -> Calculate the last day of the current month
- "in 2 weeks" -> Calculate the date 14 days from now

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "next Friday", "end of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'title',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'New deal title ',
      condition: { field: 'operation', value: ['update_deal'] },
    },
    {
      id: 'sort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'ID', id: 'id' },
        { label: 'Update Time', id: 'update_time' },
      ],
      value: () => 'id',
      condition: { field: 'operation', value: ['get_files'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (default 100, max 100)',
      condition: { field: 'operation', value: ['get_files'] },
    },
    {
      id: 'folder',
      title: 'Folder',
      type: 'dropdown',
      options: [
        { label: 'Inbox', id: 'inbox' },
        { label: 'Drafts', id: 'drafts' },
        { label: 'Sent', id: 'sent' },
        { label: 'Archive', id: 'archive' },
      ],
      value: () => 'inbox',
      condition: { field: 'operation', value: ['get_mail_messages'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (default 50)',
      condition: { field: 'operation', value: ['get_mail_messages'] },
    },
    {
      id: 'thread_id',
      title: 'Thread ID',
      type: 'short-input',
      placeholder: 'Enter mail thread ID',
      required: true,
      condition: { field: 'operation', value: ['get_mail_thread'] },
    },
    {
      id: 'sort_by',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'ID', id: 'id' },
        { label: 'Update Time', id: 'update_time' },
        { label: 'Add Time', id: 'add_time' },
      ],
      value: () => 'id',
      condition: { field: 'operation', value: ['get_pipelines'] },
    },
    {
      id: 'sort_direction',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      value: () => 'asc',
      condition: { field: 'operation', value: ['get_pipelines'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (default 100, max 500)',
      condition: { field: 'operation', value: ['get_pipelines'] },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      condition: {
        field: 'operation',
        value: ['get_all_deals', 'get_projects'],
      },
    },
    {
      id: 'start',
      title: 'Start (Offset)',
      type: 'short-input',
      placeholder: 'Pagination offset (e.g., 0, 100, 200)',
      condition: {
        field: 'operation',
        value: [
          'get_activities',
          'get_leads',
          'get_files',
          'get_pipeline_deals',
          'get_mail_messages',
          'get_pipelines',
        ],
      },
    },
    {
      id: 'stage_id',
      title: 'Stage ID',
      type: 'short-input',
      placeholder: 'Filter by stage ID ',
      condition: { field: 'operation', value: ['get_pipeline_deals'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (default 100, max 500)',
      condition: { field: 'operation', value: ['get_pipeline_deals'] },
    },
    {
      id: 'project_id',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Project ID',
      condition: { field: 'operation', value: ['get_projects'] },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Open', id: 'open' },
        { label: 'Completed', id: 'completed' },
      ],
      value: () => '',
      condition: { field: 'operation', value: ['get_projects'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (default 100, max 500)',
      condition: { field: 'operation', value: ['get_projects'] },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Enter project title',
      required: true,
      condition: { field: 'operation', value: ['create_project'] },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Project description ',
      condition: { field: 'operation', value: ['create_project'] },
    },
    {
      id: 'start_date',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD ',
      condition: { field: 'operation', value: ['create_project'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Today's date
- "next Monday" -> Calculate the next Monday's date
- "beginning of next month" -> The 1st of next month

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "today", "next Monday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'end_date',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD ',
      condition: { field: 'operation', value: ['create_project'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "end of month" -> Calculate the last day of the current month
- "in 3 weeks" -> Calculate the date 21 days from now
- "December 31st" -> 2024-12-31 (or next occurrence)

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "end of month", "in 3 weeks")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'deal_id',
      title: 'Deal ID',
      type: 'short-input',
      placeholder: 'Associated deal ID ',
      condition: { field: 'operation', value: ['create_activity'] },
    },
    {
      id: 'person_id',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'Associated person ID ',
      condition: { field: 'operation', value: ['create_activity'] },
    },
    {
      id: 'org_id',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Associated organization ID ',
      condition: { field: 'operation', value: ['create_activity'] },
    },
    {
      id: 'user_id',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Filter by user ID',
      condition: { field: 'operation', value: ['get_activities'] },
    },
    {
      id: 'type',
      title: 'Activity Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Call', id: 'call' },
        { label: 'Meeting', id: 'meeting' },
        { label: 'Task', id: 'task' },
        { label: 'Deadline', id: 'deadline' },
        { label: 'Email', id: 'email' },
        { label: 'Lunch', id: 'lunch' },
      ],
      value: () => '',
      condition: { field: 'operation', value: ['get_activities'] },
    },
    {
      id: 'done',
      title: 'Completion Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Not Done', id: '0' },
        { label: 'Done', id: '1' },
      ],
      value: () => '',
      condition: { field: 'operation', value: ['get_activities'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (default 100, max 500)',
      condition: { field: 'operation', value: ['get_activities'] },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Activity subject/title',
      required: true,
      condition: { field: 'operation', value: ['create_activity', 'update_activity'] },
    },
    {
      id: 'type',
      title: 'Activity Type',
      type: 'dropdown',
      options: [
        { label: 'Call', id: 'call' },
        { label: 'Meeting', id: 'meeting' },
        { label: 'Task', id: 'task' },
        { label: 'Deadline', id: 'deadline' },
        { label: 'Email', id: 'email' },
        { label: 'Lunch', id: 'lunch' },
      ],
      value: () => 'task',
      required: true,
      condition: { field: 'operation', value: ['create_activity'] },
    },
    {
      id: 'due_date',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      required: true,
      condition: { field: 'operation', value: ['create_activity', 'update_activity'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "tomorrow" -> Calculate tomorrow's date
- "next week" -> Calculate the date 7 days from now
- "this Friday" -> Calculate the coming Friday's date

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "tomorrow", "next week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'due_time',
      title: 'Due Time',
      type: 'short-input',
      placeholder: 'HH:MM ',
      condition: { field: 'operation', value: ['create_activity', 'update_activity'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a time in HH:MM format (24-hour) based on the user's description.
Examples:
- "9am" -> 09:00
- "2:30 PM" -> 14:30
- "noon" -> 12:00
- "end of business day" -> 17:00

Return ONLY the time string in HH:MM format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the time (e.g., "9am", "2:30 PM")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'duration',
      title: 'Duration',
      type: 'short-input',
      placeholder: 'HH:MM ',
      condition: { field: 'operation', value: ['create_activity', 'update_activity'] },
    },
    {
      id: 'note',
      title: 'Notes',
      type: 'long-input',
      placeholder: 'Activity notes ',
      condition: { field: 'operation', value: ['create_activity', 'update_activity'] },
    },
    {
      id: 'activity_id',
      title: 'Activity ID',
      type: 'short-input',
      placeholder: 'Enter activity ID',
      required: true,
      condition: { field: 'operation', value: ['update_activity'] },
    },
    {
      id: 'done',
      title: 'Mark as Done',
      type: 'dropdown',
      options: [
        { label: 'Not Done', id: '0' },
        { label: 'Done', id: '1' },
      ],
      value: () => '0',
      condition: { field: 'operation', value: ['update_activity'] },
    },
    {
      id: 'lead_id',
      title: 'Lead ID',
      type: 'short-input',
      placeholder: 'Lead ID',
      condition: { field: 'operation', value: ['get_leads', 'update_lead', 'delete_lead'] },
    },
    {
      id: 'archived',
      title: 'Archived',
      type: 'dropdown',
      options: [
        { label: 'Active Leads', id: 'false' },
        { label: 'Archived Leads', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: ['get_leads'] },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Enter lead title',
      required: true,
      condition: { field: 'operation', value: ['create_lead'] },
    },
    {
      id: 'title',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'New lead title',
      condition: { field: 'operation', value: ['update_lead'] },
    },
    {
      id: 'person_id',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'Person ID to link lead to',
      condition: { field: 'operation', value: ['create_lead', 'update_lead', 'get_leads'] },
    },
    {
      id: 'organization_id',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Organization ID to link lead to',
      condition: { field: 'operation', value: ['create_lead', 'update_lead', 'get_leads'] },
    },
    {
      id: 'owner_id',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'Owner user ID',
      condition: { field: 'operation', value: ['create_lead', 'update_lead', 'get_leads'] },
    },
    {
      id: 'value_amount',
      title: 'Value Amount',
      type: 'short-input',
      placeholder: 'Potential value amount',
      condition: { field: 'operation', value: ['create_lead', 'update_lead'] },
    },
    {
      id: 'value_currency',
      title: 'Value Currency',
      type: 'short-input',
      placeholder: 'Currency code (e.g., USD, EUR)',
      condition: { field: 'operation', value: ['create_lead', 'update_lead'] },
    },
    {
      id: 'expected_close_date',
      title: 'Expected Close Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: ['create_lead', 'update_lead'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "next quarter" -> Calculate the last day of the next quarter
- "in 30 days" -> Calculate the date 30 days from now
- "end of year" -> Calculate December 31st of the current year

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "next quarter", "in 30 days")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'is_archived',
      title: 'Archive Lead',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: ['update_lead'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (default 100)',
      condition: { field: 'operation', value: ['get_leads'] },
    },
  ],
  tools: {
    access: [
      'pipedrive_get_all_deals',
      'pipedrive_get_deal',
      'pipedrive_create_deal',
      'pipedrive_update_deal',
      'pipedrive_get_files',
      'pipedrive_get_mail_messages',
      'pipedrive_get_mail_thread',
      'pipedrive_get_pipelines',
      'pipedrive_get_pipeline_deals',
      'pipedrive_get_projects',
      'pipedrive_create_project',
      'pipedrive_get_activities',
      'pipedrive_create_activity',
      'pipedrive_update_activity',
      'pipedrive_get_leads',
      'pipedrive_create_lead',
      'pipedrive_update_lead',
      'pipedrive_delete_lead',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_all_deals':
            return 'pipedrive_get_all_deals'
          case 'get_deal':
            return 'pipedrive_get_deal'
          case 'create_deal':
            return 'pipedrive_create_deal'
          case 'update_deal':
            return 'pipedrive_update_deal'
          case 'get_files':
            return 'pipedrive_get_files'
          case 'get_mail_messages':
            return 'pipedrive_get_mail_messages'
          case 'get_mail_thread':
            return 'pipedrive_get_mail_thread'
          case 'get_pipelines':
            return 'pipedrive_get_pipelines'
          case 'get_pipeline_deals':
            return 'pipedrive_get_pipeline_deals'
          case 'get_projects':
            return 'pipedrive_get_projects'
          case 'create_project':
            return 'pipedrive_create_project'
          case 'get_activities':
            return 'pipedrive_get_activities'
          case 'create_activity':
            return 'pipedrive_create_activity'
          case 'update_activity':
            return 'pipedrive_update_activity'
          case 'get_leads':
            return 'pipedrive_get_leads'
          case 'create_lead':
            return 'pipedrive_create_lead'
          case 'update_lead':
            return 'pipedrive_update_lead'
          case 'delete_lead':
            return 'pipedrive_delete_lead'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { oauthCredential, operation, ...rest } = params

        const cleanParams: Record<string, any> = {
          oauthCredential,
        }

        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            cleanParams[key] = value
          }
        })

        return cleanParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Pipedrive access token' },
    deal_id: { type: 'string', description: 'Deal ID' },
    title: { type: 'string', description: 'Title' },
    value: { type: 'string', description: 'Monetary value' },
    currency: { type: 'string', description: 'Currency code' },
    person_id: { type: 'string', description: 'Person ID' },
    org_id: { type: 'string', description: 'Organization ID' },
    pipeline_id: { type: 'string', description: 'Pipeline ID' },
    stage_id: { type: 'string', description: 'Stage ID' },
    status: { type: 'string', description: 'Status' },
    expected_close_date: { type: 'string', description: 'Expected close date' },
    updated_since: { type: 'string', description: 'Updated since timestamp' },
    limit: { type: 'string', description: 'Result limit' },
    folder: { type: 'string', description: 'Mail folder' },
    thread_id: { type: 'string', description: 'Mail thread ID' },
    sort_by: { type: 'string', description: 'Field to sort by' },
    sort_direction: { type: 'string', description: 'Sorting direction' },
    cursor: { type: 'string', description: 'Pagination cursor (v2 endpoints)' },
    start: { type: 'string', description: 'Pagination start offset (v1 endpoints)' },
    project_id: { type: 'string', description: 'Project ID' },
    description: { type: 'string', description: 'Description' },
    start_date: { type: 'string', description: 'Start date' },
    end_date: { type: 'string', description: 'End date' },
    activity_id: { type: 'string', description: 'Activity ID' },
    subject: { type: 'string', description: 'Activity subject' },
    type: { type: 'string', description: 'Activity type' },
    due_date: { type: 'string', description: 'Due date' },
    due_time: { type: 'string', description: 'Due time' },
    duration: { type: 'string', description: 'Duration' },
    done: { type: 'string', description: 'Completion status' },
    user_id: { type: 'string', description: 'User ID' },
    note: { type: 'string', description: 'Notes' },
    lead_id: { type: 'string', description: 'Lead ID' },
    archived: { type: 'string', description: 'Archived status' },
    value_amount: { type: 'string', description: 'Value amount' },
    value_currency: { type: 'string', description: 'Value currency' },
    is_archived: { type: 'string', description: 'Archive status' },
    organization_id: { type: 'string', description: 'Organization ID' },
    owner_id: { type: 'string', description: 'Owner user ID' },
  },
  outputs: {
    deals: { type: 'json', description: 'Array of deal objects' },
    deal: { type: 'json', description: 'Single deal object' },
    files: { type: 'json', description: 'Array of file objects' },
    downloadedFiles: { type: 'file[]', description: 'Downloaded files from Pipedrive' },
    messages: { type: 'json', description: 'Array of mail message objects' },
    pipelines: { type: 'json', description: 'Array of pipeline objects' },
    projects: { type: 'json', description: 'Array of project objects' },
    project: { type: 'json', description: 'Single project object' },
    activities: { type: 'json', description: 'Array of activity objects' },
    activity: { type: 'json', description: 'Single activity object' },
    leads: { type: 'json', description: 'Array of lead objects' },
    lead: { type: 'json', description: 'Single lead object' },
    metadata: { type: 'json', description: 'Operation metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

export const PipedriveBlockMeta = {
  tags: ['sales-engagement', 'project-management'],
  url: 'https://www.pipedrive.com',
  templates: [
    {
      icon: PipedriveIcon,
      title: 'Pipedrive deal pipeline tracker',
      prompt:
        'Create a scheduled workflow that mirrors Pipedrive deals into a Sim table, calculates pipeline velocity per stage, and posts a daily Slack summary of deals at risk.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive lead enrichment pipeline',
      prompt:
        'Build a scheduled workflow that polls Pipedrive for new leads, enriches each via Apollo with role, seniority, and tech stack, and updates the lead with the enriched details.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
      alsoIntegrations: ['apollo'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive activity-from-email logger',
      prompt:
        'Create a workflow that watches Gmail for emails to or from Pipedrive contacts, logs each as an activity, and creates a follow-up task if next steps are mentioned.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive call-summary updater',
      prompt:
        'Build a workflow that runs after a Fireflies sales call, summarizes the transcript, and updates the matching Pipedrive deal with the call summary and next steps.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['fireflies'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive win/loss analyzer',
      prompt:
        'Create a scheduled monthly workflow that pulls closed Pipedrive deals, analyzes patterns in wins vs losses, and writes an insights report file for the sales team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive renewal forecast',
      prompt:
        'Build a workflow that pulls Pipedrive customer renewals due in the next 90 days, generates a personalized renewal-prep brief, and emails the account owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive Slack channel-per-deal',
      prompt:
        'Create a workflow that for Pipedrive deals above a threshold creates a Slack channel, invites the account team, and pins the deal record link.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'create-deal',
      description:
        'Create a Pipedrive deal with a title, value, pipeline stage, and linked person or organization.',
      content:
        '# Create Deal\n\nAdd a new opportunity to the sales pipeline.\n\n## Steps\n1. Use the Create Deal operation with a clear Title.\n2. Set Value and Currency, the target Pipeline and Stage ID, and Status (open, won, or lost).\n3. Link the deal to a Person ID or Organization ID, and set an Expected Close Date.\n4. Capture the returned deal ID for follow-up activities.\n\n## Output\nConfirm the new deal title, value, pipeline stage, and ID so it can be referenced in later steps.',
    },
    {
      name: 'review-pipeline',
      description:
        'List Pipedrive deals in a pipeline and summarize stage distribution and deals at risk.',
      content:
        '# Review Pipeline\n\nGet a snapshot of the current sales pipeline.\n\n## Steps\n1. Use Get All Deals (or Get Pipeline Deals for one pipeline) filtered to open status.\n2. Optionally scope by Pipeline, Person ID, or Organization ID and set Updated Since to focus on recent movement.\n3. Group deals by stage and total their value, flagging stale deals with no recent update.\n4. Page with the cursor or start offset for large pipelines.\n\n## Output\nA stage-by-stage breakdown with deal counts and total value, plus a short list of at-risk deals that have gone quiet.',
    },
    {
      name: 'log-activity',
      description:
        'Create a Pipedrive activity such as a call, meeting, or task linked to a deal or contact.',
      content:
        '# Log Activity\n\nSchedule or record follow-up work against a record.\n\n## Steps\n1. Use the Create Activity operation with a Subject and an activity Type (call, meeting, task, deadline, email, or lunch).\n2. Set the Due Date and optional Due Time, Duration, and Notes.\n3. Link the activity to the relevant Deal ID, Person ID, or Organization ID.\n4. Use Update Activity later to mark it done.\n\n## Output\nConfirm the activity subject, type, due date, and the record it is linked to.',
    },
    {
      name: 'manage-leads',
      description:
        'Create or update Pipedrive leads with value, contacts, and expected close date.',
      content:
        '# Manage Leads\n\nCapture and maintain top-of-funnel leads.\n\n## Steps\n1. Use Create Lead with a Title and link a Person ID or Organization ID and an Owner ID.\n2. Set the Value Amount and Value Currency and an Expected Close Date.\n3. Use Update Lead to revise details or archive a lead once it converts or goes cold.\n4. Use Get Leads to review active or archived leads.\n\n## Output\nThe lead title, linked contact, value, and current state (active or archived) with its ID.',
    },
  ],
} as const satisfies BlockMeta
