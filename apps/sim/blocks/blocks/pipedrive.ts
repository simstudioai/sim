import { PipedriveIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { PipedriveResponse } from '@/tools/pipedrive/types'

export const PipedriveBlock: BlockConfig<PipedriveResponse> = {
  type: 'pipedrive',
  name: 'Pipedrive',
  description: 'Interact with Pipedrive CRM',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Pipedrive into your workflow. Manage deals, contacts, sales pipeline, projects, activities, files, and communications with powerful CRM capabilities.',
  docsLink: 'https://docs.sim.ai/tools/pipedrive',
  category: 'tools',
  bgColor: '#2E6936',
  icon: PipedriveIcon,
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
      provider: 'pipedrive',
      serviceId: 'pipedrive',
      requiredScopes: [
        'base',
        'deals:full',
        'contacts:full',
        'leads:full',
        'activities:full',
        'mail:full',
        'projects:full',
      ],
      placeholder: 'Select Pipedrive account',
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
      id: 'pipeline_id',
      title: 'Pipeline ID',
      type: 'short-input',
      placeholder: 'Filter by pipeline ID ',
      condition: { field: 'operation', value: ['get_all_deals'] },
    },
    {
      id: 'updated_since',
      title: 'Updated Since',
      type: 'short-input',
      placeholder: 'Date (2025-01-01T10:20:00Z)',
      condition: { field: 'operation', value: ['get_all_deals'] },
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
      id: 'pipeline_id',
      title: 'Pipeline ID',
      type: 'short-input',
      placeholder: 'Pipeline ID ',
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
    },
    {
      id: 'title',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'New deal title ',
      condition: { field: 'operation', value: ['update_deal'] },
    },
    {
      id: 'deal_id',
      title: 'Deal ID',
      type: 'short-input',
      placeholder: 'Filter by deal ID ',
      condition: { field: 'operation', value: ['get_files'] },
    },
    {
      id: 'person_id',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'Filter by person ID ',
      condition: { field: 'operation', value: ['get_files'] },
    },
    {
      id: 'org_id',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Filter by organization ID ',
      condition: { field: 'operation', value: ['get_files'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (default 100, max 500)',
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
      placeholder: 'Pagination cursor (optional)',
      condition: { field: 'operation', value: ['get_pipelines'] },
    },
    {
      id: 'pipeline_id',
      title: 'Pipeline ID',
      type: 'short-input',
      placeholder: 'Enter pipeline ID',
      required: true,
      condition: { field: 'operation', value: ['get_pipeline_deals'] },
    },
    {
      id: 'stage_id',
      title: 'Stage ID',
      type: 'short-input',
      placeholder: 'Filter by stage ID ',
      condition: { field: 'operation', value: ['get_pipeline_deals'] },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Open', id: 'open' },
        { label: 'Won', id: 'won' },
        { label: 'Lost', id: 'lost' },
      ],
      value: () => '',
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
    },
    {
      id: 'end_date',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD ',
      condition: { field: 'operation', value: ['create_project'] },
    },
    {
      id: 'deal_id',
      title: 'Deal ID',
      type: 'short-input',
      placeholder: 'Filter by deal ID ',
      condition: { field: 'operation', value: ['get_activities', 'create_activity'] },
    },
    {
      id: 'person_id',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'Filter by person ID ',
      condition: { field: 'operation', value: ['get_activities', 'create_activity'] },
    },
    {
      id: 'org_id',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Filter by organization ID ',
      condition: { field: 'operation', value: ['get_activities', 'create_activity'] },
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
    },
    {
      id: 'due_time',
      title: 'Due Time',
      type: 'short-input',
      placeholder: 'HH:MM ',
      condition: { field: 'operation', value: ['create_activity', 'update_activity'] },
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
        const { credential, operation, ...rest } = params

        const cleanParams: Record<string, any> = {
          credential,
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
    credential: { type: 'string', description: 'Pipedrive access token' },
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
    cursor: { type: 'string', description: 'Pagination cursor' },
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
    note: { type: 'string', description: 'Notes' },
    lead_id: { type: 'string', description: 'Lead ID' },
    archived: { type: 'string', description: 'Archived status' },
    value_amount: { type: 'string', description: 'Value amount' },
    value_currency: { type: 'string', description: 'Value currency' },
    is_archived: { type: 'string', description: 'Archive status' },
  },
  outputs: {
    deals: { type: 'json', description: 'Array of deal objects' },
    deal: { type: 'json', description: 'Single deal object' },
    files: { type: 'json', description: 'Array of file objects' },
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
