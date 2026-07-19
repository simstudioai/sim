import { MondayIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type {
  MondayArchiveItemResponse,
  MondayChangeColumnValueResponse,
  MondayCreateBoardResponse,
  MondayCreateColumnResponse,
  MondayCreateGroupResponse,
  MondayCreateItemResponse,
  MondayCreateSubitemResponse,
  MondayCreateUpdateResponse,
  MondayDeleteItemResponse,
  MondayDuplicateItemResponse,
  MondayGetBoardResponse,
  MondayGetGroupsResponse,
  MondayGetItemResponse,
  MondayGetItemsResponse,
  MondayListBoardsResponse,
  MondayMoveItemToGroupResponse,
  MondaySearchItemsResponse,
  MondayUpdateItemResponse,
} from '@/tools/monday/types'
import { getTrigger } from '@/triggers'

type MondayResponse =
  | MondayListBoardsResponse
  | MondayGetBoardResponse
  | MondayGetItemResponse
  | MondayGetItemsResponse
  | MondayCreateItemResponse
  | MondayUpdateItemResponse
  | MondayDeleteItemResponse
  | MondayArchiveItemResponse
  | MondayCreateUpdateResponse
  | MondayCreateGroupResponse
  | MondaySearchItemsResponse
  | MondayCreateSubitemResponse
  | MondayMoveItemToGroupResponse
  | MondayChangeColumnValueResponse
  | MondayCreateBoardResponse
  | MondayCreateColumnResponse
  | MondayGetGroupsResponse
  | MondayDuplicateItemResponse

const BOARD_OPS = [
  'get_board',
  'get_items',
  'search_items',
  'create_item',
  'update_item',
  'create_group',
  'get_groups',
  'create_column',
  'change_column_value',
  'duplicate_item',
]

const ITEM_ID_OPS = [
  'get_item',
  'update_item',
  'delete_item',
  'archive_item',
  'create_update',
  'move_item_to_group',
  'change_column_value',
  'duplicate_item',
]

export const MondayBlock: BlockConfig<MondayResponse> = {
  type: 'monday',
  name: 'Monday',
  description: 'Manage Monday.com boards, items, and groups',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate with Monday.com to list boards, get board details, fetch and search items, create and update items, archive or delete items, create subitems, move items between groups, add updates, and create groups.',
  docsLink: 'https://docs.sim.ai/integrations/monday',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#FFFFFF',
  icon: MondayIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Boards', id: 'list_boards' },
        { label: 'Get Board', id: 'get_board' },
        { label: 'Get Item', id: 'get_item' },
        { label: 'Get Items', id: 'get_items' },
        { label: 'Search Items', id: 'search_items' },
        { label: 'Create Item', id: 'create_item' },
        { label: 'Update Item', id: 'update_item' },
        { label: 'Change Column Value', id: 'change_column_value' },
        { label: 'Duplicate Item', id: 'duplicate_item' },
        { label: 'Delete Item', id: 'delete_item' },
        { label: 'Archive Item', id: 'archive_item' },
        { label: 'Move Item to Group', id: 'move_item_to_group' },
        { label: 'Create Subitem', id: 'create_subitem' },
        { label: 'Create Update', id: 'create_update' },
        { label: 'Create Group', id: 'create_group' },
        { label: 'Get Groups', id: 'get_groups' },
        { label: 'Create Board', id: 'create_board' },
        { label: 'Create Column', id: 'create_column' },
      ],
      value: () => 'list_boards',
    },
    {
      id: 'credential',
      title: 'Monday Account',
      type: 'oauth-input',
      serviceId: 'monday',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      requiredScopes: getScopesForService('monday'),
      placeholder: 'Select Monday.com account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Monday Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    // Board selector (basic mode)
    {
      id: 'boardSelector',
      title: 'Board',
      type: 'project-selector',
      canonicalParamId: 'boardId',
      serviceId: 'monday',
      selectorKey: 'monday.boards',
      placeholder: 'Select a board',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: BOARD_OPS },
      required: { field: 'operation', value: BOARD_OPS },
    },
    // Board ID (advanced mode)
    {
      id: 'manualBoardId',
      title: 'Board ID',
      type: 'short-input',
      canonicalParamId: 'boardId',
      placeholder: 'Enter board ID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: BOARD_OPS },
      required: { field: 'operation', value: BOARD_OPS },
    },
    {
      id: 'itemId',
      title: 'Item ID',
      type: 'short-input',
      placeholder: 'Enter item ID',
      condition: { field: 'operation', value: ITEM_ID_OPS },
      required: { field: 'operation', value: ITEM_ID_OPS },
    },
    {
      id: 'parentItemId',
      title: 'Parent Item ID',
      type: 'short-input',
      placeholder: 'Enter parent item ID',
      condition: { field: 'operation', value: 'create_subitem' },
      required: { field: 'operation', value: 'create_subitem' },
    },
    {
      id: 'itemName',
      title: 'Item Name',
      type: 'short-input',
      placeholder: 'Enter item name',
      condition: { field: 'operation', value: ['create_item', 'create_subitem'] },
      required: { field: 'operation', value: ['create_item', 'create_subitem'] },
    },
    // Group selector (basic mode)
    {
      id: 'groupSelector',
      title: 'Group',
      type: 'project-selector',
      canonicalParamId: 'groupId',
      serviceId: 'monday',
      selectorKey: 'monday.groups',
      placeholder: 'Select a group',
      dependsOn: ['credential', 'boardSelector'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['get_items', 'create_item', 'move_item_to_group'],
      },
      required: { field: 'operation', value: 'move_item_to_group' },
    },
    // Group ID (advanced mode)
    {
      id: 'manualGroupId',
      title: 'Group ID',
      type: 'short-input',
      canonicalParamId: 'groupId',
      placeholder: 'Enter group ID',
      dependsOn: ['credential', 'boardId'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_items', 'create_item', 'move_item_to_group'],
      },
      required: { field: 'operation', value: 'move_item_to_group' },
    },
    {
      id: 'searchColumns',
      title: 'Column Filters',
      type: 'long-input',
      placeholder: '[{"column_id":"status","column_values":["Done"]}]',
      condition: { field: 'operation', value: 'search_items' },
      required: { field: 'operation', value: 'search_items' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Monday.com column filters. Each object needs column_id and column_values array. Return ONLY the JSON array - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'columnValues',
      title: 'Column Values',
      type: 'long-input',
      placeholder: '{"status":"Done","date":"2024-01-01"}',
      condition: {
        field: 'operation',
        value: ['create_item', 'update_item', 'create_subitem'],
      },
      required: { field: 'operation', value: 'update_item' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of Monday.com column values. Keys are column IDs and values depend on column type. Return ONLY the JSON object string - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'updateBody',
      title: 'Update Text',
      type: 'long-input',
      placeholder: 'Enter update text (supports HTML)',
      condition: { field: 'operation', value: 'create_update' },
      required: { field: 'operation', value: 'create_update' },
    },
    {
      id: 'groupName',
      title: 'Group Name',
      type: 'short-input',
      placeholder: 'Enter group name',
      condition: { field: 'operation', value: 'create_group' },
      required: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'groupColor',
      title: 'Group Color',
      type: 'short-input',
      placeholder: '#ff642e',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'columnId',
      title: 'Column ID',
      type: 'short-input',
      placeholder: 'Enter column ID (e.g., status)',
      condition: { field: 'operation', value: 'change_column_value' },
      required: { field: 'operation', value: 'change_column_value' },
    },
    {
      id: 'columnValue',
      title: 'Column Value',
      type: 'long-input',
      placeholder: '{"label":"Done"}',
      condition: { field: 'operation', value: 'change_column_value' },
      required: { field: 'operation', value: 'change_column_value' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON value for a single Monday.com column. The shape depends on the column type (e.g., {"label":"Done"} for status, {"date":"2024-01-01"} for date). Return ONLY the JSON value - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'createLabelsIfMissing',
      title: 'Create Labels If Missing',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'change_column_value' },
    },
    {
      id: 'withUpdates',
      title: 'Include Updates',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'duplicate_item' },
    },
    {
      id: 'boardName',
      title: 'Board Name',
      type: 'short-input',
      placeholder: 'Enter board name',
      condition: { field: 'operation', value: 'create_board' },
      required: { field: 'operation', value: 'create_board' },
    },
    {
      id: 'boardKind',
      title: 'Board Kind',
      type: 'dropdown',
      options: [
        { label: 'Public', id: 'public' },
        { label: 'Private', id: 'private' },
        { label: 'Shareable', id: 'share' },
      ],
      value: () => 'public',
      condition: { field: 'operation', value: 'create_board' },
      required: { field: 'operation', value: 'create_board' },
    },
    {
      id: 'boardDescription',
      title: 'Board Description',
      type: 'long-input',
      placeholder: 'Enter board description',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_board' },
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Enter workspace ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_board' },
    },
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'Enter folder ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_board' },
    },
    {
      id: 'columnTitle',
      title: 'Column Title',
      type: 'short-input',
      placeholder: 'Enter column title',
      condition: { field: 'operation', value: 'create_column' },
      required: { field: 'operation', value: 'create_column' },
    },
    {
      id: 'columnType',
      title: 'Column Type',
      type: 'dropdown',
      options: [
        { label: 'Status', id: 'status' },
        { label: 'Text', id: 'text' },
        { label: 'Long Text', id: 'long_text' },
        { label: 'Numbers', id: 'numbers' },
        { label: 'Date', id: 'date' },
        { label: 'People', id: 'people' },
        { label: 'Dropdown', id: 'dropdown' },
        { label: 'Checkbox', id: 'checkbox' },
        { label: 'Email', id: 'email' },
        { label: 'Phone', id: 'phone' },
        { label: 'Link', id: 'link' },
        { label: 'Timeline', id: 'timeline' },
        { label: 'Tags', id: 'tags' },
        { label: 'Rating', id: 'rating' },
        { label: 'Country', id: 'country' },
      ],
      value: () => 'text',
      condition: { field: 'operation', value: 'create_column' },
      required: { field: 'operation', value: 'create_column' },
    },
    {
      id: 'columnDescription',
      title: 'Column Description',
      type: 'long-input',
      placeholder: 'Enter column description',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_column' },
    },
    {
      id: 'columnDefaults',
      title: 'Column Defaults',
      type: 'long-input',
      placeholder: '{"labels":{"0":"To Do","1":"Done"}}',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_column' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of default settings for a Monday.com column (e.g., status labels). Return ONLY the JSON object string - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (default 25)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['list_boards', 'get_items', 'search_items'],
      },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (starts at 1)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_boards' },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous search',
      mode: 'advanced',
      condition: { field: 'operation', value: 'search_items' },
    },
    ...getTrigger('monday_item_created').subBlocks,
    ...getTrigger('monday_column_changed').subBlocks,
    ...getTrigger('monday_status_changed').subBlocks,
    ...getTrigger('monday_item_name_changed').subBlocks,
    ...getTrigger('monday_item_archived').subBlocks,
    ...getTrigger('monday_item_deleted').subBlocks,
    ...getTrigger('monday_item_moved').subBlocks,
    ...getTrigger('monday_subitem_created').subBlocks,
    ...getTrigger('monday_update_created').subBlocks,
  ],
  tools: {
    access: [
      'monday_list_boards',
      'monday_get_board',
      'monday_get_item',
      'monday_get_items',
      'monday_search_items',
      'monday_create_item',
      'monday_update_item',
      'monday_change_column_value',
      'monday_duplicate_item',
      'monday_delete_item',
      'monday_archive_item',
      'monday_move_item_to_group',
      'monday_create_subitem',
      'monday_create_update',
      'monday_create_group',
      'monday_get_groups',
      'monday_create_board',
      'monday_create_column',
    ],
    config: {
      tool: (params) => {
        const op = typeof params.operation === 'string' ? params.operation.trim() : 'list_boards'
        return `monday_${op}`
      },
      params: (params) => {
        const baseParams: Record<string, unknown> = {
          oauthCredential: params.oauthCredential,
        }
        const op = typeof params.operation === 'string' ? params.operation.trim() : 'list_boards'

        switch (op) {
          case 'list_boards':
            return {
              ...baseParams,
              limit: params.limit ? Number(params.limit) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }
          case 'get_board':
            return { ...baseParams, boardId: params.boardId }
          case 'get_item':
            return { ...baseParams, itemId: params.itemId }
          case 'get_items':
            return {
              ...baseParams,
              boardId: params.boardId,
              groupId: params.groupId || undefined,
              limit: params.limit ? Number(params.limit) : undefined,
            }
          case 'search_items':
            return {
              ...baseParams,
              boardId: params.boardId,
              columns: params.searchColumns,
              limit: params.limit ? Number(params.limit) : undefined,
              cursor: params.cursor || undefined,
            }
          case 'create_item':
            return {
              ...baseParams,
              boardId: params.boardId,
              itemName: params.itemName,
              groupId: params.groupId || undefined,
              columnValues: params.columnValues || undefined,
            }
          case 'update_item':
            return {
              ...baseParams,
              boardId: params.boardId,
              itemId: params.itemId,
              columnValues: params.columnValues,
            }
          case 'change_column_value':
            return {
              ...baseParams,
              boardId: params.boardId,
              itemId: params.itemId,
              columnId: params.columnId,
              value: params.columnValue,
              createLabelsIfMissing: Boolean(params.createLabelsIfMissing),
            }
          case 'duplicate_item':
            return {
              ...baseParams,
              boardId: params.boardId,
              itemId: params.itemId,
              withUpdates: Boolean(params.withUpdates),
            }
          case 'create_board':
            return {
              ...baseParams,
              boardName: params.boardName,
              boardKind: params.boardKind || 'public',
              description: params.boardDescription || undefined,
              workspaceId: params.workspaceId || undefined,
              folderId: params.folderId || undefined,
            }
          case 'create_column':
            return {
              ...baseParams,
              boardId: params.boardId,
              columnTitle: params.columnTitle,
              columnType: params.columnType || 'text',
              columnDescription: params.columnDescription || undefined,
              columnDefaults: params.columnDefaults || undefined,
            }
          case 'get_groups':
            return { ...baseParams, boardId: params.boardId }
          case 'delete_item':
            return { ...baseParams, itemId: params.itemId }
          case 'archive_item':
            return { ...baseParams, itemId: params.itemId }
          case 'move_item_to_group':
            return {
              ...baseParams,
              itemId: params.itemId,
              groupId: params.groupId,
            }
          case 'create_subitem':
            return {
              ...baseParams,
              parentItemId: params.parentItemId,
              itemName: params.itemName,
              columnValues: params.columnValues || undefined,
            }
          case 'create_update':
            return {
              ...baseParams,
              itemId: params.itemId,
              body: params.updateBody,
            }
          case 'create_group':
            return {
              ...baseParams,
              boardId: params.boardId,
              groupName: params.groupName,
              groupColor: params.groupColor || undefined,
            }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Monday.com operation to perform' },
    oauthCredential: { type: 'string', description: 'Monday.com OAuth credential' },
    boardId: { type: 'string', description: 'Board ID' },
    itemId: { type: 'string', description: 'Item ID' },
    parentItemId: { type: 'string', description: 'Parent item ID for subitems' },
    itemName: { type: 'string', description: 'Item name for creation' },
    groupId: { type: 'string', description: 'Group ID' },
    searchColumns: { type: 'string', description: 'JSON array of column filters for search' },
    columnValues: { type: 'string', description: 'JSON string of column values' },
    columnId: { type: 'string', description: 'Single column ID to change' },
    columnValue: { type: 'string', description: 'JSON value for a single column' },
    createLabelsIfMissing: {
      type: 'boolean',
      description: 'Create status/dropdown labels that do not yet exist',
    },
    withUpdates: { type: 'boolean', description: 'Include item updates when duplicating' },
    boardName: { type: 'string', description: 'Board name for creation' },
    boardKind: { type: 'string', description: 'Board kind (public, private, share)' },
    boardDescription: { type: 'string', description: 'Board description' },
    workspaceId: { type: 'string', description: 'Workspace ID for board creation' },
    folderId: { type: 'string', description: 'Folder ID for board creation' },
    columnTitle: { type: 'string', description: 'Column title for creation' },
    columnType: { type: 'string', description: 'Column type for creation' },
    columnDescription: { type: 'string', description: 'Column description' },
    columnDefaults: { type: 'string', description: 'JSON defaults for the new column' },
    updateBody: { type: 'string', description: 'Update text content' },
    groupName: { type: 'string', description: 'Group name' },
    groupColor: { type: 'string', description: 'Group color hex code' },
    limit: { type: 'number', description: 'Maximum number of results' },
    page: { type: 'number', description: 'Page number for pagination' },
    cursor: { type: 'string', description: 'Pagination cursor for search' },
  },
  outputs: {
    boards: {
      type: 'json',
      description:
        'List of boards (id, name, description, state, boardKind, itemsCount, url, updatedAt)',
      condition: { field: 'operation', value: 'list_boards' },
    },
    board: {
      type: 'json',
      description:
        'Board details (id, name, description, state, boardKind, itemsCount, url, updatedAt)',
      condition: { field: 'operation', value: ['get_board', 'create_board'] },
    },
    groups: {
      type: 'json',
      description: 'Board groups (id, title, color, archived, deleted, position)',
      condition: { field: 'operation', value: ['get_board', 'get_groups'] },
    },
    columns: {
      type: 'json',
      description: 'Board columns (id, title, type)',
      condition: { field: 'operation', value: 'get_board' },
    },
    column: {
      type: 'json',
      description: 'Created column (id, title, type)',
      condition: { field: 'operation', value: 'create_column' },
    },
    items: {
      type: 'json',
      description:
        'List of items (id, name, state, boardId, groupId, groupTitle, columnValues, createdAt, updatedAt, url)',
      condition: { field: 'operation', value: ['get_items', 'search_items'] },
    },
    item: {
      type: 'json',
      description:
        'Item details (id, name, state, boardId, groupId, groupTitle, columnValues, createdAt, updatedAt, url)',
      condition: {
        field: 'operation',
        value: [
          'get_item',
          'create_item',
          'update_item',
          'create_subitem',
          'move_item_to_group',
          'change_column_value',
          'duplicate_item',
        ],
      },
    },
    id: {
      type: 'string',
      description: 'ID of the deleted or archived item',
      condition: { field: 'operation', value: ['delete_item', 'archive_item'] },
    },
    update: {
      type: 'json',
      description: 'Created update (id, body, textBody, createdAt, creatorId, itemId)',
      condition: { field: 'operation', value: 'create_update' },
    },
    group: {
      type: 'json',
      description: 'Created group (id, title, color, archived, deleted, position)',
      condition: { field: 'operation', value: 'create_group' },
    },
    count: {
      type: 'number',
      description: 'Number of returned results',
      condition: {
        field: 'operation',
        value: ['list_boards', 'get_items', 'search_items', 'get_groups'],
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for fetching the next page of search results',
      condition: { field: 'operation', value: 'search_items' },
    },
  },
  triggers: {
    enabled: true,
    available: [
      'monday_item_created',
      'monday_column_changed',
      'monday_status_changed',
      'monday_item_name_changed',
      'monday_item_archived',
      'monday_item_deleted',
      'monday_item_moved',
      'monday_subitem_created',
      'monday_update_created',
    ],
  },
}

export const MondayBlockMeta = {
  tags: ['project-management', 'ticketing'],
  url: 'https://monday.com',
  templates: [
    {
      icon: MondayIcon,
      title: 'Monday status digest',
      prompt:
        'Create a scheduled weekly workflow that pulls Monday board progress, computes completion rate, and posts a status update to leadership Slack with the at-risk items highlighted.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MondayIcon,
      title: 'Monday board automator',
      prompt:
        'Build a workflow that watches Monday boards for status changes, applies branching automations — assign owners, set due dates, post Slack updates — based on a rules table.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MondayIcon,
      title: 'Monday client portal',
      prompt:
        'Create a workflow that mirrors a Monday project board into a client-facing summary table, refreshes hourly, and emails the client a snapshot link each week.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: MondayIcon,
      title: 'Monday SLA enforcer',
      prompt:
        'Build a workflow that watches Monday items with due dates, sends reminders 24 hours before, and escalates to managers when items breach SLA.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
    },
    {
      icon: MondayIcon,
      title: 'Monday + CRM sync',
      prompt:
        'Create a workflow that mirrors Monday CRM board items into Salesforce as opportunities, keeps stage and amount synced, and writes the Salesforce ID back to the Monday item.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'sync'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: MondayIcon,
      title: 'Monday workspace audit',
      prompt:
        'Build a scheduled monthly workflow that audits Monday boards for unused columns, stale automations, and missing owners, and writes a cleanup plan to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
    },
    {
      icon: MondayIcon,
      title: 'Monday onboarding kickoff',
      prompt:
        'Create a workflow that on a new hire in Workday creates a personalized Monday onboarding board, seeds the role-specific tasks, and invites the new hire and buddy.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
  ],
  skills: [
    {
      name: 'create-board-item',
      description: 'Create a new item on a Monday board in the right group with column values set.',
      content:
        '# Create Board Item\n\nAdd an item to a Monday.com board and populate its columns.\n\n## Steps\n1. Use List Boards to find the board, then Get Board to read its groups and column ids.\n2. Run Create Item with the board id, item name, and the target group.\n3. Map the requested fields to the correct column ids, formatting status and date columns as Monday expects.\n4. Add a follow-up Create Update if a comment or context note is needed on the item.\n\n## Output\nConfirm the new item id, board, and group. List the column values that were set.',
    },
    {
      name: 'find-items-by-criteria',
      description: 'Search a Monday board for items matching a value such as status or owner.',
      content:
        '# Find Items by Criteria\n\nLocate Monday.com items that match a given condition.\n\n## Steps\n1. Identify the board and the column to filter on with Get Board.\n2. Use Search Items or Get Items to retrieve candidates.\n3. Filter to the items whose column value matches the requested criteria.\n\n## Output\nA list of matching items with name, group, and the relevant column values. Note the total match count.',
    },
    {
      name: 'progress-item-status',
      description: 'Move a Monday item forward by updating its status column and group.',
      content:
        '# Progress Item Status\n\nAdvance a Monday.com item through its workflow.\n\n## Steps\n1. Get the item with Get Item to read its current status and group.\n2. Run Update Item to set the new status column value.\n3. If the stage maps to a different group, use Move Item to Group to keep the board organized.\n4. Optionally post a Create Update noting the transition.\n\n## Output\nConfirm the item id, the old and new status, and the group it now sits in.',
    },
  ],
} as const satisfies BlockMeta
