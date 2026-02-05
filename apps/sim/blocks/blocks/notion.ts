import { NotionIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'
import type { NotionResponse } from '@/tools/notion/types'

// Legacy block - hidden from toolbar
export const NotionBlock: BlockConfig<NotionResponse> = {
  type: 'notion',
  name: 'Notion (Legacy)',
  hideFromToolbar: true,
  description: 'Manage Notion pages',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate with Notion into the workflow. Can read page, read database, create page, create database, append content, query database, and search workspace.',
  docsLink: 'https://docs.sim.ai/tools/notion',
  category: 'tools',
  bgColor: '#181C1E',
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
        { label: 'Create Database', id: 'notion_create_database' },
        { label: 'Add Database Row', id: 'notion_add_database_row' },
        { label: 'Append Content', id: 'notion_write' },
        { label: 'Query Database', id: 'notion_query_database' },
        { label: 'Search Workspace', id: 'notion_search' },
      ],
      value: () => 'notion_read',
    },
    {
      id: 'credential',
      title: 'Notion Account',
      type: 'oauth-input',
      serviceId: 'notion',
      placeholder: 'Select Notion account',
      required: true,
    },
    // Read/Write operation - Page ID
    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      placeholder: 'Enter Notion page ID',
      condition: {
        field: 'operation',
        value: 'notion_read',
      },
      required: true,
    },
    {
      id: 'databaseId',
      title: 'Database ID',
      type: 'short-input',
      placeholder: 'Enter Notion database ID',
      condition: {
        field: 'operation',
        value: 'notion_read_database',
      },
      required: true,
    },
    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      placeholder: 'Enter Notion page ID',
      condition: {
        field: 'operation',
        value: 'notion_write',
      },
      required: true,
    },
    // Create operation fields
    {
      id: 'parentId',
      title: 'Parent Page ID',
      type: 'short-input',
      placeholder: 'ID of parent page',
      condition: { field: 'operation', value: 'notion_create_page' },
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
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          "Generate content for a new Notion page based on the user's description. The content can include paragraphs, lists, headings, and other text elements. Format it appropriately for Notion. Return ONLY the content - no explanations.",
        placeholder: 'Describe the content you want to create...',
      },
    },
    // Query Database Fields
    {
      id: 'databaseId',
      title: 'Database ID',
      type: 'short-input',
      placeholder: 'Enter Notion database ID',
      condition: { field: 'operation', value: 'notion_query_database' },
      required: true,
    },
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
      condition: { field: 'operation', value: 'notion_query_database' },
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
      id: 'parentId',
      title: 'Parent Page ID',
      type: 'short-input',
      placeholder: 'ID of parent page where database will be created',
      condition: { field: 'operation', value: 'notion_create_database' },
      required: true,
    },
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
      id: 'databaseId',
      title: 'Database ID',
      type: 'short-input',
      placeholder: 'Enter Notion database ID',
      condition: { field: 'operation', value: 'notion_add_database_row' },
      required: true,
    },
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
          case 'notion_query_database':
            return 'notion_query_database'
          case 'notion_search':
            return 'notion_search'
          case 'notion_create_database':
            return 'notion_create_database'
          default:
            return 'notion_read'
        }
      },
      params: (params) => {
        const { credential, operation, properties, filter, sorts, ...rest } = params

        // Parse properties from JSON string for create/add operations
        let parsedProperties
        if (
          (operation === 'notion_create_page' ||
            operation === 'notion_create_database' ||
            operation === 'notion_add_database_row') &&
          properties
        ) {
          if (typeof properties === 'string') {
            try {
              parsedProperties = JSON.parse(properties)
            } catch (error) {
              throw new Error(
                `Invalid JSON for properties: ${error instanceof Error ? error.message : String(error)}`
              )
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
            throw new Error(
              `Invalid JSON for filter: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        }

        // Parse sorts for query database operations
        let parsedSorts
        if (operation === 'notion_query_database' && sorts) {
          try {
            parsedSorts = JSON.parse(sorts)
          } catch (error) {
            throw new Error(
              `Invalid JSON for sorts: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        }

        return {
          ...rest,
          credential,
          ...(parsedProperties ? { properties: parsedProperties } : {}),
          ...(parsedFilter ? { filter: JSON.stringify(parsedFilter) } : {}),
          ...(parsedSorts ? { sorts: JSON.stringify(parsedSorts) } : {}),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Notion access token' },
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
  },
  outputs: {
    // Common outputs across all Notion operations
    content: {
      type: 'string',
      description: 'Page content, search results, or confirmation messages',
    },

    // Metadata object containing operation-specific information
    metadata: {
      type: 'json',
      description:
        'Metadata containing operation-specific details including page/database info, results, and pagination data',
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
  docsLink: 'https://docs.sim.ai/tools/notion',
  category: 'tools',
  bgColor: '#181C1E',
  icon: NotionIcon,
  hideFromToolbar: false,
  subBlocks: NotionBlock.subBlocks,
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
      description: 'Page content in markdown format',
      condition: { field: 'operation', value: 'notion_read' },
    },
    title: {
      type: 'string',
      description: 'Page or database title',
    },
    url: {
      type: 'string',
      description: 'Notion URL',
    },
    id: {
      type: 'string',
      description: 'Page or database ID',
      condition: {
        field: 'operation',
        value: [
          'notion_create_page',
          'notion_create_database',
          'notion_add_database_row',
          'notion_read_database',
          'notion_update_page',
        ],
      },
    },
    created_time: {
      type: 'string',
      description: 'Creation timestamp',
    },
    last_edited_time: {
      type: 'string',
      description: 'Last edit timestamp',
    },
    // Database query/search outputs
    results: {
      type: 'array',
      description: 'Array of results from query or search',
      condition: { field: 'operation', value: ['notion_query_database', 'notion_search'] },
    },
    has_more: {
      type: 'boolean',
      description: 'Whether more results are available',
      condition: { field: 'operation', value: ['notion_query_database', 'notion_search'] },
    },
    next_cursor: {
      type: 'string',
      description: 'Cursor for pagination',
      condition: { field: 'operation', value: ['notion_query_database', 'notion_search'] },
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
  },
}
