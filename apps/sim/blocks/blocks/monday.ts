import { MondayIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type {
  MondayArchiveItemResponse,
  MondayCreateGroupResponse,
  MondayCreateItemResponse,
  MondayCreateSubitemResponse,
  MondayCreateUpdateResponse,
  MondayDeleteItemResponse,
  MondayGetBoardResponse,
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

const BOARD_OPS = [
  'get_board',
  'get_items',
  'search_items',
  'create_item',
  'update_item',
  'create_group',
]

const ITEM_ID_OPS = [
  'get_item',
  'update_item',
  'delete_item',
  'archive_item',
  'create_update',
  'move_item_to_group',
]

export const MondayBlock: BlockConfig<MondayResponse> = {
  type: 'monday',
  name: 'Monday',
  description: 'Manage Monday.com boards, items, and groups',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate with Monday.com to list boards, get board details, fetch and search items, create and update items, archive or delete items, create subitems, move items between groups, add updates, and create groups.',
  docsLink: 'https://docs.sim.ai/tools/monday',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  tags: ['project-management'],
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
        { label: 'Delete Item', id: 'delete_item' },
        { label: 'Archive Item', id: 'archive_item' },
        { label: 'Move Item to Group', id: 'move_item_to_group' },
        { label: 'Create Subitem', id: 'create_subitem' },
        { label: 'Create Update', id: 'create_update' },
        { label: 'Create Group', id: 'create_group' },
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
      'monday_delete_item',
      'monday_archive_item',
      'monday_move_item_to_group',
      'monday_create_subitem',
      'monday_create_update',
      'monday_create_group',
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
      condition: { field: 'operation', value: 'get_board' },
    },
    groups: {
      type: 'json',
      description: 'Board groups (id, title, color, archived, deleted, position)',
      condition: { field: 'operation', value: 'get_board' },
    },
    columns: {
      type: 'json',
      description: 'Board columns (id, title, type)',
      condition: { field: 'operation', value: 'get_board' },
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
        value: ['get_item', 'create_item', 'update_item', 'create_subitem', 'move_item_to_group'],
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
      condition: { field: 'operation', value: ['list_boards', 'get_items', 'search_items'] },
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
