import { AzureIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { withSavedCredential } from '@/blocks/utils'
import type { AzureDevOpsBasicWorkItemType } from '@/tools/azure_devops/types'
import { AZURE_DEVOPS_BASIC_WORK_ITEM_STATES } from '@/tools/azure_devops/utils'
import { getTrigger } from '@/triggers'

/** Accepts ISO 8601 or YYYY-MM-DD; expands the bare date form to a UTC midnight ISO timestamp. */
function normalizeDate(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() === '') return undefined
  const value = input.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value
}

/**
 * Dedicated Max Results value for an operation, falling back to the shared List Builds `top`
 * that these tools read before they had their own field, so saved workflows keep their page size.
 */
function resolveTop(dedicated: unknown, shared: unknown): number | undefined {
  const value = dedicated || shared
  return value ? Number(value) : undefined
}

export const AzureDevOpsBlock: BlockConfig = {
  type: 'azure_devops',
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'azure_devops_v2' },
  name: 'Azure DevOps',
  description: 'Interact with Azure DevOps pipelines, builds, and work items',
  longDescription:
    'List and inspect pipelines and builds, query and manage work items, and add or read comments.',
  docsLink: 'https://docs.sim.ai/integrations/azure_devops',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#0078D4',
  icon: AzureIcon,
  canvasPresentation: {
    defaultTitle: 'Azure DevOps',
    sentences: {
      byOperation: {
        azure_devops_list_pipelines: [{ text: 'List pipelines in', field: 'project', core: true }],
        azure_devops_get_pipeline: [
          { text: 'Read pipeline', field: 'pipelineId', core: true },
          { text: 'in', field: 'project' },
        ],
        azure_devops_list_pipeline_runs: [
          { text: 'List runs of pipeline', field: 'pipelineId', core: true },
          { text: 'in', field: 'project' },
        ],
        azure_devops_get_pipeline_run: [
          { text: 'Read run', field: 'runId', core: true },
          { text: 'of pipeline', field: 'pipelineId' },
        ],
        azure_devops_list_builds: [
          { text: 'List builds in', field: 'project', core: true },
          { text: ', with result', field: 'resultFilter' },
          { text: ', up to', field: 'top', after: 'results' },
        ],
        azure_devops_list_build_logs: [
          { text: 'List logs for build', field: 'buildId', core: true },
          { text: 'in', field: 'project' },
        ],
        azure_devops_get_build_log: [
          { text: 'Read log', field: 'logId', core: true },
          { text: 'from build', field: 'buildId' },
        ],
        azure_devops_get_build_timeline: [
          { text: 'Read execution timeline of build', field: 'buildId', core: true },
        ],
        azure_devops_get_work_items_between_builds: [
          { text: 'List work items from build', field: 'fromBuildId', core: true },
          { text: 'to build', field: 'toBuildId' },
        ],
        azure_devops_query_work_items: [
          { text: 'Find work items matching', field: 'wiqlQuery', core: true },
        ],
        azure_devops_get_work_item: [
          { text: 'Read work item', field: 'workItemId', core: true },
          { text: 'in', field: 'project' },
        ],
        azure_devops_get_work_items_batch: [
          { text: 'Read details for work items', field: 'workItemIds', core: true },
        ],
        azure_devops_create_work_item: [
          { text: 'Create', field: 'workItemType', core: true },
          { text: 'titled', field: 'title', core: true },
          { text: ', assigned to', field: 'assignedTo' },
        ],
        azure_devops_update_work_item: [
          { text: 'Update work item', field: 'workItemId', core: true },
          { text: ', setting state to', field: 'state' },
          { text: ', assigning it to', field: 'assignedTo' },
        ],
        azure_devops_add_comment: [
          { text: 'Comment', field: 'commentText', core: true },
          { text: 'on work item', field: 'workItemId', core: true },
        ],
        azure_devops_get_comments: [
          { text: 'List comments on work item', field: 'workItemId', core: true },
        ],
      },
    },
  },
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
      id: 'pipelinesTop',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Server default when empty',
      condition: { field: 'operation', value: 'azure_devops_list_pipelines' },
      mode: 'advanced',
    },
    {
      id: 'queryTop',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Server default when empty',
      condition: { field: 'operation', value: 'azure_devops_query_work_items' },
      mode: 'advanced',
    },
    {
      id: 'commentsTop',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Server default when empty',
      condition: { field: 'operation', value: 'azure_devops_get_comments' },
      mode: 'advanced',
    },
    {
      id: 'definitionIds',
      title: 'Pipeline Definition IDs',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. 12,34',
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'statusFilter',
      title: 'Filter by Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'In Progress', id: 'inProgress' },
        { label: 'Completed', id: 'completed' },
        { label: 'Cancelling', id: 'cancelling' },
        { label: 'Postponed', id: 'postponed' },
        { label: 'Not Started', id: 'notStarted' },
        { label: 'No Status', id: 'none' },
      ],
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'branchName',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'e.g. refs/heads/main',
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'reasonFilter',
      title: 'Build Reason',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Manual', id: 'manual' },
        { label: 'CI', id: 'individualCI' },
        { label: 'Batched CI', id: 'batchedCI' },
        { label: 'Schedule', id: 'schedule' },
        { label: 'Pull Request', id: 'pullRequest' },
        { label: 'Build Completion', id: 'buildCompletion' },
        { label: 'Resource Trigger', id: 'resourceTrigger' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'requestedFor',
      title: 'Requested For',
      type: 'short-input',
      placeholder: 'User email or ID',
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'queryOrder',
      title: 'Order',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Queued (newest first)', id: 'queueTimeDescending' },
        { label: 'Queued (oldest first)', id: 'queueTimeAscending' },
        { label: 'Started (newest first)', id: 'startTimeDescending' },
        { label: 'Started (oldest first)', id: 'startTimeAscending' },
        { label: 'Finished (newest first)', id: 'finishTimeDescending' },
        { label: 'Finished (oldest first)', id: 'finishTimeAscending' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'minTime',
      title: 'After',
      type: 'short-input',
      placeholder: 'ISO 8601, e.g. 2026-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'maxTime',
      title: 'Before',
      type: 'short-input',
      placeholder: 'ISO 8601, e.g. 2026-01-31T23:59:59Z',
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'continuationToken',
      title: 'Continuation Token',
      type: 'short-input',
      placeholder: 'From a previous page',
      condition: { field: 'operation', value: 'azure_devops_list_builds' },
      mode: 'advanced',
    },
    {
      id: 'pipelinesContinuationToken',
      title: 'Continuation Token',
      type: 'short-input',
      placeholder: 'From a previous page',
      condition: { field: 'operation', value: 'azure_devops_list_pipelines' },
      mode: 'advanced',
    },
    {
      id: 'commentsContinuationToken',
      title: 'Continuation Token',
      type: 'short-input',
      placeholder: 'From a previous page',
      condition: { field: 'operation', value: 'azure_devops_get_comments' },
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
      id: 'startLine',
      title: 'Start Line',
      type: 'short-input',
      placeholder: 'First line to return',
      condition: { field: 'operation', value: 'azure_devops_get_build_log' },
      mode: 'advanced',
    },
    {
      id: 'endLine',
      title: 'End Line',
      type: 'short-input',
      placeholder: 'Last line to return',
      condition: { field: 'operation', value: 'azure_devops_get_build_log' },
      mode: 'advanced',
    },
    {
      id: 'fromBuildId',
      title: 'From Build ID',
      canvasNoun: 'a build ID',
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
      id: 'updateIterationPath',
      title: 'Iteration Path',
      type: 'short-input',
      placeholder: 'e.g. MyProject\\Sprint 2',
      condition: { field: 'operation', value: 'azure_devops_update_work_item' },
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
    {
      id: 'commentFormat',
      title: 'Comment Format',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Markdown', id: 'markdown' },
        { label: 'HTML', id: 'html' },
      ],
      condition: { field: 'operation', value: 'azure_devops_add_comment' },
      mode: 'advanced',
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
            return {
              ...base,
              top: resolveTop(params.pipelinesTop, params.top),
              continuationToken: (params.pipelinesContinuationToken as string) || undefined,
            }
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
              definitionIds: (params.definitionIds as string) || undefined,
              statusFilter: (params.statusFilter as string) || undefined,
              branchName: (params.branchName as string) || undefined,
              reasonFilter: (params.reasonFilter as string) || undefined,
              requestedFor: (params.requestedFor as string) || undefined,
              queryOrder: (params.queryOrder as string) || undefined,
              minTime: normalizeDate(params.minTime),
              maxTime: normalizeDate(params.maxTime),
              continuationToken: (params.continuationToken as string) || undefined,
            }
          case 'azure_devops_list_build_logs':
            return { ...base, buildId: Number(params.buildId) }
          case 'azure_devops_get_build_log':
            return {
              ...base,
              buildId: Number(params.buildId),
              logId: Number(params.logId),
              startLine: params.startLine ? Number(params.startLine) : undefined,
              endLine: params.endLine ? Number(params.endLine) : undefined,
            }
          case 'azure_devops_get_build_timeline':
            return { ...base, buildId: Number(params.buildId) }
          case 'azure_devops_get_work_items_between_builds':
            return {
              ...base,
              fromBuildId: Number(params.fromBuildId),
              toBuildId: Number(params.toBuildId),
            }
          case 'azure_devops_query_work_items':
            return {
              ...base,
              wiqlQuery: params.wiqlQuery as string,
              top: params.queryTop ? Number(params.queryTop) : undefined,
            }
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
              iterationPath: (params.updateIterationPath as string) || undefined,
              tags: (params.tags as string) || undefined,
            }
          case 'azure_devops_add_comment':
            return {
              ...base,
              workItemId: Number(params.workItemId),
              text: params.commentText as string,
              format: (params.commentFormat as string) || undefined,
            }
          case 'azure_devops_get_comments':
            return {
              ...base,
              workItemId: Number(params.workItemId),
              top: resolveTop(params.commentsTop, params.top),
              continuationToken: (params.commentsContinuationToken as string) || undefined,
            }
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
    pipelinesTop: { type: 'number', description: 'Maximum pipelines to return (list pipelines)' },
    queryTop: { type: 'number', description: 'Maximum work items to return (query work items)' },
    commentsTop: { type: 'number', description: 'Maximum comments to return (get comments)' },
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
    updateIterationPath: { type: 'string', description: 'New iteration path (update work item)' },
    tags: { type: 'string', description: 'Semicolon-separated tags' },
    state: {
      type: 'string',
      description: 'Basic-process work item state (To Do, Doing, Done)',
    },
    commentText: { type: 'string', description: 'Comment text' },
    commentFormat: { type: 'string', description: 'Comment format (markdown or html)' },
    definitionIds: { type: 'string', description: 'Comma-separated pipeline definition IDs' },
    statusFilter: { type: 'string', description: 'Build status filter' },
    branchName: { type: 'string', description: 'Source branch filter (e.g. refs/heads/main)' },
    reasonFilter: { type: 'string', description: 'Build reason filter (list builds)' },
    requestedFor: { type: 'string', description: 'Requested-for user filter (list builds)' },
    queryOrder: { type: 'string', description: 'Build sort order (list builds)' },
    minTime: { type: 'string', description: 'Only builds after this ISO 8601 time' },
    maxTime: { type: 'string', description: 'Only builds before this ISO 8601 time' },
    continuationToken: { type: 'string', description: 'Continuation token for the next page' },
    pipelinesContinuationToken: {
      type: 'string',
      description: 'Continuation token for the next page of pipelines',
    },
    commentsContinuationToken: {
      type: 'string',
      description: 'Continuation token for the next page of comments',
    },
    startLine: { type: 'number', description: 'First log line to return' },
    endLine: { type: 'number', description: 'Last log line to return' },
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

export const AzureDevOpsBlockMeta = {
  tags: ['version-control', 'ci-cd', 'project-management'],
  url: 'https://azure.microsoft.com/products/devops',
  templates: [
    {
      icon: AzureIcon,
      title: 'Azure DevOps build failure alerter',
      prompt:
        'Build a workflow triggered when an Azure DevOps build fails that fetches the build timeline and failing-stage logs, summarizes the root cause with an agent, and posts an actionable Slack alert with a deep link to the run.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps work-item triager',
      prompt:
        'Create a workflow triggered when an Azure DevOps work item is created that classifies it by type and priority, enriches the description, assigns the right area path, and posts a summary to the team channel.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'project-management', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps release notes generator',
      prompt:
        'Build a workflow that pulls the work items completed between two Azure DevOps builds, groups them by type with an agent, and writes formatted release notes to a file for the release manager.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting', 'engineering'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps pipeline health report',
      prompt:
        'Create a scheduled daily workflow that lists Azure DevOps pipeline runs, computes pass rate and average duration per pipeline, logs them to a table for trend tracking, and Slacks a morning summary highlighting any regressions.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps to Linear bridge',
      prompt:
        'Build a workflow that watches new Azure DevOps work items, mirrors each as a Linear issue with full context and a back-link, and keeps the team aligned across both trackers.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'project-management'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps PR review summarizer',
      prompt:
        'Create a workflow triggered on a new Azure DevOps pull request that fetches the diff and linked work items, drafts a concise review summary and risk callouts with an agent, and posts it as a PR comment for reviewers.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'engineering', 'automation'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps sprint burndown digest',
      prompt:
        'Build a scheduled daily workflow that queries Azure DevOps work items in the active sprint, computes remaining effort and at-risk items, logs the burndown to a table, and posts a morning summary to the team Slack channel.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'project-management', 'reporting'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'triage-build-failure',
      description:
        'Investigate a failed Azure DevOps build, pinpoint the failing stage, and summarize the root cause. Use when a pipeline run breaks.',
      content:
        '# Triage Build Failure\n\nDiagnose why an Azure DevOps build failed.\n\n## Steps\n1. Use Get Build Timeline for the build id to find which stage, job, or task failed.\n2. Use List Build Logs to locate the log id for the failing step, then Get Build Log to read its contents.\n3. Scan the log for the first error, the failing command, and the exit code; ignore noise after the initial failure.\n4. Optionally use Get Work Items Between Builds against the last successful build to see what changed.\n\n## Output\nReturn a concise root-cause summary: the failing stage/task, the key error line, the likely cause, and a suggested next action. Include a deep link to the run when available.',
    },
    {
      name: 'create-work-item',
      description:
        'Create a new Azure DevOps work item (Issue, Task, or Epic) with the right fields. Use to file bugs, tasks, or features from another system.',
      content:
        '# Create Work Item\n\nFile a structured Azure DevOps work item.\n\n## Steps\n1. Choose the work item type: Issue, Task, or Epic, matching the request.\n2. Use Create Work Item with a clear title and an HTML or plain-text description.\n3. Set context fields where known: assignee, priority (1-4), area path, iteration path, and semicolon-separated tags.\n4. For a Task, set Activity, Remaining Work, and Completed Work; for an Epic, set Start Date and Target Date.\n\n## Output\nReturn the new work item id, type, title, state, and a link. Confirm the assignee and iteration. If a required field is missing, ask for it rather than guessing.',
    },
    {
      name: 'generate-release-notes',
      description:
        'Compile release notes from the work items completed between two Azure DevOps builds. Use at release time to summarize what shipped.',
      content:
        '# Generate Release Notes\n\nProduce release notes for a build range.\n\n## Steps\n1. Identify the From Build ID (previous release) and To Build ID (current release).\n2. Use Get Work Items Between Builds to list the associated work items.\n3. For each work item, use Get Work Items Batch or Get Work Item to pull title, type, and state.\n4. Group items by type (Features/Epics, Tasks, Bugs/Issues) and write a one-line summary per item.\n\n## Output\nReturn formatted Markdown release notes grouped by category, each line linking the work item id and title. Add a short headline summary of the most user-facing changes at the top.',
    },
    {
      name: 'report-pipeline-health',
      description:
        'Summarize recent Azure DevOps pipeline run results to surface pass rate and regressions. Use for daily or weekly engineering health reports.',
      content:
        '# Report Pipeline Health\n\nSummarize recent pipeline reliability.\n\n## Steps\n1. Use List Pipelines to enumerate the pipelines you care about.\n2. For each, use List Pipeline Runs to pull recent runs within your window.\n3. Compute pass rate (succeeded vs total), average duration, and the count of recent failures per pipeline.\n4. Flag pipelines whose pass rate dropped or whose duration increased noticeably versus prior runs.\n\n## Output\nReturn a per-pipeline summary table (name, pass rate, avg duration, recent failures) and a short narrative calling out regressions and any pipeline that is consistently red.',
    },
  ],
} as const satisfies BlockMeta

export const AzureDevOpsV2Block: BlockConfig = {
  ...AzureDevOpsBlock,
  type: 'azure_devops_v2',
  authMode: AuthMode.OAuth,
  hideFromToolbar: false,
  sunset: undefined,
  ...withSavedCredential(AzureDevOpsBlock, {
    id: 'credential',
    type: 'oauth-input',
    serviceId: 'azure_devops',
    title: 'Azure DevOps Credential',
  }),
}
