import { Send } from '@sim/emcn/icons'
import { toError } from '@sim/utils/errors'
import { NotionIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'
import type { NotionResponse } from '@/tools/notion/types'
import { getTrigger } from '@/triggers'

// Legacy block - hidden from toolbar
export const NotionBlock: BlockConfig<NotionResponse> = {
  type: 'notion',
  name: 'Notion (Legacy)',
  hideFromToolbar: true,
  deprecated: { replacedBy: 'notion_v2' },
  description: 'Manage Notion pages',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate with Notion into the workflow. Can read page, read database, create page, create database, append content, query database, and search workspace.',
  docsLink: 'https://docs.sim.ai/integrations/notion',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: NotionIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read Page', id: 'notion_read' },
        { label: 'Read Database', id: 'notion_read_database' },
        { label: 'Create Page', id: 'notion_create_page' },
        { label: 'Update Page Properties', id: 'notion_update_page' },
        { label: 'Create Database', id: 'notion_create_database' },
        { label: 'Add Database Row', id: 'notion_add_database_row' },
        { label: 'Append Content', id: 'notion_write' },
        { label: 'Append Block Children', id: 'notion_append_blocks' },
        { label: 'Retrieve Block', id: 'notion_retrieve_block' },
        { label: 'Retrieve Block Children', id: 'notion_retrieve_block_children' },
        { label: 'Update Block', id: 'notion_update_block' },
        { label: 'Delete Block', id: 'notion_delete_block' },
        { label: 'Create Comment', id: 'notion_create_comment' },
        { label: 'List Comments', id: 'notion_list_comments' },
        { label: 'List Users', id: 'notion_list_users' },
        { label: 'Retrieve User', id: 'notion_retrieve_user' },
        { label: 'Query Database', id: 'notion_query_database' },
        { label: 'Search Workspace', id: 'notion_search' },
      ],
      value: () => 'notion_read',
    },
    {
      id: 'credential',
      title: 'Notion Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'notion',
      placeholder: 'Select Notion account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Notion Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'pageSelector',
      title: 'Page',
      type: 'file-selector',
      canonicalParamId: 'pageId',
      serviceId: 'notion',
      selectorKey: 'notion.pages',
      placeholder: 'Select Notion page',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['notion_read', 'notion_write', 'notion_update_page'],
      },
      required: true,
    },
    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      canonicalParamId: 'pageId',
      placeholder: 'Enter Notion page ID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['notion_read', 'notion_write', 'notion_update_page'],
      },
      required: true,
    },
    {
      id: 'databaseSelector',
      title: 'Database',
      type: 'project-selector',
      canonicalParamId: 'databaseId',
      serviceId: 'notion',
      selectorKey: 'notion.databases',
      placeholder: 'Select Notion database',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['notion_read_database', 'notion_query_database', 'notion_add_database_row'],
      },
      required: true,
    },
    {
      id: 'databaseId',
      title: 'Database ID',
      type: 'short-input',
      canonicalParamId: 'databaseId',
      placeholder: 'Enter Notion database ID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['notion_read_database', 'notion_query_database', 'notion_add_database_row'],
      },
      required: true,
    },
    {
      id: 'parentSelector',
      title: 'Parent Page',
      type: 'file-selector',
      canonicalParamId: 'parentId',
      serviceId: 'notion',
      selectorKey: 'notion.pages',
      placeholder: 'Select parent page',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: ['notion_create_page', 'notion_create_database'] },
      required: true,
    },
    {
      id: 'parentId',
      title: 'Parent Page ID',
      type: 'short-input',
      canonicalParamId: 'parentId',
      placeholder: 'ID of parent page',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: ['notion_create_page', 'notion_create_database'] },
      required: true,
    },
    {
      id: 'title',
      title: 'Page Title',
      type: 'short-input',
      placeholder: 'Title for the new page',
      condition: {
        field: 'operation',
        value: 'notion_create_page',
      },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a concise, descriptive title for a Notion page based on the user's description. The title should be clear and professional. Return ONLY the title text - no explanations, no quotes.",
        placeholder: 'Describe what the page is about...',
      },
    },
    // Content input for write/create operations
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter content to add to the page',
      condition: {
        field: 'operation',
        value: 'notion_write',
      },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          "Generate content to append to a Notion page based on the user's description. The content can include paragraphs, lists, headings, and other text elements. Format it appropriately for Notion. Return ONLY the content - no explanations.",
        placeholder: 'Describe the content you want to add...',
      },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter content to add to the page',
      condition: {
        field: 'operation',
        value: 'notion_create_page',
      },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate content for a new Notion page based on the user's description. The content can include paragraphs, lists, headings, and other text elements. Format it appropriately for Notion. Return ONLY the content - no explanations.",
        placeholder: 'Describe the content you want to create...',
      },
    },
    // Query Database Fields
    {
      id: 'filter',
      title: 'Filter',
      type: 'code',
      placeholder: 'Enter filter conditions as JSON (optional)',
      condition: { field: 'operation', value: 'notion_query_database' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Notion database filter object in JSON format based on the user\'s description. Notion filters use properties like "property", "equals", "contains", "checkbox", "date", etc. Example: {"property": "Status", "select": {"equals": "Done"}}. For compound filters use "and" or "or" arrays. Return ONLY valid JSON - no explanations.',
        placeholder:
          'Describe what you want to filter (e.g., "status is done", "created after last week")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'sorts',
      title: 'Sort Criteria',
      type: 'code',
      placeholder: 'Enter sort criteria as JSON array (optional)',
      condition: { field: 'operation', value: 'notion_query_database' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Notion database sort criteria array in JSON format based on the user\'s description. Each sort object has "property" (property name) or "timestamp" ("created_time" or "last_edited_time") and "direction" ("ascending" or "descending"). Example: [{"property": "Name", "direction": "ascending"}]. Return ONLY a valid JSON array - no explanations.',
        placeholder: 'Describe how to sort (e.g., "by name ascending", "newest first")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Number of results (default: 100, max: 100)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'notion_query_database',
          'notion_retrieve_block_children',
          'notion_list_comments',
          'notion_list_users',
          'notion_search',
        ],
      },
    },
    // Search Fields
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search terms (leave empty for all pages)',
      condition: { field: 'operation', value: 'notion_search' },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a search query string for searching a Notion workspace based on the user's description. The query should be concise and use relevant keywords. Return ONLY the search query text - no explanations, no quotes.",
        placeholder: 'Describe what you want to search for...',
      },
    },
    {
      id: 'filterType',
      title: 'Filter Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Pages Only', id: 'page' },
        { label: 'Databases Only', id: 'database' },
      ],
      condition: { field: 'operation', value: 'notion_search' },
    },
    // Create Database Fields
    {
      id: 'title',
      title: 'Database Title',
      type: 'short-input',
      placeholder: 'Title for the new database',
      condition: { field: 'operation', value: 'notion_create_database' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a concise, descriptive title for a Notion database based on the user's description. The title should clearly indicate what data the database will contain. Return ONLY the title text - no explanations, no quotes.",
        placeholder: 'Describe what the database will track...',
      },
    },
    {
      id: 'properties',
      title: 'Database Properties',
      type: 'code',
      placeholder: 'Enter database properties as JSON object',
      condition: { field: 'operation', value: 'notion_create_database' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Notion database properties in JSON format based on the user\'s description. Only provide the json, no escaping required. Properties define the schema of the database. Common types: "title" (required), "rich_text", "number", "select" (with options), "multi_select", "date", "checkbox", "url", "email", "phone_number". Example: {"Name": {"title": {}}, "Status": {"select": {"options": [{"name": "To Do"}, {"name": "Done"}]}}, "Priority": {"number": {}}}. Return ONLY valid JSON - no explanations.',
        placeholder:
          'Describe the columns/properties you want (e.g., "name, status dropdown, due date, priority number")...',
        generationType: 'json-object',
      },
    },
    // Add Database Row Fields
    {
      id: 'properties',
      title: 'Row Properties',
      type: 'code',
      placeholder: 'Enter row properties as JSON object',
      condition: { field: 'operation', value: 'notion_add_database_row' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Notion page/row properties in JSON format based on the user\'s description. Properties must match the database schema. Common formats: Title: {"Name": {"title": [{"text": {"content": "Value"}}]}}, Text: {"Description": {"rich_text": [{"text": {"content": "Value"}}]}}, Number: {"Price": {"number": 10}}, Select: {"Status": {"select": {"name": "Done"}}}, Multi-select: {"Tags": {"multi_select": [{"name": "Tag1"}, {"name": "Tag2"}]}}, Date: {"Due": {"date": {"start": "2024-01-01"}}}, Checkbox: {"Done": {"checkbox": true}}, URL: {"Link": {"url": "https://..."}}, Email: {"Contact": {"email": "test@example.com"}}. Return ONLY valid JSON - no explanations.',
        placeholder:
          'Describe the row data (e.g., "name is Task 1, status is Done, priority is High")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'properties',
      title: 'Properties to Update',
      type: 'code',
      placeholder: 'Enter page properties as JSON object',
      condition: { field: 'operation', value: 'notion_update_page' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Notion page properties to update in JSON format based on the user\'s description. Properties must match the parent database schema. Common formats: Title: {"Name": {"title": [{"text": {"content": "Value"}}]}}, Text: {"Description": {"rich_text": [{"text": {"content": "Value"}}]}}, Number: {"Price": {"number": 10}}, Select: {"Status": {"select": {"name": "Done"}}}, Multi-select: {"Tags": {"multi_select": [{"name": "Tag1"}]}}, Date: {"Due": {"date": {"start": "2024-01-01"}}}, Checkbox: {"Done": {"checkbox": true}}. Return ONLY valid JSON - no explanations.',
        placeholder:
          'Describe the properties to update (e.g., "set status to Done, priority to High")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'blockId',
      title: 'Page or Block ID',
      type: 'short-input',
      placeholder: 'Enter Notion page or block ID',
      dependsOn: ['credential'],
      condition: {
        field: 'operation',
        value: [
          'notion_append_blocks',
          'notion_retrieve_block',
          'notion_retrieve_block_children',
          'notion_update_block',
          'notion_delete_block',
          'notion_list_comments',
        ],
      },
      required: true,
    },
    {
      id: 'children',
      title: 'Block Children',
      type: 'code',
      placeholder: 'Enter an array of Notion block objects as JSON',
      condition: { field: 'operation', value: 'notion_append_blocks' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an array of Notion block objects in JSON format based on the user\'s description. Each block has "object": "block", a "type", and a type-specific field. Examples: paragraph {"object":"block","type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"Hello"}}]}}, heading_2 {"object":"block","type":"heading_2","heading_2":{"rich_text":[{"type":"text","text":{"content":"Section"}}]}}, bulleted_list_item, numbered_list_item, to_do {"object":"block","type":"to_do","to_do":{"rich_text":[{"type":"text","text":{"content":"Task"}}],"checked":false}}. Return ONLY a valid JSON array - no explanations.',
        placeholder: 'Describe the content blocks to append...',
        generationType: 'json-object',
      },
    },
    {
      id: 'after',
      title: 'Append After Block ID',
      type: 'short-input',
      placeholder: 'UUID of the block to append after (optional)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'notion_append_blocks' },
    },
    {
      id: 'block',
      title: 'Block Update',
      type: 'code',
      placeholder: 'Enter the block-type fields to update as JSON',
      condition: { field: 'operation', value: 'notion_update_block' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Notion block-type update object in JSON format based on the user\'s description. The object contains the block type as a key with its updatable fields. Examples: paragraph {"paragraph":{"rich_text":[{"type":"text","text":{"content":"Updated text"}}]}}, to_do {"to_do":{"rich_text":[{"type":"text","text":{"content":"Task"}}],"checked":true}}, heading_1 {"heading_1":{"rich_text":[{"type":"text","text":{"content":"New heading"}}]}}. Return ONLY valid JSON - no explanations.',
        placeholder: 'Describe how to update the block...',
        generationType: 'json-object',
      },
    },
    {
      id: 'archived',
      title: 'Archive Block',
      type: 'dropdown',
      options: [
        { label: 'Leave unchanged', id: 'unchanged' },
        { label: 'No (restore)', id: 'false' },
        { label: 'Yes (archive)', id: 'true' },
      ],
      value: () => 'unchanged',
      mode: 'advanced',
      condition: { field: 'operation', value: 'notion_update_block' },
    },
    {
      id: 'commentParentId',
      title: 'Page ID',
      type: 'short-input',
      placeholder: 'UUID of the page to comment on',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'notion_create_comment' },
    },
    {
      id: 'discussionId',
      title: 'Discussion ID',
      type: 'short-input',
      placeholder: 'UUID of an existing discussion thread (optional)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'notion_create_comment' },
    },
    {
      id: 'commentContent',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Enter the comment text',
      condition: { field: 'operation', value: 'notion_create_comment' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a concise, professional comment to post on a Notion page based on the user's description. Return ONLY the comment text - no explanations, no quotes.",
        placeholder: 'Describe what the comment should say...',
      },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'UUID of the Notion user to retrieve',
      condition: { field: 'operation', value: 'notion_retrieve_user' },
      required: true,
    },
    {
      id: 'startCursor',
      title: 'Start Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from a previous response (optional)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'notion_retrieve_block_children',
          'notion_list_comments',
          'notion_list_users',
          'notion_query_database',
          'notion_search',
        ],
      },
    },
  ],
  tools: {
    access: [
      'notion_read',
      'notion_read_database',
      'notion_write',
      'notion_create_page',
      'notion_query_database',
      'notion_search',
      'notion_create_database',
      'notion_add_database_row',
      'notion_update_page',
      'notion_append_blocks',
      'notion_retrieve_block',
      'notion_retrieve_block_children',
      'notion_update_block',
      'notion_delete_block',
      'notion_create_comment',
      'notion_list_comments',
      'notion_list_users',
      'notion_retrieve_user',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'notion_read':
            return 'notion_read'
          case 'notion_read_database':
            return 'notion_read_database'
          case 'notion_write':
            return 'notion_write'
          case 'notion_create_page':
            return 'notion_create_page'
          case 'notion_update_page':
            return 'notion_update_page'
          case 'notion_query_database':
            return 'notion_query_database'
          case 'notion_search':
            return 'notion_search'
          case 'notion_create_database':
            return 'notion_create_database'
          case 'notion_add_database_row':
            return 'notion_add_database_row'
          case 'notion_append_blocks':
            return 'notion_append_blocks'
          case 'notion_retrieve_block':
            return 'notion_retrieve_block'
          case 'notion_retrieve_block_children':
            return 'notion_retrieve_block_children'
          case 'notion_update_block':
            return 'notion_update_block'
          case 'notion_delete_block':
            return 'notion_delete_block'
          case 'notion_create_comment':
            return 'notion_create_comment'
          case 'notion_list_comments':
            return 'notion_list_comments'
          case 'notion_list_users':
            return 'notion_list_users'
          case 'notion_retrieve_user':
            return 'notion_retrieve_user'
          default:
            return 'notion_read'
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          operation,
          properties,
          filter,
          sorts,
          children,
          block,
          archived,
          pageSize,
          commentParentId,
          commentContent,
          ...rest
        } = params

        // Parse properties from JSON string for create/add operations
        let parsedProperties
        if (
          (operation === 'notion_create_page' ||
            operation === 'notion_create_database' ||
            operation === 'notion_add_database_row' ||
            operation === 'notion_update_page') &&
          properties
        ) {
          if (typeof properties === 'string') {
            try {
              parsedProperties = JSON.parse(properties)
            } catch (error) {
              throw new Error(`Invalid JSON for properties: ${toError(error).message}`)
            }
          } else {
            parsedProperties = properties
          }
        }

        // Parse filter for query database operations
        let parsedFilter
        if (operation === 'notion_query_database' && filter) {
          try {
            parsedFilter = JSON.parse(filter)
          } catch (error) {
            throw new Error(`Invalid JSON for filter: ${toError(error).message}`)
          }
        }

        // Parse sorts for query database operations
        let parsedSorts
        if (operation === 'notion_query_database' && sorts) {
          try {
            parsedSorts = JSON.parse(sorts)
          } catch (error) {
            throw new Error(`Invalid JSON for sorts: ${toError(error).message}`)
          }
        }

        // Parse block children array for append operations
        let parsedChildren
        if (operation === 'notion_append_blocks' && children) {
          if (typeof children === 'string') {
            try {
              parsedChildren = JSON.parse(children)
            } catch (error) {
              throw new Error(`Invalid JSON for children: ${toError(error).message}`)
            }
          } else {
            parsedChildren = children
          }
        }

        // Parse block-type payload for update block operations
        let parsedBlock
        if (operation === 'notion_update_block' && block) {
          if (typeof block === 'string') {
            try {
              parsedBlock = JSON.parse(block)
            } catch (error) {
              throw new Error(`Invalid JSON for block: ${toError(error).message}`)
            }
          } else {
            parsedBlock = block
          }
        }

        // Coerce archived flag — agent calls deliver "true"/"false" strings
        let coercedArchived
        if (
          operation === 'notion_update_block' &&
          archived !== undefined &&
          archived !== '' &&
          archived !== 'unchanged'
        ) {
          coercedArchived = archived === true || archived === 'true'
        }

        let coercedPageSize: number | undefined
        if (pageSize !== undefined && pageSize !== null && pageSize !== '') {
          const parsedPageSize = Number(pageSize)
          if (Number.isFinite(parsedPageSize)) {
            coercedPageSize = Math.min(Math.max(Math.trunc(parsedPageSize), 1), 100)
          }
        }

        return {
          ...rest,
          oauthCredential,
          ...(parsedProperties ? { properties: parsedProperties } : {}),
          ...(parsedFilter ? { filter: JSON.stringify(parsedFilter) } : {}),
          ...(parsedSorts ? { sorts: JSON.stringify(parsedSorts) } : {}),
          ...(parsedChildren ? { children: parsedChildren } : {}),
          ...(parsedBlock ? { block: parsedBlock } : {}),
          ...(coercedArchived !== undefined ? { archived: coercedArchived } : {}),
          ...(coercedPageSize !== undefined ? { pageSize: coercedPageSize } : {}),
          ...(operation === 'notion_create_comment' && commentParentId
            ? { pageId: commentParentId }
            : {}),
          ...(operation === 'notion_create_comment' && commentContent
            ? { content: commentContent }
            : {}),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Notion access token' },
    pageId: { type: 'string', description: 'Page identifier' },
    content: { type: 'string', description: 'Page content' },
    // Create page inputs
    parentId: { type: 'string', description: 'Parent page identifier' },
    title: { type: 'string', description: 'Page title' },
    // Query database inputs
    databaseId: { type: 'string', description: 'Database identifier' },
    filter: { type: 'string', description: 'Filter criteria' },
    sorts: { type: 'string', description: 'Sort criteria' },
    pageSize: { type: 'number', description: 'Page size limit' },
    // Search inputs
    query: { type: 'string', description: 'Search query' },
    filterType: { type: 'string', description: 'Filter type' },
    // Block content inputs
    blockId: { type: 'string', description: 'Page or block identifier' },
    children: { type: 'json', description: 'Array of block objects to append' },
    after: { type: 'string', description: 'Block ID to append after' },
    block: { type: 'json', description: 'Block-type fields to update' },
    archived: { type: 'boolean', description: 'Whether to archive the block' },
    startCursor: { type: 'string', description: 'Pagination cursor' },
    // Comment inputs
    commentParentId: { type: 'string', description: 'Page identifier to comment on' },
    discussionId: { type: 'string', description: 'Discussion thread identifier' },
    commentContent: { type: 'string', description: 'Comment text' },
    // User inputs
    userId: { type: 'string', description: 'User identifier' },
  },
  outputs: {
    // Outputs for the original content/metadata-shaped operations
    content: {
      type: 'string',
      description: 'Page content, comment text, search results, or confirmation messages',
      condition: {
        field: 'operation',
        value: [
          'notion_read',
          'notion_write',
          'notion_create_page',
          'notion_update_page',
          'notion_query_database',
          'notion_search',
          'notion_create_database',
          'notion_read_database',
          'notion_create_comment',
        ],
      },
    },
    metadata: {
      type: 'json',
      description:
        'Metadata containing operation-specific details including page/database info, results, and pagination data',
      condition: {
        field: 'operation',
        value: [
          'notion_read',
          'notion_write',
          'notion_create_page',
          'notion_update_page',
          'notion_query_database',
          'notion_search',
          'notion_create_database',
          'notion_read_database',
        ],
      },
    },

    // Outputs for the API-aligned flat-shaped operations added after the legacy block was hidden
    id: {
      type: 'string',
      description: 'Row, block, comment, or user ID',
      condition: {
        field: 'operation',
        value: [
          'notion_add_database_row',
          'notion_retrieve_block',
          'notion_update_block',
          'notion_delete_block',
          'notion_create_comment',
          'notion_retrieve_user',
        ],
      },
    },
    url: {
      type: 'string',
      description: 'Notion page URL',
      condition: { field: 'operation', value: 'notion_add_database_row' },
    },
    title: {
      type: 'string',
      description: 'Row title',
      condition: { field: 'operation', value: 'notion_add_database_row' },
    },
    created_time: {
      type: 'string',
      description: 'Creation timestamp',
      condition: {
        field: 'operation',
        value: ['notion_add_database_row', 'notion_create_comment'],
      },
    },
    last_edited_time: {
      type: 'string',
      description: 'Last edit timestamp',
      condition: { field: 'operation', value: 'notion_add_database_row' },
    },
    results: {
      type: 'array',
      description: 'Array of results (blocks, comments, or users)',
      condition: {
        field: 'operation',
        value: [
          'notion_append_blocks',
          'notion_retrieve_block_children',
          'notion_list_comments',
          'notion_list_users',
        ],
      },
    },
    has_more: {
      type: 'boolean',
      description: 'Whether more results are available',
      condition: {
        field: 'operation',
        value: [
          'notion_append_blocks',
          'notion_retrieve_block_children',
          'notion_list_comments',
          'notion_list_users',
        ],
      },
    },
    next_cursor: {
      type: 'string',
      description: 'Cursor for pagination',
      condition: {
        field: 'operation',
        value: [
          'notion_append_blocks',
          'notion_retrieve_block_children',
          'notion_list_comments',
          'notion_list_users',
        ],
      },
    },
    type: {
      type: 'string',
      description: 'Block type',
      condition: { field: 'operation', value: ['notion_retrieve_block', 'notion_update_block'] },
    },
    block: {
      type: 'json',
      description: 'The full Notion block object',
      condition: { field: 'operation', value: ['notion_retrieve_block', 'notion_update_block'] },
    },
    has_children: {
      type: 'boolean',
      description: 'Whether the block has nested blocks',
      condition: { field: 'operation', value: 'notion_retrieve_block' },
    },
    archived: {
      type: 'boolean',
      description: 'Whether the block is archived',
      condition: {
        field: 'operation',
        value: ['notion_retrieve_block', 'notion_update_block', 'notion_delete_block'],
      },
    },
    discussion_id: {
      type: 'string',
      description: 'Discussion thread ID',
      condition: { field: 'operation', value: 'notion_create_comment' },
    },
    rich_text: {
      type: 'json',
      description: 'Rich text array of the comment',
      condition: { field: 'operation', value: 'notion_create_comment' },
    },
    name: {
      type: 'string',
      description: 'User display name',
      condition: { field: 'operation', value: 'notion_retrieve_user' },
    },
    avatar_url: {
      type: 'string',
      description: 'User avatar image URL',
      condition: { field: 'operation', value: 'notion_retrieve_user' },
    },
    email: {
      type: 'string',
      description: 'User email address (person users only)',
      condition: { field: 'operation', value: 'notion_retrieve_user' },
    },
  },
}

// V2 Block with API-aligned outputs

export const NotionV2Block: BlockConfig<any> = {
  type: 'notion_v2',
  name: 'Notion',
  description: 'Manage Notion pages',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate with Notion into the workflow. Can read page, read database, create page, create database, append content, query database, and search workspace.',
  docsLink: 'https://docs.sim.ai/integrations/notion',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: NotionIcon,
  hideFromToolbar: false,
  subBlocks: [
    ...NotionBlock.subBlocks,

    // Trigger subBlocks
    ...getTrigger('notion_page_created').subBlocks,
    ...getTrigger('notion_page_properties_updated').subBlocks,
    ...getTrigger('notion_page_content_updated').subBlocks,
    ...getTrigger('notion_page_deleted').subBlocks,
    ...getTrigger('notion_database_created').subBlocks,
    ...getTrigger('notion_database_schema_updated').subBlocks,
    ...getTrigger('notion_database_deleted').subBlocks,
    ...getTrigger('notion_comment_created').subBlocks,
    ...getTrigger('notion_webhook').subBlocks,
  ],
  triggers: {
    enabled: true,
    available: [
      'notion_page_created',
      'notion_page_properties_updated',
      'notion_page_content_updated',
      'notion_page_deleted',
      'notion_database_created',
      'notion_database_schema_updated',
      'notion_database_deleted',
      'notion_comment_created',
      'notion_webhook',
    ],
  },
  tools: {
    access: [
      'notion_read_v2',
      'notion_read_database_v2',
      'notion_write_v2',
      'notion_create_page_v2',
      'notion_update_page_v2',
      'notion_query_database_v2',
      'notion_search_v2',
      'notion_create_database_v2',
      'notion_add_database_row_v2',
      'notion_append_blocks_v2',
      'notion_retrieve_block_v2',
      'notion_retrieve_block_children_v2',
      'notion_update_block_v2',
      'notion_delete_block_v2',
      'notion_create_comment_v2',
      'notion_list_comments_v2',
      'notion_list_users_v2',
      'notion_retrieve_user_v2',
    ],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: (params) => params.operation || 'notion_read',
        suffix: '_v2',
        fallbackToolId: 'notion_read_v2',
      }),
      params: NotionBlock.tools?.config?.params,
    },
  },
  inputs: NotionBlock.inputs,
  outputs: {
    // Read page outputs
    content: {
      type: 'string',
      description: 'Page content in markdown format, or comment text for create comment',
      condition: { field: 'operation', value: ['notion_read', 'notion_create_comment'] },
    },
    title: {
      type: 'string',
      description: 'Page or database title',
      condition: {
        field: 'operation',
        value: [
          'notion_read',
          'notion_create_page',
          'notion_update_page',
          'notion_create_database',
          'notion_read_database',
          'notion_add_database_row',
        ],
      },
    },
    url: {
      type: 'string',
      description: 'Notion URL',
      condition: {
        field: 'operation',
        value: [
          'notion_read',
          'notion_create_page',
          'notion_update_page',
          'notion_create_database',
          'notion_read_database',
          'notion_add_database_row',
        ],
      },
    },
    id: {
      type: 'string',
      description: 'Page, database, block, comment, or user ID',
      condition: {
        field: 'operation',
        value: [
          'notion_create_page',
          'notion_create_database',
          'notion_add_database_row',
          'notion_read_database',
          'notion_update_page',
          'notion_retrieve_block',
          'notion_update_block',
          'notion_delete_block',
          'notion_create_comment',
          'notion_retrieve_user',
        ],
      },
    },
    created_time: {
      type: 'string',
      description: 'Creation timestamp',
      condition: {
        field: 'operation',
        value: [
          'notion_read',
          'notion_create_page',
          'notion_create_database',
          'notion_read_database',
          'notion_add_database_row',
          'notion_create_comment',
        ],
      },
    },
    last_edited_time: {
      type: 'string',
      description: 'Last edit timestamp',
      condition: {
        field: 'operation',
        value: [
          'notion_read',
          'notion_create_page',
          'notion_update_page',
          'notion_read_database',
          'notion_add_database_row',
        ],
      },
    },
    // List/query/search outputs
    results: {
      type: 'array',
      description: 'Array of results (pages, blocks, comments, or users)',
      condition: {
        field: 'operation',
        value: [
          'notion_query_database',
          'notion_search',
          'notion_append_blocks',
          'notion_retrieve_block_children',
          'notion_list_comments',
          'notion_list_users',
        ],
      },
    },
    has_more: {
      type: 'boolean',
      description: 'Whether more results are available',
      condition: {
        field: 'operation',
        value: [
          'notion_query_database',
          'notion_search',
          'notion_append_blocks',
          'notion_retrieve_block_children',
          'notion_list_comments',
          'notion_list_users',
        ],
      },
    },
    next_cursor: {
      type: 'string',
      description: 'Cursor for pagination',
      condition: {
        field: 'operation',
        value: [
          'notion_query_database',
          'notion_search',
          'notion_append_blocks',
          'notion_retrieve_block_children',
          'notion_list_comments',
          'notion_list_users',
        ],
      },
    },
    total_results: {
      type: 'number',
      description: 'Number of results returned',
      condition: { field: 'operation', value: ['notion_query_database', 'notion_search'] },
    },
    // Database schema
    properties: {
      type: 'json',
      description: 'Database properties schema',
      condition: { field: 'operation', value: ['notion_read_database', 'notion_create_database'] },
    },
    // Write output
    appended: {
      type: 'boolean',
      description: 'Whether content was successfully appended',
      condition: { field: 'operation', value: 'notion_write' },
    },
    // Block retrieve/update/delete outputs
    type: {
      type: 'string',
      description: 'Block type',
      condition: { field: 'operation', value: ['notion_retrieve_block', 'notion_update_block'] },
    },
    block: {
      type: 'json',
      description: 'The full Notion block object',
      condition: { field: 'operation', value: ['notion_retrieve_block', 'notion_update_block'] },
    },
    has_children: {
      type: 'boolean',
      description: 'Whether the block has nested blocks',
      condition: { field: 'operation', value: 'notion_retrieve_block' },
    },
    archived: {
      type: 'boolean',
      description: 'Whether the block is archived',
      condition: {
        field: 'operation',
        value: ['notion_retrieve_block', 'notion_update_block', 'notion_delete_block'],
      },
    },
    // Comment outputs
    discussion_id: {
      type: 'string',
      description: 'Discussion thread ID',
      condition: { field: 'operation', value: 'notion_create_comment' },
    },
    // User outputs
    name: {
      type: 'string',
      description: 'User display name',
      condition: { field: 'operation', value: 'notion_retrieve_user' },
    },
    avatar_url: {
      type: 'string',
      description: 'User avatar image URL',
      condition: { field: 'operation', value: 'notion_retrieve_user' },
    },
    email: {
      type: 'string',
      description: 'User email address (person users only)',
      condition: { field: 'operation', value: 'notion_retrieve_user' },
    },
  },
}

export const NotionBlockMeta = {
  tags: ['note-taking', 'knowledge-base', 'content-management'],
  url: 'https://www.notion.com',
  templates: [
    {
      icon: Send,
      title: 'Customer support bot',
      prompt:
        'Create a knowledge base and connect it to my Notion or Google Docs so it stays synced with my product documentation automatically. Then build an agent that answers customer questions using it with sourced citations and deploy it as a chat endpoint.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: NotionIcon,
      title: 'Notion knowledge search',
      prompt:
        'Create a knowledge base connected to my Notion workspace so all pages, databases, meeting notes, and wikis are automatically synced and searchable. Then build an agent I can ask things like "what\'s our refund policy?" or "what was decided in the Q3 planning doc?" and get instant answers with page links.',
      modules: ['knowledge-base', 'agent'],
      category: 'productivity',
      tags: ['team', 'research'],
    },

    {
      icon: NotionIcon,
      title: 'Notify your team from Notion',
      prompt:
        'Build a workflow that watches Notion for new or updated pages and automatically posts a Slack message so your team stays aligned without manual check-ins.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['slack'],
    },
    {
      icon: NotionIcon,
      title: 'Notion meeting-notes capture',
      prompt:
        'Build a workflow that runs after a Google Meet call, fetches the transcript, and creates a structured Notion page under the right project with attendees, decisions, and action items.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'note-taking', 'automation'],
      alsoIntegrations: ['google_meet'],
    },
    {
      icon: NotionIcon,
      title: 'Notion CRM enrichment',
      prompt:
        'Create a workflow that watches a Notion database of companies, researches each new entry for funding, headcount, and industry, and appends the enriched fields back to the Notion page so the pipeline stays current.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment', 'automation'],
    },
    {
      icon: NotionIcon,
      title: 'Notion content calendar publisher',
      prompt:
        'Build a scheduled workflow that queries a Notion content-calendar database for posts marked ready today, formats each one, and publishes it to the blog while updating the Notion page status to published.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content-management', 'automation'],
      alsoIntegrations: ['wordpress'],
    },
    {
      icon: NotionIcon,
      title: 'Notion weekly digest builder',
      prompt:
        'Create a scheduled weekly workflow that queries a Notion project database for items completed this week, appends a summary section to a Notion review page, and posts the highlights to Slack for the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'create-structured-page',
      description:
        'Create a Notion page under a parent with headings, bullets, and a clean layout.',
      content:
        '# Create Structured Page\n\nCreate a well-formatted Notion page, such as meeting notes or a project brief.\n\n## Steps\n1. Identify the parent page or database, using Search Workspace if the destination is not known.\n2. Run Create Page with the title and parent.\n3. Use Append Content to add the body as Notion blocks: headings for sections, bulleted lists for items, and to-do blocks for action items.\n\n## Output\nReturn the new page URL and id. Summarize the sections that were added.',
    },
    {
      name: 'add-database-entry',
      description: 'Add a row to a Notion database with the correct property values.',
      content:
        '# Add Database Entry\n\nInsert a new row into a Notion database with its properties set.\n\n## Steps\n1. Run Read Database on the target database to learn its property names and types.\n2. Map the requested values to the matching properties, formatting select, date, and relation fields correctly.\n3. Run Add Database Row with the property values.\n\n## Output\nConfirm the new row id and URL, and list the property values that were written.',
    },
    {
      name: 'query-database',
      description: 'Filter and sort a Notion database to return matching entries.',
      content:
        '# Query Database\n\nRetrieve entries from a Notion database that match a condition.\n\n## Steps\n1. Read the database with Read Database to confirm the property to filter on.\n2. Build a filter and optional sort for the requested condition (for example Status equals Done, sorted by date).\n3. Run Query Database and collect the matching pages.\n\n## Output\nA list of matching entries with their key properties and page links. Note the total count.',
    },
    {
      name: 'search-and-summarize',
      description: 'Search the Notion workspace for a topic and summarize the relevant pages.',
      content:
        '# Search and Summarize\n\nFind and summarize Notion content on a given topic.\n\n## Steps\n1. Run Search Workspace with the topic keywords.\n2. Read the most relevant pages with Read Page.\n3. Synthesize the key points across the pages, citing each source page by title and link.\n\n## Output\nA short synthesized answer with citations to the Notion pages used. Note if the workspace had no relevant content.',
    },
  ],
} as const satisfies BlockMeta

export const NotionV2BlockMeta = {
  tags: ['note-taking', 'knowledge-base', 'content-management'],
  url: 'https://www.notion.com',
} as const satisfies BlockMeta
