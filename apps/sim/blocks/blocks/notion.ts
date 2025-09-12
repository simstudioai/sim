import { NotionIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { NotionResponse } from '@/tools/notion/types'

export const NotionBlock: BlockConfig<NotionResponse> = {
  type: 'notion',
  name: 'Notion',
  description: 'Manage Notion pages',
  longDescription:
    'Integrate with Notion into the workflow. Can read page, read database, create page, create database, append content, query database, and search workspace. Requires OAuth.',
  docsLink: 'https://docs.sim.ai/tools/notion',
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
        { label: 'Read Page', id: 'notion_read' },
        { label: 'Read Database', id: 'notion_read_database' },
        { label: 'Create Page', id: 'notion_create_page' },
        { label: 'Create Database', id: 'notion_create_database' },
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
      layout: 'full',
      provider: 'notion',
      serviceId: 'notion',
      requiredScopes: ['workspace.content', 'workspace.name', 'page.read', 'page.write'],
      placeholder: 'Select Notion account',
      required: true,
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
      required: true,
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
      required: true,
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
      required: true,
    },
    // Create operation fields
    {
      id: 'parentId',
      title: 'Parent Page ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of parent page',
      condition: { field: 'operation', value: 'notion_create_page' },
      required: true,
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
      required: true,
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
      required: true,
    },
    // Query Database Fields
    {
      id: 'databaseId',
      title: 'Database ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Notion database ID',
      condition: { field: 'operation', value: 'notion_query_database' },
      required: true,
    },
    {
      id: 'filter',
      title: 'Filter (JSON)',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter filter conditions as JSON (optional)',
      condition: { field: 'operation', value: 'notion_query_database' },
      required: true,
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
      required: true,
    },
    {
      id: 'title',
      title: 'Database Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Title for the new database',
      condition: { field: 'operation', value: 'notion_create_database' },
      required: true,
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
