import { AzureIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { AzureDevOpsBasicWorkItemType, AzureDevOpsResponse } from '@/tools/azure_devops/types'
import { AZURE_DEVOPS_BASIC_WORK_ITEM_STATES } from '@/tools/azure_devops/utils'
import { getTrigger } from '@/triggers'

/** Accepts ISO 8601 or YYYY-MM-DD; expands the bare date form to a UTC midnight ISO timestamp. */
function normalizeDate(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() === '') return undefined
  const value = input.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value
}

export const AzureDevOpsBlock: BlockConfig<AzureDevOpsResponse> = {
  type: 'azure_devops',
  name: 'Azure DevOps',
  description: 'Interact with Azure DevOps pipelines, builds, and work items',
  longDescription:
    'Integrate Azure DevOps into your workflow. List and inspect pipelines and builds, query and manage work items, and add or read comments.',
  docsLink: 'https://docs.sim.ai/tools/azure_devops',
  category: 'tools',
  integrationType: IntegrationType.DeveloperTools,
  tags: ['ci-cd', 'project-management', 'version-control'],
  bgColor: '#0078D4',
  icon: AzureIcon,
  authMode: AuthMode.ApiKey,
  triggerAllowed: true,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Pipeline
        { label: 'List Pipelines', id: 'azure_devops_list_pipelines' },
        { label: 'Get Pipeline', id: 'azure_devops_get_pipeline' },
        { label: 'List Pipeline Runs', id: 'azure_devops_list_pipeline_runs' },
        { label: 'Get Pipeline Run', id: 'azure_devops_get_pipeline_run' },
        // Builds
        { label: 'List Builds', id: 'azure_devops_list_builds' },
        { label: 'List Build Logs', id: 'azure_devops_list_build_logs' },
        { label: 'Get Build Log', id: 'azure_devops_get_build_log' },
        { label: 'Get Build Timeline', id: 'azure_devops_get_build_timeline' },
        {
          label: 'Get Work Items Between Builds',
          id: 'azure_devops_get_work_items_between_builds',
        },
        // Work Items
        { label: 'Query Work Items', id: 'azure_devops_query_work_items' },
        { label: 'Get Work Item', id: 'azure_devops_get_work_item' },
        { label: 'Get Work Items Batch', id: 'azure_devops_get_work_items_batch' },
        { label: 'Create Work Item', id: 'azure_devops_create_work_item' },
        { label: 'Update Work Item', id: 'azure_devops_update_work_item' },
        { label: 'Add Comment', id: 'azure_devops_add_comment' },
        { label: 'Get Comments', id: 'azure_devops_get_comments' },
      ],
      value: () => 'azure_devops_list_pipelines',
    },

    // ── Shared auth + org/project ────────────────────────────────────────────
    {
      id: 'accessToken',
      title: 'Personal Access Token',
      type: 'short-input',
      password: true,
      required: true,
      placeholder: 'Requires Build: Read and Work Items: Read & Write scopes',
    },
    {
      id: 'organization',
      title: 'Organization',
      type: 'short-input',
      required: true,
      placeholder: 'e.g. contoso',
    },
    {
      id: 'project',
      title: 'Project',
      type: 'short-input',
      required: true,
      placeholder: 'e.g. MyApp',
    },

    // ── Pipeline fields ──────────────────────────────────────────────────────
    {
      id: 'pipelineId',
      title: 'Pipeline ID',
      type: 'short-input',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'azure_devops_get_pipeline',
          'azure_devops_list_pipeline_runs',
          'azure_devops_get_pipeline_run',
        ],
      },
    },
    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: 'azure_devops_get_pipeline_run' },
    },

    // ── Build fields ─────────────────────────────────────────────────────────
    {
      id: 'resultFilter',
      title: 'Filter by Result',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Succeeded', id: 'succeeded' },
        { label: 'Failed', id: 'failed' },
        { label: 'Canceled', id: 'canceled' },
        { label: 'Partially Succeeded', id: 'partiallySucceeded' },
      ],
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'top',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'buildId',
      title: 'Build ID',
      type: 'short-input',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'azure_devops_list_build_logs',
          'azure_devops_get_build_log',
          'azure_devops_get_build_timeline',
        ],
      },
    },
    {
      id: 'logId',
      title: 'Log ID',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: 'azure_devops_get_build_log' },
    },
    {
      id: 'fromBuildId',
      title: 'From Build ID',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: 'azure_devops_get_work_items_between_builds' },
    },
    {
      id: 'toBuildId',
      title: 'To Build ID',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: 'azure_devops_get_work_items_between_builds' },
    },

    // ── Work Item fields ─────────────────────────────────────────────────────
    {
      id: 'wiqlQuery',
      title: 'WIQL Query',
      type: 'long-input',
      required: true,
      placeholder:
        'SELECT [System.Id], [System.Title], [System.State] FROM workitems WHERE [System.TeamProject] = @project ORDER BY [System.CreatedDate] DESC',
      condition: { field: 'operation', value: 'azure_devops_query_work_items' },
    },
    {
      id: 'workItemId',
      title: 'Work Item ID',
      type: 'short-input',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'azure_devops_get_work_item',
          'azure_devops_update_work_item',
          'azure_devops_add_comment',
          'azure_devops_get_comments',
        ],
      },
    },
    {
      id: 'workItemIds',
      title: 'Work Item IDs',
      type: 'short-input',
      required: true,
      placeholder: 'Comma-separated IDs, e.g. 1,2,3',
      condition: { field: 'operation', value: 'azure_devops_get_work_items_batch' },
    },
    {
      id: 'workItemType',
      title: 'Work Item Type',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Issue', id: 'Issue' },
        { label: 'Task', id: 'Task' },
        { label: 'Epic', id: 'Epic' },
      ],
      value: () => 'Issue',
      condition: { field: 'operation', value: 'azure_devops_create_work_item' },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      required: { field: 'operation', value: 'azure_devops_create_work_item' },
      condition: {
        field: 'operation',
        value: ['azure_devops_create_work_item', 'azure_devops_update_work_item'],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      condition: {
        field: 'operation',
        value: ['azure_devops_create_work_item', 'azure_devops_update_work_item'],
      },
    },
    {
      id: 'assignedTo',
      title: 'Assigned To',
      type: 'short-input',
      placeholder: 'Email or display name',
      condition: {
        field: 'operation',
        value: ['azure_devops_create_work_item', 'azure_devops_update_work_item'],
      },
      mode: 'advanced',
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'dropdown',
      options: [
        { label: '1 - Critical', id: '1' },
        { label: '2 - High', id: '2' },
        { label: '3 - Medium', id: '3' },
        { label: '4 - Low', id: '4' },
      ],
      condition: {
        field: 'operation',
        value: ['azure_devops_create_work_item', 'azure_devops_update_work_item'],
      },
      mode: 'advanced',
    },
    {
      id: 'effort',
      title: 'Effort',
      type: 'short-input',
      placeholder: 'Numeric effort (Issue only)',
      condition: {
        field: 'operation',
        value: 'azure_devops_create_work_item',
        and: { field: 'workItemType', value: 'Issue' },
      },
      mode: 'advanced',
    },
    {
      id: 'effort',
      title: 'Effort',
      type: 'short-input',
      placeholder: 'Numeric effort (Issue only)',
      condition: { field: 'operation', value: 'azure_devops_update_work_item' },
      mode: 'advanced',
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (Epic only)',
      condition: {
        field: 'operation',
        value: 'azure_devops_create_work_item',
        and: { field: 'workItemType', value: 'Epic' },
      },
      mode: 'advanced',
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (Epic only)',
      condition: { field: 'operation', value: 'azure_devops_update_work_item' },
      mode: 'advanced',
    },
    {
      id: 'targetDate',
      title: 'Target Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (Epic only)',
      condition: {
        field: 'operation',
        value: 'azure_devops_create_work_item',
        and: { field: 'workItemType', value: 'Epic' },
      },
      mode: 'advanced',
    },
    {
      id: 'targetDate',
      title: 'Target Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (Epic only)',
      condition: { field: 'operation', value: 'azure_devops_update_work_item' },
      mode: 'advanced',
    },
    {
      id: 'activity',
      title: 'Activity',
      type: 'dropdown',
      options: [
        { label: 'Deployment', id: 'Deployment' },
        { label: 'Design', id: 'Design' },
        { label: 'Development', id: 'Development' },
        { label: 'Documentation', id: 'Documentation' },
        { label: 'Requirements', id: 'Requirements' },
        { label: 'Testing', id: 'Testing' },
      ],
      condition: {
        field: 'operation',
        value: 'azure_devops_create_work_item',
        and: { field: 'workItemType', value: 'Task' },
      },
      mode: 'advanced',
    },
    {
      id: 'activity',
      title: 'Activity',
      type: 'dropdown',
      options: [
        { label: 'Deployment', id: 'Deployment' },
        { label: 'Design', id: 'Design' },
        { label: 'Development', id: 'Development' },
        { label: 'Documentation', id: 'Documentation' },
        { label: 'Requirements', id: 'Requirements' },
        { label: 'Testing', id: 'Testing' },
      ],
      condition: { field: 'operation', value: 'azure_devops_update_work_item' },
      mode: 'advanced',
    },
    {
      id: 'remainingWork',
      title: 'Remaining Work',
      type: 'short-input',
      placeholder: 'Hours (Task only)',
      condition: {
        field: 'operation',
        value: 'azure_devops_create_work_item',
        and: { field: 'workItemType', value: 'Task' },
      },
      mode: 'advanced',
    },
    {
      id: 'remainingWork',
      title: 'Remaining Work',
      type: 'short-input',
      placeholder: 'Hours (Task only)',
      condition: { field: 'operation', value: 'azure_devops_update_work_item' },
      mode: 'advanced',
    },
    {
      id: 'completedWork',
      title: 'Completed Work',
      type: 'short-input',
      placeholder: 'Hours (Task only)',
      condition: {
        field: 'operation',
        value: 'azure_devops_create_work_item',
        and: { field: 'workItemType', value: 'Task' },
      },
      mode: 'advanced',
    },
    {
      id: 'completedWork',
      title: 'Completed Work',
      type: 'short-input',
      placeholder: 'Hours (Task only)',
      condition: { field: 'operation', value: 'azure_devops_update_work_item' },
      mode: 'advanced',
    },
    {
      id: 'areaPath',
      title: 'Area Path',
      type: 'short-input',
      placeholder: 'e.g. MyProject\\Team',
      condition: {
        field: 'operation',
        value: ['azure_devops_create_work_item', 'azure_devops_update_work_item'],
      },
      mode: 'advanced',
    },
    {
      id: 'iterationPath',
      title: 'Iteration Path',
      type: 'short-input',
      placeholder: 'e.g. MyProject\\Sprint 1',
      condition: { field: 'operation', value: 'azure_devops_create_work_item' },
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Semicolon-separated, e.g. issue; p1; auth',
      condition: {
        field: 'operation',
        value: ['azure_devops_create_work_item', 'azure_devops_update_work_item'],
      },
      mode: 'advanced',
    },
    {
      id: 'state',
      title: 'State',
      type: 'dropdown',
      options: AZURE_DEVOPS_BASIC_WORK_ITEM_STATES.map((state) => ({
        label: state,
        id: state,
      })),
      condition: { field: 'operation', value: 'azure_devops_update_work_item' },
    },
    {
      id: 'commentText',
      title: 'Comment',
      type: 'long-input',
      required: true,
      condition: { field: 'operation', value: 'azure_devops_add_comment' },
    },
    ...getTrigger('azure_devops_build_failed').subBlocks,
    ...getTrigger('azure_devops_work_item_created').subBlocks,
    ...getTrigger('azure_devops_webhook').subBlocks,
  ],

  tools: {
    access: [
      'azure_devops_list_pipelines',
      'azure_devops_get_pipeline',
      'azure_devops_list_pipeline_runs',
      'azure_devops_get_pipeline_run',
      'azure_devops_list_builds',
      'azure_devops_list_build_logs',
      'azure_devops_get_build_log',
      'azure_devops_get_build_timeline',
      'azure_devops_get_work_items_between_builds',
      'azure_devops_query_work_items',
      'azure_devops_get_work_item',
      'azure_devops_get_work_items_batch',
      'azure_devops_create_work_item',
      'azure_devops_update_work_item',
      'azure_devops_add_comment',
      'azure_devops_get_comments',
    ],
    config: {
      tool: (params) => params.operation as string,
      params: (params) => {
        const base = {
          accessToken: params.accessToken as string,
          organization: params.organization as string,
          project: params.project as string,
        }
        switch (params.operation) {
          case 'azure_devops_list_pipelines':
            return base
          case 'azure_devops_get_pipeline':
            return { ...base, pipelineId: Number(params.pipelineId) }
          case 'azure_devops_list_pipeline_runs':
            return { ...base, pipelineId: Number(params.pipelineId) }
          case 'azure_devops_get_pipeline_run':
            return { ...base, pipelineId: Number(params.pipelineId), runId: Number(params.runId) }
          case 'azure_devops_list_builds':
            return {
              ...base,
              resultFilter: (params.resultFilter as string) || undefined,
              top: params.top ? Number(params.top) : undefined,
            }
          case 'azure_devops_list_build_logs':
            return { ...base, buildId: Number(params.buildId) }
          case 'azure_devops_get_build_log':
            return { ...base, buildId: Number(params.buildId), logId: Number(params.logId) }
          case 'azure_devops_get_build_timeline':
            return { ...base, buildId: Number(params.buildId) }
          case 'azure_devops_get_work_items_between_builds':
            return {
              ...base,
              fromBuildId: Number(params.fromBuildId),
              toBuildId: Number(params.toBuildId),
            }
          case 'azure_devops_query_work_items':
            return { ...base, wiqlQuery: params.wiqlQuery as string }
          case 'azure_devops_get_work_item':
            return { ...base, workItemId: Number(params.workItemId) }
          case 'azure_devops_get_work_items_batch':
            return { ...base, ids: params.workItemIds as string }
          case 'azure_devops_create_work_item':
            return {
              ...base,
              workItemType: params.workItemType as AzureDevOpsBasicWorkItemType,
              title: params.title as string,
              description: (params.description as string) || undefined,
              assignedTo: (params.assignedTo as string) || undefined,
              priority: params.priority ? Number(params.priority) : undefined,
              effort: params.effort ? Number(params.effort) : undefined,
              startDate: normalizeDate(params.startDate),
              targetDate: normalizeDate(params.targetDate),
              activity: (params.activity as string) || undefined,
              remainingWork: params.remainingWork ? Number(params.remainingWork) : undefined,
              completedWork: params.completedWork ? Number(params.completedWork) : undefined,
              areaPath: (params.areaPath as string) || undefined,
              iterationPath: (params.iterationPath as string) || undefined,
              tags: (params.tags as string) || undefined,
            }
          case 'azure_devops_update_work_item':
            return {
              ...base,
              workItemId: Number(params.workItemId),
              title: (params.title as string) || undefined,
              state: (params.state as string) || undefined,
              assignedTo: (params.assignedTo as string) || undefined,
              priority: params.priority ? Number(params.priority) : undefined,
              effort: params.effort ? Number(params.effort) : undefined,
              startDate: normalizeDate(params.startDate),
              targetDate: normalizeDate(params.targetDate),
              activity: (params.activity as string) || undefined,
              remainingWork: params.remainingWork ? Number(params.remainingWork) : undefined,
              completedWork: params.completedWork ? Number(params.completedWork) : undefined,
              description: (params.description as string) || undefined,
              areaPath: (params.areaPath as string) || undefined,
              tags: (params.tags as string) || undefined,
            }
          case 'azure_devops_add_comment':
            return {
              ...base,
              workItemId: Number(params.workItemId),
              text: params.commentText as string,
            }
          case 'azure_devops_get_comments':
            return { ...base, workItemId: Number(params.workItemId) }
          default:
            return base
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    accessToken: { type: 'string', description: 'Azure DevOps Personal Access Token' },
    organization: { type: 'string', description: 'Azure DevOps organization name' },
    project: { type: 'string', description: 'Azure DevOps project name' },
    pipelineId: { type: 'number', description: 'Pipeline ID' },
    runId: { type: 'number', description: 'Pipeline run ID' },
    resultFilter: { type: 'string', description: 'Build result filter' },
    top: { type: 'number', description: 'Maximum number of results' },
    buildId: { type: 'number', description: 'Build ID' },
    logId: { type: 'number', description: 'Build log ID' },
    fromBuildId: { type: 'number', description: 'Starting build ID for work item range' },
    toBuildId: { type: 'number', description: 'Ending build ID for work item range' },
    wiqlQuery: { type: 'string', description: 'WIQL query string' },
    workItemId: { type: 'number', description: 'Work item ID' },
    workItemIds: { type: 'string', description: 'Comma-separated work item IDs' },
    workItemType: { type: 'string', description: 'Basic work item type (Issue, Task, Epic)' },
    title: { type: 'string', description: 'Work item title' },
    description: { type: 'string', description: 'Work item description (HTML supported)' },
    assignedTo: { type: 'string', description: 'Assignee email or display name' },
    priority: { type: 'number', description: 'Work item priority (1–4)' },
    effort: {
      type: 'number',
      description: 'Work item effort (Microsoft.VSTS.Scheduling.Effort); Basic process: Issue only',
    },
    startDate: {
      type: 'string',
      description: 'Start date (Microsoft.VSTS.Scheduling.StartDate); Basic process: Epic only',
    },
    targetDate: {
      type: 'string',
      description: 'Target date (Microsoft.VSTS.Scheduling.TargetDate); Basic process: Epic only',
    },
    activity: {
      type: 'string',
      description: 'Activity (Microsoft.VSTS.Common.Activity); Basic process: Task only',
    },
    remainingWork: {
      type: 'number',
      description:
        'Remaining work hours (Microsoft.VSTS.Scheduling.RemainingWork); Basic process: Task only',
    },
    completedWork: {
      type: 'number',
      description:
        'Completed work hours (Microsoft.VSTS.Scheduling.CompletedWork); Basic process: Task only',
    },
    areaPath: { type: 'string', description: 'Area path' },
    iterationPath: { type: 'string', description: 'Iteration path' },
    tags: { type: 'string', description: 'Semicolon-separated tags' },
    state: {
      type: 'string',
      description: 'Basic-process work item state (To Do, Doing, Done)',
    },
    commentText: { type: 'string', description: 'Comment text' },
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable response from Azure DevOps' },
    metadata: { type: 'json', description: 'Structured Azure DevOps response data' },
  },

  triggers: {
    enabled: true,
    available: [
      'azure_devops_build_failed',
      'azure_devops_work_item_created',
      'azure_devops_webhook',
    ],
  },
}
