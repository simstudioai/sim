import { PlaneIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import { parsePlaneIdList } from '@/tools/plane/utils'

const WORK_ITEM_WRITE_OPS = ['plane_create_work_item', 'plane_update_work_item'] as const

const WORK_ITEM_SCOPED_OPS = [
  'plane_get_work_item',
  'plane_update_work_item',
  'plane_delete_work_item',
  'plane_create_comment',
  'plane_list_comments',
  'plane_update_comment',
  'plane_delete_comment',
  'plane_create_link',
  'plane_list_links',
  'plane_delete_link',
  'plane_list_attachments',
  'plane_upload_attachment',
  'plane_download_attachment',
  'plane_delete_attachment',
  'plane_list_activities',
] as const

const PROJECT_SCOPED_OPS = [
  ...WORK_ITEM_SCOPED_OPS,
  'plane_create_work_item',
  'plane_list_work_items',
  'plane_get_project',
  'plane_list_states',
  'plane_list_labels',
  'plane_create_label',
  'plane_list_project_members',
  'plane_list_cycles',
  'plane_add_work_items_to_cycle',
  'plane_list_modules',
  'plane_add_work_items_to_module',
] as const

const PAGINATED_OPS = [
  'plane_list_work_items',
  'plane_list_comments',
  'plane_list_links',
  'plane_list_activities',
  'plane_list_projects',
  'plane_list_states',
  'plane_list_labels',
  'plane_list_cycles',
  'plane_list_modules',
] as const

const DATE_WAND = {
  enabled: true,
  prompt:
    'Generate a date in YYYY-MM-DD format based on the user description. Return ONLY the date string, nothing else.',
  generationType: 'timestamp',
} as const

export const PlaneBlock: BlockConfig = {
  type: 'plane',
  name: 'Plane',
  description: 'Manage Plane work items, comments, attachments, cycles, and modules',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Plane, the open-source project management tool, into workflows. Create, update, search, and triage work items; post comments and links; upload and download attachments; plan cycles and modules; and look up projects, states, labels, and members. Works with Plane Cloud and self-hosted instances.',
  docsLink: 'https://docs.sim.ai/integrations/plane',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#3F76FF',
  icon: PlaneIcon,
  canvasPresentation: {
    defaultTitle: 'Plane',
    sentences: {
      byOperation: {
        plane_create_work_item: [
          { text: 'Create work item', field: 'name', core: true },
          { text: ', in project', field: 'projectId' },
        ],
        plane_get_work_item: [{ text: 'Read work item', field: 'workItemId', core: true }],
        plane_get_work_item_by_identifier: [
          { text: 'Read work item', field: 'identifier', core: true },
        ],
        plane_list_work_items: [
          { text: 'List work items in project', field: 'projectId', core: true },
        ],
        plane_search_work_items: [
          { text: 'Search work items for', field: 'query', core: true },
          { text: ', in project', field: 'projectId' },
        ],
        plane_update_work_item: [
          { text: 'Update work item', field: 'workItemId', core: true },
          { text: ', renaming it to', field: 'name' },
        ],
        plane_delete_work_item: [{ text: 'Delete work item', field: 'workItemId', core: true }],
        plane_create_comment: [
          { text: 'Comment', field: 'comment', core: true },
          { text: 'on work item', field: 'workItemId', core: true },
        ],
        plane_list_comments: [
          { text: 'List comments on work item', field: 'workItemId', core: true },
        ],
        plane_update_comment: [{ text: 'Edit comment', field: 'commentId', core: true }],
        plane_delete_comment: [{ text: 'Delete comment', field: 'commentId', core: true }],
        plane_create_link: [
          { text: 'Link', field: 'url', core: true },
          { text: 'to work item', field: 'workItemId', core: true },
        ],
        plane_list_links: [{ text: 'List links on work item', field: 'workItemId', core: true }],
        plane_delete_link: [{ text: 'Remove link', field: 'linkId', core: true }],
        plane_list_attachments: [
          { text: 'List attachments on work item', field: 'workItemId', core: true },
        ],
        plane_upload_attachment: [
          { text: 'Attach', field: ['uploadFile', 'fileRef'], core: true },
          { text: 'to work item', field: 'workItemId', core: true },
        ],
        plane_download_attachment: [
          { text: 'Download attachment', field: 'attachmentId', core: true },
        ],
        plane_delete_attachment: [{ text: 'Delete attachment', field: 'attachmentId', core: true }],
        plane_list_activities: [
          { text: 'Read history of work item', field: 'workItemId', core: true },
        ],
        plane_list_projects: ['List projects'],
        plane_get_project: [{ text: 'Read project', field: 'projectId', core: true }],
        plane_create_project: [
          { text: 'Create project', field: 'name', core: true },
          { text: ', with identifier', field: 'projectIdentifier' },
        ],
        plane_list_states: [{ text: 'List states in project', field: 'projectId', core: true }],
        plane_list_labels: [{ text: 'List labels in project', field: 'projectId', core: true }],
        plane_create_label: [
          { text: 'Create label', field: 'name', core: true },
          { text: ', in project', field: 'projectId' },
        ],
        plane_list_workspace_members: ['List workspace members'],
        plane_list_project_members: [
          { text: 'List members of project', field: 'projectId', core: true },
        ],
        plane_get_current_user: ['Read the user that owns the API key'],
        plane_list_cycles: [
          { text: 'List cycles in project', field: 'projectId', core: true },
          { text: ', showing', field: 'cycleView' },
        ],
        plane_add_work_items_to_cycle: [
          { text: 'Add', field: 'workItemIds', core: true },
          { text: 'to cycle', field: 'cycleId', core: true },
        ],
        plane_list_modules: [{ text: 'List modules in project', field: 'projectId', core: true }],
        plane_add_work_items_to_module: [
          { text: 'Add', field: 'workItemIds', core: true },
          { text: 'to module', field: 'moduleId', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Work Item', id: 'plane_create_work_item' },
        { label: 'Get Work Item', id: 'plane_get_work_item' },
        { label: 'Get Work Item by Identifier', id: 'plane_get_work_item_by_identifier' },
        { label: 'List Work Items', id: 'plane_list_work_items' },
        { label: 'Search Work Items', id: 'plane_search_work_items' },
        { label: 'Update Work Item', id: 'plane_update_work_item' },
        { label: 'Delete Work Item', id: 'plane_delete_work_item' },
        { label: 'Create Comment', id: 'plane_create_comment' },
        { label: 'List Comments', id: 'plane_list_comments' },
        { label: 'Update Comment', id: 'plane_update_comment' },
        { label: 'Delete Comment', id: 'plane_delete_comment' },
        { label: 'Add Link', id: 'plane_create_link' },
        { label: 'List Links', id: 'plane_list_links' },
        { label: 'Delete Link', id: 'plane_delete_link' },
        { label: 'List Attachments', id: 'plane_list_attachments' },
        { label: 'Upload Attachment', id: 'plane_upload_attachment' },
        { label: 'Download Attachment', id: 'plane_download_attachment' },
        { label: 'Delete Attachment', id: 'plane_delete_attachment' },
        { label: 'List Work Item Activity', id: 'plane_list_activities' },
        { label: 'List Projects', id: 'plane_list_projects' },
        { label: 'Get Project', id: 'plane_get_project' },
        { label: 'Create Project', id: 'plane_create_project' },
        { label: 'List States', id: 'plane_list_states' },
        { label: 'List Labels', id: 'plane_list_labels' },
        { label: 'Create Label', id: 'plane_create_label' },
        { label: 'List Workspace Members', id: 'plane_list_workspace_members' },
        { label: 'List Project Members', id: 'plane_list_project_members' },
        { label: 'Get Current User', id: 'plane_get_current_user' },
        { label: 'List Cycles', id: 'plane_list_cycles' },
        { label: 'Add Work Items to Cycle', id: 'plane_add_work_items_to_cycle' },
        { label: 'List Modules', id: 'plane_list_modules' },
        { label: 'Add Work Items to Module', id: 'plane_add_work_items_to_module' },
      ],
      value: () => 'plane_list_work_items',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Plane personal access token',
      password: true,
      required: true,
    },
    {
      id: 'workspaceSlug',
      title: 'Workspace Slug',
      type: 'short-input',
      placeholder: 'e.g., my-team (from app.plane.so/my-team/)',
      condition: { field: 'operation', value: 'plane_get_current_user', not: true },
      required: { field: 'operation', value: 'plane_get_current_user', not: true },
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Project UUID',
      condition: { field: 'operation', value: [...PROJECT_SCOPED_OPS, 'plane_search_work_items'] },
      required: { field: 'operation', value: [...PROJECT_SCOPED_OPS] },
    },
    {
      id: 'workItemId',
      title: 'Work Item ID',
      type: 'short-input',
      placeholder: 'Work item UUID',
      condition: { field: 'operation', value: [...WORK_ITEM_SCOPED_OPS] },
      required: { field: 'operation', value: [...WORK_ITEM_SCOPED_OPS] },
    },
    {
      id: 'identifier',
      title: 'Work Item Identifier',
      type: 'short-input',
      placeholder: 'e.g., PROJ-123',
      condition: { field: 'operation', value: 'plane_get_work_item_by_identifier' },
      required: { field: 'operation', value: 'plane_get_work_item_by_identifier' },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Name',
      condition: {
        field: 'operation',
        value: [...WORK_ITEM_WRITE_OPS, 'plane_create_project', 'plane_create_label'],
      },
      required: {
        field: 'operation',
        value: ['plane_create_work_item', 'plane_create_project', 'plane_create_label'],
      },
    },
    {
      id: 'projectIdentifier',
      title: 'Project Identifier',
      type: 'short-input',
      placeholder: 'e.g., ENG (work items become ENG-1, ENG-2, ...)',
      condition: { field: 'operation', value: 'plane_create_project' },
      required: { field: 'operation', value: 'plane_create_project' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Description (HTML for work items, e.g., <p>Steps to reproduce</p>)',
      condition: {
        field: 'operation',
        value: [...WORK_ITEM_WRITE_OPS, 'plane_create_project', 'plane_create_label'],
      },
    },
    {
      id: 'stateId',
      title: 'State ID',
      type: 'short-input',
      placeholder: 'State UUID (from List States)',
      condition: { field: 'operation', value: [...WORK_ITEM_WRITE_OPS] },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'dropdown',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Urgent', id: 'urgent' },
        { label: 'High', id: 'high' },
        { label: 'Medium', id: 'medium' },
        { label: 'Low', id: 'low' },
        { label: 'None', id: 'none' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...WORK_ITEM_WRITE_OPS] },
    },
    {
      id: 'assigneeIds',
      title: 'Assignee IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user UUIDs (replaces assignees on update)',
      condition: { field: 'operation', value: [...WORK_ITEM_WRITE_OPS] },
    },
    {
      id: 'labelIds',
      title: 'Label IDs',
      type: 'short-input',
      placeholder: 'Comma-separated label UUIDs (replaces labels on update)',
      condition: { field: 'operation', value: [...WORK_ITEM_WRITE_OPS] },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: [...WORK_ITEM_WRITE_OPS] },
      wandConfig: DATE_WAND,
    },
    {
      id: 'targetDate',
      title: 'Target Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: [...WORK_ITEM_WRITE_OPS] },
      wandConfig: DATE_WAND,
    },
    {
      id: 'parentId',
      title: 'Parent ID',
      type: 'short-input',
      placeholder: 'Parent work item or label UUID',
      mode: 'advanced',
      condition: { field: 'operation', value: [...WORK_ITEM_WRITE_OPS, 'plane_create_label'] },
    },
    {
      id: 'estimatePointId',
      title: 'Estimate Point ID',
      type: 'short-input',
      placeholder: 'Estimate point UUID',
      mode: 'advanced',
      condition: { field: 'operation', value: [...WORK_ITEM_WRITE_OPS] },
    },
    {
      id: 'typeId',
      title: 'Work Item Type ID',
      type: 'short-input',
      placeholder: 'Work item type UUID',
      mode: 'advanced',
      condition: { field: 'operation', value: [...WORK_ITEM_WRITE_OPS] },
    },
    {
      id: 'clearFields',
      title: 'Clear Fields',
      type: 'dropdown',
      multiSelect: true,
      options: [
        { label: 'Description', id: 'description' },
        { label: 'Assignees', id: 'assigneeIds' },
        { label: 'Labels', id: 'labelIds' },
        { label: 'Parent', id: 'parentId' },
        { label: 'Start Date', id: 'startDate' },
        { label: 'Target Date', id: 'targetDate' },
        { label: 'Estimate Point', id: 'estimatePointId' },
        { label: 'Work Item Type', id: 'typeId' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'plane_update_work_item' },
    },
    {
      id: 'externalSource',
      title: 'External Source',
      type: 'short-input',
      placeholder: 'e.g., github (deduplicates with External ID)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['plane_create_work_item', 'plane_create_comment'] },
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'ID in the external system',
      mode: 'advanced',
      condition: { field: 'operation', value: ['plane_create_work_item', 'plane_create_comment'] },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Title text, sequence number, or project identifier',
      condition: { field: 'operation', value: 'plane_search_work_items' },
      required: { field: 'operation', value: 'plane_search_work_items' },
    },
    {
      id: 'limit',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10',
      mode: 'advanced',
      condition: { field: 'operation', value: 'plane_search_work_items' },
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Comment UUID',
      condition: { field: 'operation', value: ['plane_update_comment', 'plane_delete_comment'] },
      required: { field: 'operation', value: ['plane_update_comment', 'plane_delete_comment'] },
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Comment as HTML, e.g., <p>Fixed in the latest release</p>',
      condition: { field: 'operation', value: ['plane_create_comment', 'plane_update_comment'] },
      required: { field: 'operation', value: ['plane_create_comment', 'plane_update_comment'] },
    },
    {
      id: 'access',
      title: 'Comment Visibility',
      type: 'dropdown',
      options: [
        { label: 'Internal', id: 'INTERNAL' },
        { label: 'External', id: 'EXTERNAL' },
      ],
      value: () => 'INTERNAL',
      mode: 'advanced',
      condition: { field: 'operation', value: 'plane_create_comment' },
    },
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'https://github.com/org/repo/pull/42',
      condition: { field: 'operation', value: 'plane_create_link' },
      required: { field: 'operation', value: 'plane_create_link' },
    },
    {
      id: 'title',
      title: 'Link Title',
      type: 'short-input',
      placeholder: 'Display title',
      condition: { field: 'operation', value: 'plane_create_link' },
    },
    {
      id: 'linkId',
      title: 'Link ID',
      type: 'short-input',
      placeholder: 'Link UUID',
      condition: { field: 'operation', value: 'plane_delete_link' },
      required: { field: 'operation', value: 'plane_delete_link' },
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload file',
      mode: 'basic',
      multiple: false,
      required: true,
      condition: { field: 'operation', value: 'plane_upload_attachment' },
    },
    {
      id: 'fileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'File reference from a previous block',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'plane_upload_attachment' },
    },
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      placeholder: 'Attachment UUID (from List Attachments)',
      condition: {
        field: 'operation',
        value: ['plane_download_attachment', 'plane_delete_attachment'],
      },
      required: {
        field: 'operation',
        value: ['plane_download_attachment', 'plane_delete_attachment'],
      },
    },
    {
      id: 'projectLeadId',
      title: 'Project Lead ID',
      type: 'short-input',
      placeholder: 'User UUID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'plane_create_project' },
    },
    {
      id: 'defaultAssigneeId',
      title: 'Default Assignee ID',
      type: 'short-input',
      placeholder: 'User UUID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'plane_create_project' },
    },
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'e.g., America/New_York (defaults to UTC)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'plane_create_project' },
    },
    {
      id: 'color',
      title: 'Color',
      type: 'short-input',
      placeholder: 'Hex color, e.g., #EF4444',
      condition: { field: 'operation', value: 'plane_create_label' },
    },
    {
      id: 'cycleView',
      title: 'Cycles to Show',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Current', id: 'current' },
        { label: 'Upcoming', id: 'upcoming' },
        { label: 'Completed', id: 'completed' },
        { label: 'Draft', id: 'draft' },
        { label: 'Incomplete', id: 'incomplete' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'plane_list_cycles' },
    },
    {
      id: 'cycleId',
      title: 'Cycle ID',
      type: 'short-input',
      placeholder: 'Cycle UUID',
      condition: { field: 'operation', value: 'plane_add_work_items_to_cycle' },
      required: { field: 'operation', value: 'plane_add_work_items_to_cycle' },
    },
    {
      id: 'moduleId',
      title: 'Module ID',
      type: 'short-input',
      placeholder: 'Module UUID',
      condition: { field: 'operation', value: 'plane_add_work_items_to_module' },
      required: { field: 'operation', value: 'plane_add_work_items_to_module' },
    },
    {
      id: 'workItemIds',
      title: 'Work Item IDs',
      type: 'short-input',
      placeholder: 'Comma-separated work item UUIDs',
      condition: {
        field: 'operation',
        value: ['plane_add_work_items_to_cycle', 'plane_add_work_items_to_module'],
      },
      required: {
        field: 'operation',
        value: ['plane_add_work_items_to_cycle', 'plane_add_work_items_to_module'],
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'e.g., -created_at, priority, target_date',
      mode: 'advanced',
      condition: { field: 'operation', value: ['plane_list_work_items', 'plane_list_projects'] },
    },
    {
      id: 'perPage',
      title: 'Results per Page',
      type: 'short-input',
      placeholder: '1-100 (default 100)',
      mode: 'advanced',
      condition: { field: 'operation', value: [...PAGINATED_OPS] },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous response',
      mode: 'advanced',
      condition: { field: 'operation', value: [...PAGINATED_OPS] },
    },
    {
      id: 'baseUrl',
      title: 'Self-Hosted URL',
      type: 'short-input',
      placeholder: 'https://plane.example.com (leave empty for Plane Cloud)',
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'plane_create_work_item',
      'plane_get_work_item',
      'plane_get_work_item_by_identifier',
      'plane_list_work_items',
      'plane_search_work_items',
      'plane_update_work_item',
      'plane_delete_work_item',
      'plane_create_comment',
      'plane_list_comments',
      'plane_update_comment',
      'plane_delete_comment',
      'plane_create_link',
      'plane_list_links',
      'plane_delete_link',
      'plane_list_attachments',
      'plane_upload_attachment',
      'plane_download_attachment',
      'plane_delete_attachment',
      'plane_list_activities',
      'plane_list_projects',
      'plane_get_project',
      'plane_create_project',
      'plane_list_states',
      'plane_list_labels',
      'plane_create_label',
      'plane_list_workspace_members',
      'plane_list_project_members',
      'plane_get_current_user',
      'plane_list_cycles',
      'plane_add_work_items_to_cycle',
      'plane_list_modules',
      'plane_add_work_items_to_module',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const {
          operation,
          file,
          perPage,
          limit,
          assigneeIds,
          labelIds,
          workItemIds,
          clearFields,
          projectIdentifier,
          ...rest
        } = params
        const result: Record<string, unknown> = { ...rest }

        if (perPage !== undefined && perPage !== null && perPage !== '') {
          result.perPage = Number(perPage)
        }
        if (limit !== undefined && limit !== null && limit !== '') {
          result.limit = Number(limit)
        }
        const assignees = parsePlaneIdList(assigneeIds)
        if (assignees) result.assigneeIds = assignees
        const labels = parsePlaneIdList(labelIds)
        if (labels) result.labelIds = labels
        const items = parsePlaneIdList(workItemIds)
        if (items) result.workItemIds = items
        const fieldsToClear = parsePlaneIdList(clearFields)
        if (fieldsToClear) result.clearFields = fieldsToClear

        if (
          operation === 'plane_create_project' &&
          typeof projectIdentifier === 'string' &&
          projectIdentifier.trim()
        ) {
          result.identifier = projectIdentifier
        }
        if (operation === 'plane_upload_attachment') {
          const normalizedFile = normalizeFileInput(file, { single: true })
          if (!normalizedFile) throw new Error('A file is required to upload an attachment.')
          result.file = normalizedFile
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Plane personal access token' },
    workspaceSlug: { type: 'string', description: 'Workspace slug' },
    baseUrl: { type: 'string', description: 'Self-hosted Plane URL (defaults to Plane Cloud)' },
    projectId: { type: 'string', description: 'Project ID' },
    workItemId: { type: 'string', description: 'Work item ID' },
    identifier: { type: 'string', description: 'Work item identifier (e.g., PROJ-123)' },
    projectIdentifier: { type: 'string', description: 'New project identifier (e.g., ENG)' },
    name: { type: 'string', description: 'Work item, project, or label name' },
    description: { type: 'string', description: 'Description (HTML for work items)' },
    stateId: { type: 'string', description: 'State ID' },
    priority: { type: 'string', description: 'Priority (urgent, high, medium, low, none)' },
    assigneeIds: { type: 'string', description: 'Comma-separated assignee user IDs' },
    labelIds: { type: 'string', description: 'Comma-separated label IDs' },
    startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
    targetDate: { type: 'string', description: 'Target date (YYYY-MM-DD)' },
    parentId: { type: 'string', description: 'Parent work item ID, or parent label ID for labels' },
    estimatePointId: { type: 'string', description: 'Estimate point ID' },
    typeId: { type: 'string', description: 'Work item type ID' },
    externalSource: { type: 'string', description: 'External system name' },
    externalId: { type: 'string', description: 'ID in the external system' },
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Maximum search results' },
    commentId: { type: 'string', description: 'Comment ID' },
    comment: { type: 'string', description: 'Comment body (HTML)' },
    access: { type: 'string', description: 'Comment visibility (INTERNAL or EXTERNAL)' },
    url: { type: 'string', description: 'URL to link' },
    title: { type: 'string', description: 'Link title' },
    linkId: { type: 'string', description: 'Link ID' },
    file: { type: 'json', description: 'File to upload (UserFile or reference)' },
    attachmentId: { type: 'string', description: 'Attachment ID' },
    projectLeadId: { type: 'string', description: 'Project lead user ID' },
    defaultAssigneeId: { type: 'string', description: 'Default assignee user ID' },
    timezone: { type: 'string', description: 'Project timezone' },
    color: { type: 'string', description: 'Label color (hex)' },
    cycleView: { type: 'string', description: 'Which cycles to list' },
    cycleId: { type: 'string', description: 'Cycle ID' },
    moduleId: { type: 'string', description: 'Module ID' },
    workItemIds: { type: 'string', description: 'Comma-separated work item IDs' },
    clearFields: { type: 'json', description: 'Work item fields to clear on update' },
    orderBy: { type: 'string', description: 'Sort field' },
    perPage: { type: 'number', description: 'Results per page' },
    cursor: { type: 'string', description: 'Pagination cursor' },
  },

  outputs: {
    workItem: {
      type: 'json',
      description:
        'Work item (id, name, descriptionHtml, priority, stateId, assigneeIds, labelIds, sequenceId, startDate, targetDate, projectId, createdAt, updatedAt)',
    },
    workItems: { type: 'json', description: 'Work items on this page' },
    results: {
      type: 'json',
      description:
        'Search results (id, name, sequenceId, projectIdentifier, identifier, projectId)',
    },
    comment: {
      type: 'json',
      description: 'Comment (id, commentHtml, access, actorId, workItemId, createdAt)',
    },
    comments: { type: 'json', description: 'Comments on this page' },
    link: { type: 'json', description: 'Link (id, title, url, workItemId, createdAt)' },
    links: { type: 'json', description: 'Links on this page' },
    attachment: {
      type: 'json',
      description: 'Uploaded attachment (id, name, type, size, isUploaded, workItemId)',
    },
    attachments: { type: 'json', description: 'Attachments on the work item' },
    file: { type: 'file', description: 'Downloaded attachment file' },
    activities: { type: 'json', description: 'Work item activity entries' },
    project: {
      type: 'json',
      description:
        'Project (id, name, identifier, description, totalMembers, cycleView, moduleView)',
    },
    projects: { type: 'json', description: 'Projects on this page' },
    states: { type: 'json', description: 'States (id, name, color, group, isDefault)' },
    label: { type: 'json', description: 'Label (id, name, color, description, parentId)' },
    labels: { type: 'json', description: 'Labels on this page' },
    members: {
      type: 'json',
      description: 'Members (id, displayName, email, firstName, lastName, role for workspaces)',
    },
    user: { type: 'json', description: 'Authenticated user (id, displayName, email)' },
    cycles: {
      type: 'json',
      description: 'Cycles (id, name, startDate, endDate, totalIssues, completedIssues)',
    },
    modules: {
      type: 'json',
      description: 'Modules (id, name, status, startDate, targetDate, totalIssues)',
    },
    workItemIds: { type: 'json', description: 'IDs of all work items in the cycle or module' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    id: { type: 'string', description: 'ID of the deleted resource' },
    nextCursor: { type: 'string', description: 'Cursor for the next page' },
    prevCursor: { type: 'string', description: 'Cursor for the previous page' },
    nextPageResults: { type: 'boolean', description: 'Whether more results exist' },
    prevPageResults: { type: 'boolean', description: 'Whether earlier results exist' },
    count: { type: 'number', description: 'Number of results on this page' },
    totalPages: { type: 'number', description: 'Total number of pages' },
    totalResults: { type: 'number', description: 'Total number of results' },
  },
}

export const PlaneBlockMeta = {
  tags: ['project-management', 'ticketing', 'automation'],
  url: 'https://plane.so',
  templates: [
    {
      icon: PlaneIcon,
      title: 'Plane bug intake from Slack',
      prompt:
        'Build a workflow that turns bug reports posted in a Slack channel into Plane work items with a clear title, an HTML description of the steps to reproduce, the right priority and the "bug" label, then replies in the thread with the work item identifier.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['triage', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PlaneIcon,
      title: 'Plane triage agent',
      prompt:
        'Create a scheduled workflow that lists new work items in a Plane project, reads each description, sets priority and labels, assigns an owner from the project members, and leaves a comment explaining the triage decision.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['triage', 'automation'],
    },
    {
      icon: PlaneIcon,
      title: 'Plane cycle progress digest',
      prompt:
        'Build a weekday workflow that reads the current Plane cycle, summarizes completed, started, and backlog work item counts, highlights overdue items by target date, and posts the digest to the team channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['reporting', 'team'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PlaneIcon,
      title: 'Link GitHub PRs to Plane',
      prompt:
        'Create a workflow that, when a GitHub pull request is opened, finds the Plane work item referenced in the PR title (like ENG-42), adds the PR as a link on the work item, and comments with the PR summary.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: PlaneIcon,
      title: 'Plane support escalation',
      prompt:
        'Build a workflow that takes an escalated support ticket, creates a Plane work item with the customer context, attaches the ticket transcript as a file, and sets the external source and ID so repeat escalations do not create duplicates.',
      modules: ['agent', 'workflows', 'files'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: PlaneIcon,
      title: 'Plane sprint planner',
      prompt:
        'Create an agent that reviews the open work items in a Plane project, picks the highest-priority items that fit the team capacity, and adds them to the upcoming cycle, then reports what was planned and why.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['planning', 'team'],
    },
    {
      icon: PlaneIcon,
      title: 'Plane work item to table export',
      prompt:
        'Build a scheduled workflow that pages through all work items in a Plane project and writes their identifier, title, state, priority, assignees, and target date into a table for reporting.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'sync'],
    },
  ],
  skills: [
    {
      name: 'triage-plane-work-item',
      description:
        'Classify a new Plane work item, set priority, labels, and an owner, and explain the decision in a comment.',
      content:
        '# Triage Plane Work Item\n\nTriage an incoming Plane work item so it lands with the right priority, labels, and owner.\n\n## Steps\n1. Get Work Item (or Get Work Item by Identifier) to read the title and description.\n2. List Labels and List Project Members for the project to see the available labels and assignees.\n3. Decide the priority (urgent, high, medium, low, none), the labels, and the owner from the content.\n4. Update Work Item with the priority, labelIds, and assigneeIds.\n5. Create Comment summarizing the classification and the next step.\n\n## Output\nThe work item identifier, the priority, labels, and assignee set, and the triage comment posted.',
    },
    {
      name: 'file-plane-bug-report',
      description:
        'Turn a bug report from chat or email into a well-formed Plane work item without creating duplicates.',
      content:
        '# File Plane Bug Report\n\nCreate a Plane work item from a raw bug report.\n\n## Steps\n1. Search Work Items for the key phrase to check whether the bug is already filed.\n2. If a match exists, Create Comment on it with the new report instead of filing a duplicate.\n3. Otherwise List Labels to find the bug label, then Create Work Item with a concise title, an HTML description (steps to reproduce, expected, actual), priority, and the bug label.\n4. If the report came with a screenshot or log, Upload Attachment to the new work item.\n\n## Output\nThe identifier of the new or existing work item and whether it was created or commented on.',
    },
    {
      name: 'summarize-plane-cycle',
      description:
        'Summarize progress of the current Plane cycle with completed, in-progress, and blocked work.',
      content:
        '# Summarize Plane Cycle\n\nReport on the active cycle for stakeholders.\n\n## Steps\n1. List Cycles with cycleView set to current to find the active cycle and its work item counts.\n2. List Work Items for the project and List States to map each stateId to its group.\n3. Group the cycle work items into completed, started, and not started, and flag items past their target date.\n4. Write a short summary with the completion ratio and the top risks.\n\n## Output\nA cycle summary: name and dates, counts by status, overdue items, and risks.',
    },
    {
      name: 'link-pr-to-plane-work-item',
      description:
        'Attach a pull request or document URL to the Plane work item it references and note it in a comment.',
      content:
        '# Link PR to Plane Work Item\n\nKeep Plane work items connected to the code that resolves them.\n\n## Steps\n1. Extract the work item identifier (for example ENG-42) from the pull request title or branch.\n2. Get Work Item by Identifier to resolve it to a work item and project ID.\n3. Add Link with the pull request URL and title.\n4. Create Comment noting the pull request and its status.\n\n## Output\nThe work item identifier, the link added, and the comment posted.',
    },
    {
      name: 'plan-plane-cycle',
      description:
        'Pick the highest-priority open Plane work items and add them to the upcoming cycle.',
      content:
        '# Plan Plane Cycle\n\nFill the next cycle with the most important open work.\n\n## Steps\n1. List Cycles with cycleView set to upcoming and pick the next cycle.\n2. List Work Items ordered by priority and List States to skip completed or cancelled items.\n3. Choose the items that fit the stated capacity.\n4. Add Work Items to Cycle with the chosen work item IDs.\n\n## Output\nThe cycle name and the list of work items added, with the reason each was chosen.',
    },
  ],
} as const satisfies BlockMeta
