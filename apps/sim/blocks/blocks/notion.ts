import { NotionIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { NotionResponse } from '@/tools/notion/types'

export const NotionBlock: BlockConfig<NotionResponse> = {
  type: 'notion',
  name: 'Notion',
  description: 'Manage Notion pages',
  longDescription:
    'Integrate with Notion to read content from pages, write new content, and create new pages.',
  docsLink: 'https://docs.simstudio.ai/tools/notion',
  category: 'tools',
  bgColor: '#181C1E',
  icon: NotionIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        // Read Operations
        { label: 'Read Page', id: 'notion_read' },
        { label: 'Read Database', id: 'notion_read_database' },
        // Create Operations
        { label: 'Create Page', id: 'notion_create_page' },
        { label: 'Create Database', id: 'notion_create_database' },
        // Write Operations
        { label: 'Append Content', id: 'notion_write' },
        // Query & Search Operations
        { label: 'Query Database', id: 'notion_query_database' },
        { label: 'Search Workspace', id: 'notion_search' },
      ],
    },
    {
      id: 'credential',
      title: 'Notion Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'notion',
      serviceId: 'notion',
      requiredScopes: ['workspace.content', 'workspace.name', 'page.read', 'page.write'],
      placeholder: 'Select Notion account',
    },
    // Read/Write operation - Page ID
    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Notion page ID',
      condition: {
        field: 'operation',
        value: 'notion_read',
      },
    },
    {
      id: 'databaseId',
      title: 'Database ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Notion database ID',
      condition: {
        field: 'operation',
        value: 'notion_read_database',
      },
    },
    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Notion page ID',
      condition: {
        field: 'operation',
        value: 'notion_write',
      },
    },
    // Create operation fields
    {
      id: 'parentId',
      title: 'Parent Page ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of parent page',
      condition: { field: 'operation', value: 'notion_create_page' },
    },
    {
      id: 'title',
      title: 'Page Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Title for the new page',
      condition: {
        field: 'operation',
        value: 'notion_create_page',
      },
    },
    // Content input for write/create operations
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter content to add to the page',
      condition: {
        field: 'operation',
        value: 'notion_write',
      },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter content to add to the page',
      condition: {
        field: 'operation',
        value: 'notion_create_page',
      },
    },
    // Query Database Fields
    {
      id: 'databaseId',
      title: 'Database ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Notion database ID',
      condition: { field: 'operation', value: 'notion_query_database' },
    },
    {
      id: 'filter',
      title: 'Filter (JSON)',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter filter conditions as JSON (optional)',
      condition: { field: 'operation', value: 'notion_query_database' },
    },
    {
      id: 'sorts',
      title: 'Sort Criteria (JSON)',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter sort criteria as JSON array (optional)',
      condition: { field: 'operation', value: 'notion_query_database' },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Number of results (default: 100, max: 100)',
      condition: { field: 'operation', value: 'notion_query_database' },
    },
    // Search Fields
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter search terms (leave empty for all pages)',
      condition: { field: 'operation', value: 'notion_search' },
    },
    {
      id: 'filterType',
      title: 'Filter Type',
      type: 'dropdown',
      layout: 'full',
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
      layout: 'full',
      placeholder: 'ID of parent page where database will be created',
      condition: { field: 'operation', value: 'notion_create_database' },
    },
    {
      id: 'title',
      title: 'Database Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Title for the new database',
      condition: { field: 'operation', value: 'notion_create_database' },
    },
    {
      id: 'properties',
      title: 'Database Properties (JSON)',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter database properties as JSON object',
      condition: { field: 'operation', value: 'notion_create_database' },
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

        // Parse properties from JSON string for create operations
        let parsedProperties
        if (
          (operation === 'notion_create_page' || operation === 'notion_create_database') &&
          properties
        ) {
          try {
            parsedProperties = JSON.parse(properties)
          } catch (error) {
            throw new Error(
              `Invalid JSON for properties: ${error instanceof Error ? error.message : String(error)}`
            )
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
          accessToken: credential,
          ...(parsedProperties ? { properties: parsedProperties } : {}),
          ...(parsedFilter ? { filter: JSON.stringify(parsedFilter) } : {}),
          ...(parsedSorts ? { sorts: JSON.stringify(parsedSorts) } : {}),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    pageId: { type: 'string', required: false },
    content: { type: 'string', required: false },
    // Create page inputs
    parentId: { type: 'string', required: false },
    title: { type: 'string', required: false },
    // Query database inputs
    databaseId: { type: 'string', required: false },
    filter: { type: 'string', required: false },
    sorts: { type: 'string', required: false },
    pageSize: { type: 'number', required: false },
    // Search inputs
    query: { type: 'string', required: false },
    filterType: { type: 'string', required: false },
  },
  outputs: {
    content: 'string',
    metadata: 'any',
  },
}
