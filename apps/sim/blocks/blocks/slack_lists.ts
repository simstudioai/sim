import { SlackIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput, parseOptionalNumberInput } from '@/blocks/utils'

export const SlackListsBlock: BlockConfig = {
  type: 'slack_lists',
  name: 'Slack Lists',
  description: 'Create Lists and read, create, update, or delete rows in Slack',
  longDescription:
    'Manage project trackers and tasks in Slack Lists. Start with List Items to read rows and the column schema, then use real column IDs and Slack typed cell values to write rows. Lists require a paid Slack plan, lists:read/lists:write scopes, and a custom Slack bot with access to the List. Native Sim Slack connections are not supported. Use a List ID from its Slack URL; this block does not enumerate workspace Lists.',
  docsLink: 'https://docs.sim.ai/integrations/slack_lists',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#4A154B',
  icon: SlackIcon,
  authMode: AuthMode.OAuth,
  canvasPresentation: {
    defaultTitle: 'Slack Lists',
    sentences: {
      byOperation: {
        slack_lists_create: [{ text: 'Create list', field: 'name', core: true }],
        slack_lists_update: [
          { text: 'Rename list', field: 'listId', core: true },
          { text: 'to', field: 'name' },
        ],
        slack_lists_items_list: [{ text: 'Read rows from', field: 'listId', core: true }],
        slack_lists_items_info: [
          { text: 'Read row', field: 'itemId', core: true },
          { text: 'in', field: 'listId', core: true },
        ],
        slack_lists_items_create: [{ text: 'Create a row in', field: 'listId', core: true }],
        slack_lists_items_update: [{ text: 'Update cells in', field: 'listId', core: true }],
        slack_lists_items_delete: [
          { text: 'Delete row', field: 'itemId', core: true },
          { text: 'from', field: 'listId', core: true },
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
        { label: 'List Items', id: 'slack_lists_items_list' },
        { label: 'Get Item', id: 'slack_lists_items_info' },
        { label: 'Create Item', id: 'slack_lists_items_create' },
        { label: 'Update Items', id: 'slack_lists_items_update' },
        { label: 'Delete Item', id: 'slack_lists_items_delete' },
        { label: 'Create List', id: 'slack_lists_create' },
        { label: 'Rename List', id: 'slack_lists_update' },
      ],
      value: () => 'slack_lists_items_list',
    },
    {
      id: 'credential',
      title: 'Custom Slack Bot',
      type: 'oauth-input',
      serviceId: 'slack',
      credentialKind: 'service-account',
      requiredScopes: getScopesForService('slack'),
      required: true,
      placeholder: 'Select custom Slack bot',
      credentialLabels: {
        serviceAccountGroup: 'Custom bots',
        serviceAccountConnect: 'Set up a custom bot',
      },
    },
    {
      id: 'listId',
      title: 'List ID',
      type: 'short-input',
      placeholder: 'F0123456789 (from the Slack List URL)',
      required: true,
      condition: { field: 'operation', value: 'slack_lists_create', not: true },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: ['slack_lists_create', 'slack_lists_update'] },
    },
    {
      id: 'itemId',
      title: 'Row ID',
      type: 'short-input',
      placeholder: 'Rec0123456789',
      required: true,
      condition: {
        field: 'operation',
        value: ['slack_lists_items_info', 'slack_lists_items_delete'],
      },
    },
    {
      id: 'initialFields',
      title: 'Initial Fields',
      type: 'code',
      language: 'json',
      placeholder:
        '[{"column_id":"Col...","rich_text":[{"type":"rich_text","elements":[{"type":"rich_text_section","elements":[{"type":"text","text":"New task"}]}]}]}]',
      condition: { field: 'operation', value: 'slack_lists_items_create' },
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Return a JSON array of Slack List initial_fields. Use real column_id values supplied by the user or schema. Text cells use Block Kit rich_text arrays, number/date/select/user are arrays, checkbox is a boolean. Never invent column IDs.',
      },
    },
    {
      id: 'cells',
      title: 'Cells',
      type: 'code',
      language: 'json',
      required: true,
      placeholder: '[{"row_id":"Rec...","column_id":"Col...","checkbox":true}]',
      condition: { field: 'operation', value: 'slack_lists_items_update' },
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Return a JSON array of Slack List cell updates. Each needs a real row_id, column_id and one typed value. Text uses Block Kit rich_text arrays; checkbox is a boolean. Never invent IDs.',
      },
    },
    {
      id: 'schema',
      title: 'Column Schema',
      type: 'code',
      language: 'json',
      placeholder: '[{"key":"title","name":"Title","type":"text","is_primary_column":true}]',
      condition: { field: 'operation', value: 'slack_lists_create' },
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Return Slack List column definitions as a JSON array with key, name, type, optional is_primary_column and options. Only one text column may be primary. Select options use choices with value, label and color.',
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'slack_lists_create' },
    },
    {
      id: 'todoMode',
      title: 'Task Tracking Fields',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'slack_lists_create' },
    },
    {
      id: 'parentItemId',
      title: 'Parent Row ID',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'slack_lists_items_create' },
    },
    {
      id: 'duplicatedItemId',
      title: 'Duplicate Row ID',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'slack_lists_items_create' },
    },
    {
      id: 'limit',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100',
      mode: 'advanced',
      condition: { field: 'operation', value: 'slack_lists_items_list' },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from the previous page',
      mode: 'advanced',
      condition: { field: 'operation', value: 'slack_lists_items_list' },
    },
    {
      id: 'archived',
      title: 'Archived Rows',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'slack_lists_items_list' },
    },
    {
      id: 'includeList',
      title: 'Include List Schema',
      type: 'switch',
      defaultValue: true,
      mode: 'advanced',
      condition: { field: 'operation', value: 'slack_lists_items_list' },
    },
  ],
  tools: {
    access: [
      'slack_lists_create',
      'slack_lists_update',
      'slack_lists_items_list',
      'slack_lists_items_info',
      'slack_lists_items_create',
      'slack_lists_items_update',
      'slack_lists_items_delete',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const result: Record<string, unknown> = {}
        for (const field of ['schema', 'initialFields', 'cells']) {
          const value = params[field]
          result[field] =
            value === null || value === undefined || value === ''
              ? undefined
              : typeof value === 'string'
                ? JSON.parse(value)
                : value
        }
        result.limit = parseOptionalNumberInput(params.limit, 'Page Size', {
          integer: true,
          min: 1,
        })
        for (const field of ['todoMode', 'archived', 'includeList']) {
          const value = params[field]
          const parsed = parseOptionalBooleanInput(value)
          if (parsed === undefined && value != null && value !== '')
            throw new Error(`${field} must be a boolean`)
          result[field] = parsed
        }
        for (const field of ['description', 'parentItemId', 'duplicatedItemId', 'cursor']) {
          result[field] = params[field] === '' || params[field] === null ? undefined : params[field]
        }
        return result
      },
    },
  },
  inputs: {
    credential: { type: 'string', description: 'Custom Slack bot credential' },
    listId: { type: 'string', description: 'Slack List ID' },
    itemId: { type: 'string', description: 'Slack row ID' },
    name: { type: 'string', description: 'List name' },
    schema: { type: 'json', description: 'Column definitions' },
    initialFields: { type: 'json', description: 'Initial typed cell values' },
    cells: { type: 'json', description: 'Typed cell updates with row_id and column_id' },
    description: { type: 'string', description: 'List description' },
    todoMode: { type: 'boolean', description: 'Add task tracking columns' },
    parentItemId: { type: 'string', description: 'Parent row for a subtask' },
    duplicatedItemId: { type: 'string', description: 'Row to copy' },
    limit: { type: 'number', description: 'Page size' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    archived: { type: 'boolean', description: 'Read archived rows' },
    includeList: { type: 'boolean', description: 'Include List schema' },
  },
  outputs: {
    listId: { type: 'string', description: 'Created List ID' },
    schema: {
      type: 'json',
      description: 'Created column schema (id, key, name, type, options); null when Slack omits it',
    },
    list: {
      type: 'json',
      description: 'List metadata (id, title, schema); null when not included',
    },
    items: {
      type: 'json',
      description: 'Page of rows (id, list_id, fields, timestamps, parent_record_id)',
    },
    item: {
      type: 'json',
      description: 'One row (id, list_id, fields, timestamps, parent_record_id)',
    },
    nextCursor: { type: 'string', description: 'Continuation cursor; empty when finished' },
    ok: { type: 'boolean', description: 'Whether Slack completed the operation' },
  },
}

export const SlackListsBlockMeta = {
  tags: ['project-management', 'automation'],
  url: 'https://slack.com',
  templates: [
    {
      icon: SlackIcon,
      title: 'Slack Lists project tracker',
      prompt:
        'Build a workflow: When a project starts, create a Slack List with title, owner, status, and due date columns. Return the List ID and schema.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Lists feedback intake',
      prompt:
        'Build a workflow: When a feedback form arrives, read the destination List schema and create a row with its text and priority.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Lists weekly task digest',
      prompt:
        'Build a workflow: Each week, page through a Slack List and summarize its tasks and status for the workflow output.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Lists assign project work',
      prompt:
        'Build a workflow: When a task receives an owner, update the user cell in its Slack List row using the known user, row, and column IDs.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Lists deadline updates',
      prompt:
        'Build a workflow: When a project deadline changes, update the date cells on the selected Slack List rows.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Lists project handoff',
      prompt:
        'Build a workflow: When work changes teams, get each selected List row and produce a handoff report containing its current fields.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: SlackIcon,
      title: 'Slack Lists task completion',
      prompt:
        'Build a workflow: When a task is completed, update its checkbox cell in the Slack List and return confirmation.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'create-project-tracker',
      description: 'Create a project tracker with typed Slack List columns.',
      content:
        '# Project tracker\n\nCreate a project tracker with typed Slack List columns.\n\n## Steps\n1. Select a custom Slack bot with Lists scopes and access to the target List.\n2. Read List Items with includeList=true to obtain schema and row IDs; for a new tracker, Create List first. Follow nextCursor until empty when reading all rows.\n3. When a project starts, create a Slack List with title, owner, status, and due date columns. Return the List ID and schema. Use only returned column IDs, typed cell values, and supplied Slack user IDs. Do not invent IDs.\n4. Return the operation result and relevant IDs.\n\n## Output\nReturn the result and source resource IDs.\n\n## Reference\nhttps://docs.slack.dev/surfaces/lists/',
    },
    {
      name: 'capture-feedback',
      description: 'Add incoming feedback to a known Slack List using its column schema.',
      content:
        '# Feedback intake\n\nAdd incoming feedback to a known Slack List using its column schema.\n\n## Steps\n1. Select a custom Slack bot with Lists scopes and access to the target List.\n2. Read List Items with includeList=true to obtain schema and row IDs; for a new tracker, Create List first. Follow nextCursor until empty when reading all rows.\n3. When a feedback form arrives, read the destination List schema and create a row with its text and priority. Use only returned column IDs, typed cell values, and supplied Slack user IDs. Do not invent IDs.\n4. Return the operation result and relevant IDs.\n\n## Output\nReturn the result and source resource IDs.\n\n## Reference\nhttps://docs.slack.dev/surfaces/lists/',
    },
    {
      name: 'summarize-list',
      description: 'Read every page of a Slack List and summarize work and deadlines.',
      content:
        '# Weekly task digest\n\nRead every page of a Slack List and summarize work and deadlines.\n\n## Steps\n1. Select a custom Slack bot with Lists scopes and access to the target List.\n2. Read List Items with includeList=true to obtain schema and row IDs; for a new tracker, Create List first. Follow nextCursor until empty when reading all rows.\n3. Each week, page through a Slack List and summarize its tasks and status for the workflow output. Use only returned column IDs, typed cell values, and supplied Slack user IDs. Do not invent IDs.\n4. Return the operation result and relevant IDs.\n\n## Output\nReturn the result and source resource IDs.\n\n## Reference\nhttps://docs.slack.dev/surfaces/lists/',
    },
    {
      name: 'assign-list-work',
      description: 'Update task owners using Slack user cells.',
      content:
        '# Assign project work\n\nUpdate task owners using Slack user cells.\n\n## Steps\n1. Select a custom Slack bot with Lists scopes and access to the target List.\n2. Read List Items with includeList=true to obtain schema and row IDs; for a new tracker, Create List first. Follow nextCursor until empty when reading all rows.\n3. When a task receives an owner, update the user cell in its Slack List row using the known user, row, and column IDs. Use only returned column IDs, typed cell values, and supplied Slack user IDs. Do not invent IDs.\n4. Return the operation result and relevant IDs.\n\n## Output\nReturn the result and source resource IDs.\n\n## Reference\nhttps://docs.slack.dev/surfaces/lists/',
    },
    {
      name: 'update-list-deadlines',
      description: 'Update selected rows with typed date values.',
      content:
        '# Deadline updates\n\nUpdate selected rows with typed date values.\n\n## Steps\n1. Select a custom Slack bot with Lists scopes and access to the target List.\n2. Read List Items with includeList=true to obtain schema and row IDs; for a new tracker, Create List first. Follow nextCursor until empty when reading all rows.\n3. When a project deadline changes, update the date cells on the selected Slack List rows. Use only returned column IDs, typed cell values, and supplied Slack user IDs. Do not invent IDs.\n4. Return the operation result and relevant IDs.\n\n## Output\nReturn the result and source resource IDs.\n\n## Reference\nhttps://docs.slack.dev/surfaces/lists/',
    },
  ],
} as const satisfies BlockMeta
