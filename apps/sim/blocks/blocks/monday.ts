import { MondayIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { MondayResponse } from '@/tools/monday/types'

export const MondayBlock: BlockConfig<MondayResponse> = {
  type: 'monday',
  name: 'Monday',
  description: 'Create and manage items on Monday boards',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate with Monday work management platform. Create items, update column values, list items, and manage your boards programmatically.',
  docsLink: 'https://docs.monday.com/api',
  category: 'tools',
  bgColor: '#FF3D57',
  icon: MondayIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Item', id: 'monday_create_item' },
        { label: 'Update Item', id: 'monday_update_item' },
        { label: 'Get Item', id: 'monday_get_item' },
        { label: 'List Items', id: 'monday_list_items' },
      ],
      value: () => 'monday_create_item',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Monday.com API key',
      password: true,
      required: true,
    },
    // CREATE ITEM fields
    {
      id: 'board_id',
      title: 'Board',
      type: 'file-selector',
      serviceId: 'monday',
      placeholder: 'Select a Monday.com board',
      required: true,
      condition: { field: 'operation', value: 'monday_create_item' },
      dependsOn: ['apiKey'],
    },
    {
      id: 'group_id',
      title: 'Group (Optional)',
      type: 'file-selector',
      serviceId: 'monday',
      placeholder: 'Select a group/section (optional)',
      required: false,
      condition: { field: 'operation', value: 'monday_create_item' },
      dependsOn: ['apiKey', 'board_id'],
    },
    {
      id: 'item_name',
      title: 'Item Name',
      type: 'short-input',
      placeholder: 'Enter item name',
      required: true,
      condition: { field: 'operation', value: 'monday_create_item' },
    },
    {
      id: 'column_values',
      title: 'Column Values (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{"status": "Working on it", "text": "Example"}',
      required: false,
      condition: { field: 'operation', value: 'monday_create_item' },
    },
    // UPDATE ITEM fields
    {
      id: 'item_id',
      title: 'Item ID',
      type: 'short-input',
      placeholder: 'Enter item ID to update',
      required: true,
      condition: { field: 'operation', value: 'monday_update_item' },
    },
    {
      id: 'board_id_update',
      title: 'Board ID (Optional)',
      type: 'short-input',
      canonicalParamId: 'board_id',
      placeholder: 'Enter board ID (recommended)',
      required: false,
      condition: { field: 'operation', value: 'monday_update_item' },
    },
    {
      id: 'column_values_update',
      title: 'Column Values (JSON)',
      type: 'code',
      language: 'json',
      canonicalParamId: 'column_values',
      placeholder: '{"status": "Done", "text": "Updated"}',
      required: true,
      condition: { field: 'operation', value: 'monday_update_item' },
    },
    // GET ITEM fields
    {
      id: 'item_id_get',
      title: 'Item ID',
      type: 'short-input',
      canonicalParamId: 'item_id',
      placeholder: 'Enter item ID to retrieve',
      required: true,
      condition: { field: 'operation', value: 'monday_get_item' },
    },
    // LIST ITEMS fields
    {
      id: 'board_id_list',
      title: 'Board',
      type: 'file-selector',
      serviceId: 'monday',
      canonicalParamId: 'board_id',
      placeholder: 'Select a board',
      required: true,
      condition: { field: 'operation', value: 'monday_list_items' },
      dependsOn: ['apiKey'],
    },
    {
      id: 'group_id_list',
      title: 'Group (Optional)',
      type: 'file-selector',
      serviceId: 'monday',
      canonicalParamId: 'group_id',
      placeholder: 'Filter by group (optional)',
      required: false,
      condition: { field: 'operation', value: 'monday_list_items' },
      dependsOn: ['apiKey', 'board_id_list'],
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'slider',
      min: 1,
      max: 100,
      step: 1,
      defaultValue: 25,
      required: false,
      condition: { field: 'operation', value: 'monday_list_items' },
    },
  ],
  tools: {
    access: [
      'monday_create_item',
      'monday_update_item',
      'monday_get_item',
      'monday_list_items',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'monday_create_item'
      },
      params: (inputs) => {
        const { operation, ...rest } = inputs
        return rest
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Monday.com API key' },
    board_id: { type: 'string', description: 'Board ID' },
    group_id: { type: 'string', description: 'Group/section ID' },
    item_id: { type: 'string', description: 'Item ID' },
    item_name: { type: 'string', description: 'Item name' },
    column_values: { type: 'json', description: 'Column values as JSON' },
    limit: { type: 'number', description: 'Maximum number of items to return' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether operation succeeded' },
    item: { type: 'json', description: 'Single item object' },
    items: { type: 'array', description: 'Array of items (for list operation)' },
    item_id: { type: 'string', description: 'Item ID' },
    error: { type: 'string', description: 'Error message if failed' },
  },
}
