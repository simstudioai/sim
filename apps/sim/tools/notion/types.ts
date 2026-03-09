import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Notion API responses.
 * Based on official Notion API documentation at https://developers.notion.com/reference/
 *
 * @see https://developers.notion.com/reference/page
 * @see https://developers.notion.com/reference/database
 * @see https://developers.notion.com/reference/block
 * @see https://developers.notion.com/reference/user
 * @see https://developers.notion.com/reference/rich-text
 * @see https://developers.notion.com/reference/file-object
 * @see https://developers.notion.com/reference/parent-object
 */

/**
 * Partial User object properties returned by Notion API.
 * Used for created_by and last_edited_by fields.
 * @see https://developers.notion.com/reference/user
 */
export const PARTIAL_USER_OUTPUT_PROPERTIES = {
  object: { type: 'string', description: 'Always "user"' },
  id: { type: 'string', description: 'User UUID' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete partial user output definition
 */
export const PARTIAL_USER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Partial user object',
  properties: PARTIAL_USER_OUTPUT_PROPERTIES,
}

/**
 * Full User object properties returned by Notion API.
 * @see https://developers.notion.com/reference/user
 */
export const USER_OUTPUT_PROPERTIES = {
  object: { type: 'string', description: 'Always "user"' },
  id: { type: 'string', description: 'User UUID' },
  type: { type: 'string', description: 'User type: "person" or "bot"', optional: true },
  name: { type: 'string', description: 'User display name', optional: true },
  avatar_url: { type: 'string', description: 'URL to user avatar image', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete user output definition
 */
export const USER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'User object',
  properties: USER_OUTPUT_PROPERTIES,
}

/**
 * Parent object properties for pages and databases.
 * @see https://developers.notion.com/reference/parent-object
 */
export const PARENT_OUTPUT_PROPERTIES = {
  type: {
    type: 'string',
    description:
      'Parent type: "database_id", "data_source_id", "page_id", "workspace", or "block_id"',
  },
  database_id: {
    type: 'string',
    description: 'Parent database UUID (if type is database_id)',
    optional: true,
  },
  data_source_id: {
    type: 'string',
    description: 'Parent data source UUID (if type is data_source_id)',
    optional: true,
  },
  page_id: { type: 'string', description: 'Parent page UUID (if type is page_id)', optional: true },
  workspace: {
    type: 'boolean',
    description: 'True if parent is workspace (if type is workspace)',
    optional: true,
  },
  block_id: {
    type: 'string',
    description: 'Parent block UUID (if type is block_id)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete parent output definition
 */
export const PARENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Parent object specifying hierarchical relationship',
  properties: PARENT_OUTPUT_PROPERTIES,
}

/**
 * Rich text annotation properties.
 * @see https://developers.notion.com/reference/rich-text
 */
export const ANNOTATIONS_OUTPUT_PROPERTIES = {
  bold: { type: 'boolean', description: 'Bold styling' },
  italic: { type: 'boolean', description: 'Italic styling' },
  strikethrough: { type: 'boolean', description: 'Strikethrough styling' },
  underline: { type: 'boolean', description: 'Underline styling' },
  code: { type: 'boolean', description: 'Code styling' },
  color: {
    type: 'string',
    description:
      'Text color (default, blue, green, red, purple, orange, pink, gray, brown, yellow, or _background variants)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Rich text object properties.
 * @see https://developers.notion.com/reference/rich-text
 */
export const RICH_TEXT_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Rich text type: "text", "mention", or "equation"' },
  plain_text: { type: 'string', description: 'Plain text content without annotations' },
  href: { type: 'string', description: 'URL for links or Notion mentions', optional: true },
  annotations: {
    type: 'object',
    description: 'Text styling annotations',
    properties: ANNOTATIONS_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete rich text array output definition
 */
export const RICH_TEXT_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of rich text objects',
  items: {
    type: 'object',
    properties: RICH_TEXT_OUTPUT_PROPERTIES,
  },
}

/**
 * Notion-hosted file object properties (type: "file").
 * @see https://developers.notion.com/reference/file-object
 */
export const NOTION_FILE_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'Authenticated URL valid for one hour' },
  expiry_time: { type: 'string', description: 'ISO 8601 timestamp when URL expires' },
} as const satisfies Record<string, OutputProperty>

/**
 * API-uploaded file object properties (type: "file_upload").
 * @see https://developers.notion.com/reference/file-object
 */
export const FILE_UPLOAD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'File upload UUID' },
} as const satisfies Record<string, OutputProperty>

/**
 * External file object properties (type: "external").
 * @see https://developers.notion.com/reference/file-object
 */
export const EXTERNAL_FILE_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'External file URL (never expires)' },
} as const satisfies Record<string, OutputProperty>

/**
 * File object properties.
 * @see https://developers.notion.com/reference/file-object
 */
export const FILE_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'File type: "file", "file_upload", or "external"' },
  file: {
    type: 'object',
    description: 'Notion-hosted file object (when type is "file")',
    optional: true,
    properties: NOTION_FILE_OUTPUT_PROPERTIES,
  },
  file_upload: {
    type: 'object',
    description: 'API-uploaded file object (when type is "file_upload")',
    optional: true,
    properties: FILE_UPLOAD_OUTPUT_PROPERTIES,
  },
  external: {
    type: 'object',
    description: 'External file object (when type is "external")',
    optional: true,
    properties: EXTERNAL_FILE_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete file output definition
 */
export const FILE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'File object',
  properties: FILE_OUTPUT_PROPERTIES,
}

/**
 * Emoji object properties.
 * @see https://developers.notion.com/reference/emoji-object
 */
export const EMOJI_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Always "emoji" for standard emojis' },
  emoji: { type: 'string', description: 'The emoji character' },
} as const satisfies Record<string, OutputProperty>

/**
 * Custom emoji object properties.
 * @see https://developers.notion.com/reference/emoji-object
 */
export const CUSTOM_EMOJI_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Always "custom_emoji"' },
  custom_emoji: {
    type: 'object',
    description: 'Custom emoji details',
    properties: {
      id: { type: 'string', description: 'Custom emoji UUID' },
      name: { type: 'string', description: 'Custom emoji name', optional: true },
      url: { type: 'string', description: 'URL to custom emoji image', optional: true },
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Icon output (can be emoji, custom_emoji, or file)
 */
export const ICON_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Page/database icon (emoji, custom_emoji, or file)',
  optional: true,
  properties: {
    type: { type: 'string', description: 'Icon type: "emoji", "custom_emoji", or "file"' },
    emoji: { type: 'string', description: 'Emoji character (if type is emoji)', optional: true },
    custom_emoji: {
      type: 'object',
      description: 'Custom emoji object (if type is custom_emoji)',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Custom emoji UUID' },
        name: { type: 'string', description: 'Custom emoji name', optional: true },
        url: { type: 'string', description: 'URL to custom emoji image', optional: true },
      },
    },
    file: {
      type: 'object',
      description: 'Notion-hosted file (if type is file)',
      optional: true,
      properties: NOTION_FILE_OUTPUT_PROPERTIES,
    },
    external: {
      type: 'object',
      description: 'External file (if type is external)',
      optional: true,
      properties: EXTERNAL_FILE_OUTPUT_PROPERTIES,
    },
  },
}

/**
 * Cover output (file object for page/database covers)
 */
export const COVER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Page/database cover image',
  optional: true,
  properties: FILE_OUTPUT_PROPERTIES,
}

/**
 * Common page object properties from Notion API.
 * @see https://developers.notion.com/reference/page
 */
export const PAGE_OUTPUT_PROPERTIES = {
  object: { type: 'string', description: 'Always "page"' },
  id: { type: 'string', description: 'Page UUID' },
  created_time: { type: 'string', description: 'ISO 8601 creation timestamp' },
  last_edited_time: { type: 'string', description: 'ISO 8601 last edit timestamp' },
  created_by: PARTIAL_USER_OUTPUT,
  last_edited_by: PARTIAL_USER_OUTPUT,
  archived: { type: 'boolean', description: 'Whether the page is archived' },
  in_trash: { type: 'boolean', description: 'Whether the page is in trash' },
  url: { type: 'string', description: 'Notion page URL' },
  public_url: {
    type: 'string',
    description: 'Public web URL if shared, null otherwise',
    optional: true,
  },
  parent: PARENT_OUTPUT,
  icon: ICON_OUTPUT,
  cover: COVER_OUTPUT,
  properties: {
    type: 'object',
    description:
      'Page property values (structure depends on parent type - database properties or title only)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete page output definition for array items
 */
export const PAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Notion page object',
  properties: PAGE_OUTPUT_PROPERTIES,
}

/**
 * Simplified page output properties for read operations (flattened structure).
 * Used by notion_read and notion_read_v2 tools.
 */
export const PAGE_READ_OUTPUT_PROPERTIES = {
  content: {
    type: 'string',
    description: 'Page content in markdown format with headers, paragraphs, lists, and todos',
  },
  title: { type: 'string', description: 'Page title' },
  url: { type: 'string', description: 'Notion page URL' },
  created_time: { type: 'string', description: 'ISO 8601 creation timestamp' },
  last_edited_time: { type: 'string', description: 'ISO 8601 last edit timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Page metadata output properties for legacy tools.
 * Used by notion_read, notion_create_page, notion_update_page.
 */
export const PAGE_METADATA_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Page title' },
  lastEditedTime: { type: 'string', description: 'ISO 8601 last edit timestamp' },
  createdTime: { type: 'string', description: 'ISO 8601 creation timestamp' },
  url: { type: 'string', description: 'Notion page URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Page metadata output for create/update operations.
 */
export const PAGE_MUTATION_METADATA_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Page title' },
  pageId: { type: 'string', description: 'Page UUID' },
  url: { type: 'string', description: 'Notion page URL' },
  lastEditedTime: { type: 'string', description: 'ISO 8601 last edit timestamp' },
  createdTime: { type: 'string', description: 'ISO 8601 creation timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete page metadata output definition
 */
export const PAGE_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Page metadata including title, URL, and timestamps',
  properties: PAGE_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Page mutation metadata output definition (for create/update)
 */
export const PAGE_MUTATION_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Page metadata including title, page ID, URL, and timestamps',
  properties: PAGE_MUTATION_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Common database object properties from Notion API.
 * @see https://developers.notion.com/reference/database
 */
export const DATABASE_OUTPUT_PROPERTIES = {
  object: { type: 'string', description: 'Always "database"' },
  id: { type: 'string', description: 'Database UUID' },
  created_time: { type: 'string', description: 'ISO 8601 creation timestamp' },
  last_edited_time: { type: 'string', description: 'ISO 8601 last edit timestamp' },
  created_by: PARTIAL_USER_OUTPUT,
  last_edited_by: PARTIAL_USER_OUTPUT,
  title: RICH_TEXT_ARRAY_OUTPUT,
  description: RICH_TEXT_ARRAY_OUTPUT,
  icon: ICON_OUTPUT,
  cover: COVER_OUTPUT,
  parent: PARENT_OUTPUT,
  url: { type: 'string', description: 'Notion database URL' },
  public_url: {
    type: 'string',
    description: 'Public web URL if shared, null otherwise',
    optional: true,
  },
  archived: { type: 'boolean', description: 'Whether the database is archived' },
  in_trash: { type: 'boolean', description: 'Whether the database is in trash' },
  is_inline: { type: 'boolean', description: 'Whether displayed as inline block or child page' },
  properties: { type: 'object', description: 'Database properties schema' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete database output definition for array items
 */
export const DATABASE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Notion database object',
  properties: DATABASE_OUTPUT_PROPERTIES,
}

/**
 * Database metadata output properties for legacy tools.
 * Used by notion_read_database, notion_create_database.
 */
export const DATABASE_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Database UUID' },
  title: { type: 'string', description: 'Database title' },
  url: { type: 'string', description: 'Notion database URL' },
  createdTime: { type: 'string', description: 'ISO 8601 creation timestamp' },
  lastEditedTime: { type: 'string', description: 'ISO 8601 last edit timestamp' },
  properties: { type: 'object', description: 'Database properties schema' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete database metadata output definition
 */
export const DATABASE_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Database metadata including title, ID, URL, timestamps, and properties schema',
  properties: DATABASE_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Block object properties from Notion API.
 * @see https://developers.notion.com/reference/block
 */
export const BLOCK_OUTPUT_PROPERTIES = {
  object: { type: 'string', description: 'Always "block"' },
  id: { type: 'string', description: 'Block UUID' },
  parent: PARENT_OUTPUT,
  type: {
    type: 'string',
    description: 'Block type (paragraph, heading_1, heading_2, heading_3, image, etc.)',
  },
  created_time: { type: 'string', description: 'ISO 8601 creation timestamp' },
  last_edited_time: { type: 'string', description: 'ISO 8601 last edit timestamp' },
  created_by: PARTIAL_USER_OUTPUT,
  last_edited_by: PARTIAL_USER_OUTPUT,
  archived: { type: 'boolean', description: 'Whether the block is archived' },
  in_trash: { type: 'boolean', description: 'Whether the block is in trash' },
  has_children: { type: 'boolean', description: 'Whether the block has nested blocks' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete block output definition for array items
 */
export const BLOCK_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Notion block object',
  properties: BLOCK_OUTPUT_PROPERTIES,
}

/**
 * Pagination output properties for list responses.
 * @see https://developers.notion.com/reference/intro (JSON conventions - Pagination section)
 */
export const PAGINATION_OUTPUT_PROPERTIES = {
  object: { type: 'string', description: 'Always "list"' },
  has_more: { type: 'boolean', description: 'Whether more results are available' },
  next_cursor: { type: 'string', description: 'Cursor for next page of results', optional: true },
  type: {
    type: 'string',
    description: 'Type of items in results (e.g., "page_or_database", "page_or_data_source")',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Search/query results array output with page items
 */
export const SEARCH_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of search results (pages and/or databases)',
  items: {
    type: 'object',
    properties: {
      object: { type: 'string', description: 'Object type: "page" or "database"' },
      id: { type: 'string', description: 'Object UUID' },
      created_time: { type: 'string', description: 'ISO 8601 creation timestamp' },
      last_edited_time: { type: 'string', description: 'ISO 8601 last edit timestamp' },
      created_by: PARTIAL_USER_OUTPUT,
      last_edited_by: PARTIAL_USER_OUTPUT,
      archived: { type: 'boolean', description: 'Whether the object is archived' },
      in_trash: { type: 'boolean', description: 'Whether the object is in trash' },
      url: { type: 'string', description: 'Object URL' },
      public_url: { type: 'string', description: 'Public web URL if shared', optional: true },
      parent: PARENT_OUTPUT,
      properties: { type: 'object', description: 'Object properties' },
    },
  },
}

/**
 * Search metadata output properties for legacy tools.
 */
export const SEARCH_METADATA_OUTPUT_PROPERTIES = {
  totalResults: { type: 'number', description: 'Number of results returned' },
  hasMore: { type: 'boolean', description: 'Whether more results are available' },
  nextCursor: { type: 'string', description: 'Cursor for next page of results', optional: true },
  results: SEARCH_RESULTS_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search metadata output definition
 */
export const SEARCH_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Search metadata including total results count, pagination info, and raw results',
  properties: SEARCH_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Database query results array output with page items
 */
export const DATABASE_QUERY_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of page objects from the database',
  items: {
    type: 'object',
    properties: PAGE_OUTPUT_PROPERTIES,
  },
}

/**
 * Query metadata output properties for legacy tools.
 */
export const QUERY_METADATA_OUTPUT_PROPERTIES = {
  totalResults: { type: 'number', description: 'Number of results returned' },
  hasMore: { type: 'boolean', description: 'Whether more results are available' },
  nextCursor: { type: 'string', description: 'Cursor for next page of results', optional: true },
  results: DATABASE_QUERY_RESULTS_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete query metadata output definition
 */
export const QUERY_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Query metadata including total results, pagination info, and raw results array',
  properties: QUERY_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Row output properties for add_database_row operations.
 */
export const ROW_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Row (page) UUID' },
  url: { type: 'string', description: 'Notion page URL' },
  title: { type: 'string', description: 'Row title' },
  created_time: { type: 'string', description: 'ISO 8601 creation timestamp' },
  last_edited_time: { type: 'string', description: 'ISO 8601 last edit timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Write operation output properties.
 */
export const WRITE_OUTPUT_PROPERTIES = {
  appended: { type: 'boolean', description: 'Whether content was successfully appended' },
} as const satisfies Record<string, OutputProperty>

export interface NotionReadParams {
  pageId: string
  accessToken: string
}

export interface NotionResponse extends ToolResponse {
  output: {
    content: string
    metadata?: {
      title?: string
      lastEditedTime?: string
      createdTime?: string
      url?: string
      // Additional metadata for query/search operations
      totalResults?: number
      hasMore?: boolean
      nextCursor?: string | null
      results?: any[]
      // Additional metadata for create operations
      id?: string
      properties?: Record<string, any>
    }
  }
}

export interface NotionWriteParams {
  pageId: string
  content: string
  accessToken: string
}

export interface NotionCreatePageParams {
  parentId: string
  title?: string
  content?: string
  accessToken: string
}

export interface NotionUpdatePageParams {
  pageId: string
  properties: Record<string, any>
  accessToken: string
}

export interface NotionQueryDatabaseParams {
  databaseId: string
  filter?: string
  sorts?: string
  pageSize?: number
  accessToken: string
}

export interface NotionSearchParams {
  query?: string
  filterType?: string
  pageSize?: number
  accessToken: string
}

export interface NotionCreateDatabaseParams {
  parentId: string
  title: string
  properties?: Record<string, any>
  accessToken: string
}

export interface NotionReadDatabaseParams {
  databaseId: string
  accessToken: string
}

export interface NotionAddDatabaseRowParams {
  databaseId: string
  properties: Record<string, any>
  accessToken: string
}
