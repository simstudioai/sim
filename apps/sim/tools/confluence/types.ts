import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property constants for Confluence tools.
 * Based on Confluence REST API v2 response schemas:
 * @see https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/
 * @see https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-space/
 * @see https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-comment/
 * @see https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-attachment/
 * @see https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-label/
 */

/**
 * Version object properties shared across pages, comments, and attachments.
 * Based on Confluence API v2 version structure.
 */
export const VERSION_OUTPUT_PROPERTIES = {
  number: { type: 'number', description: 'Version number' },
  message: { type: 'string', description: 'Version message', optional: true },
  minorEdit: { type: 'boolean', description: 'Whether this is a minor edit', optional: true },
  authorId: { type: 'string', description: 'Account ID of the version author', optional: true },
  createdAt: {
    type: 'string',
    description: 'ISO 8601 timestamp of version creation',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Detailed version object properties for get_page_version endpoint.
 * Based on Confluence API v2 DetailedVersion schema.
 */
export const DETAILED_VERSION_OUTPUT_PROPERTIES = {
  number: { type: 'number', description: 'Version number' },
  message: { type: 'string', description: 'Version message', optional: true },
  minorEdit: { type: 'boolean', description: 'Whether this is a minor edit' },
  authorId: { type: 'string', description: 'Account ID of the version author', optional: true },
  createdAt: {
    type: 'string',
    description: 'ISO 8601 timestamp of version creation',
    optional: true,
  },
  contentTypeModified: {
    type: 'boolean',
    description: 'Whether the content type was modified in this version',
    optional: true,
  },
  collaborators: {
    type: 'array',
    description: 'List of collaborator account IDs for this version',
    items: { type: 'string' },
    optional: true,
  },
  prevVersion: {
    type: 'number',
    description: 'Previous version number',
    optional: true,
  },
  nextVersion: {
    type: 'number',
    description: 'Next version number',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete detailed version object output definition.
 */
export const DETAILED_VERSION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Detailed version information',
  properties: DETAILED_VERSION_OUTPUT_PROPERTIES,
}

/**
 * Complete version object output definition.
 */
export const VERSION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Version information',
  properties: VERSION_OUTPUT_PROPERTIES,
}

/**
 * Page item properties from Confluence API v2.
 * Based on GET /wiki/api/v2/pages response structure.
 */
export const PAGE_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Unique page identifier' },
  title: { type: 'string', description: 'Page title' },
  status: { type: 'string', description: 'Page status (e.g., current, archived, trashed, draft)' },
  spaceId: { type: 'string', description: 'ID of the space containing the page' },
  parentId: {
    type: 'string',
    description: 'ID of the parent page (null if top-level)',
    optional: true,
  },
  authorId: { type: 'string', description: 'Account ID of the page author' },
  createdAt: { type: 'string', description: 'ISO 8601 timestamp when the page was created' },
  version: {
    type: 'object',
    description: 'Page version information',
    properties: VERSION_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete page object output definition.
 */
export const PAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Confluence page object',
  properties: PAGE_ITEM_PROPERTIES,
}

/**
 * Pages array output definition for list endpoints.
 */
export const PAGES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Confluence pages',
  items: {
    type: 'object',
    properties: PAGE_ITEM_PROPERTIES,
  },
}

/**
 * Space description object properties.
 * Based on Confluence API v2 space description structure.
 */
export const SPACE_DESCRIPTION_OUTPUT_PROPERTIES = {
  value: { type: 'string', description: 'Description text content' },
  representation: {
    type: 'string',
    description: 'Content representation format (e.g., plain, view, storage)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Space item properties from Confluence API v2.
 * Based on GET /wiki/api/v2/spaces response structure.
 */
export const SPACE_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Unique space identifier' },
  key: { type: 'string', description: 'Space key (short identifier used in URLs)' },
  name: { type: 'string', description: 'Space name' },
  type: { type: 'string', description: 'Space type (e.g., global, personal)' },
  status: { type: 'string', description: 'Space status (e.g., current, archived)' },
  authorId: { type: 'string', description: 'Account ID of the space creator', optional: true },
  createdAt: {
    type: 'string',
    description: 'ISO 8601 timestamp when the space was created',
    optional: true,
  },
  homepageId: { type: 'string', description: 'ID of the space homepage', optional: true },
  description: {
    type: 'object',
    description: 'Space description',
    properties: SPACE_DESCRIPTION_OUTPUT_PROPERTIES,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete space object output definition.
 */
export const SPACE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Confluence space object',
  properties: SPACE_ITEM_PROPERTIES,
}

/**
 * Spaces array output definition for list endpoints.
 */
export const SPACES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Confluence spaces',
  items: {
    type: 'object',
    properties: SPACE_ITEM_PROPERTIES,
  },
}

/**
 * Body format inner object properties (storage, view, atlas_doc_format).
 * Based on Confluence API v2 body structure.
 */
export const BODY_FORMAT_PROPERTIES = {
  value: { type: 'string', description: 'The content value in the specified format' },
  representation: {
    type: 'string',
    description: 'Content representation type',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Page/Blog post body object properties.
 * Based on Confluence API v2 body structure with multiple format options.
 */
export const CONTENT_BODY_OUTPUT_PROPERTIES = {
  storage: {
    type: 'object',
    description: 'Body in storage format (Confluence markup)',
    properties: BODY_FORMAT_PROPERTIES,
    optional: true,
  },
  view: {
    type: 'object',
    description: 'Body in view format (rendered HTML)',
    properties: BODY_FORMAT_PROPERTIES,
    optional: true,
  },
  atlas_doc_format: {
    type: 'object',
    description: 'Body in Atlassian Document Format (ADF)',
    properties: BODY_FORMAT_PROPERTIES,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete body object output definition for pages and blog posts.
 */
export const CONTENT_BODY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Page or blog post body content in requested format(s)',
  properties: CONTENT_BODY_OUTPUT_PROPERTIES,
  optional: true,
}

/**
 * Comment body object properties.
 * Based on Confluence API v2 comment body structure.
 */
export const COMMENT_BODY_OUTPUT_PROPERTIES = {
  value: { type: 'string', description: 'Comment body content' },
  representation: {
    type: 'string',
    description: 'Content representation format (e.g., storage, view)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Comment item properties from Confluence API v2.
 * Based on GET /wiki/api/v2/footer-comments and GET /wiki/api/v2/inline-comments response.
 */
export const COMMENT_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Unique comment identifier' },
  status: { type: 'string', description: 'Comment status (e.g., current)' },
  title: { type: 'string', description: 'Comment title', optional: true },
  pageId: { type: 'string', description: 'ID of the page the comment belongs to', optional: true },
  blogPostId: {
    type: 'string',
    description: 'ID of the blog post the comment belongs to',
    optional: true,
  },
  parentCommentId: { type: 'string', description: 'ID of the parent comment', optional: true },
  body: {
    type: 'object',
    description: 'Comment body content',
    properties: COMMENT_BODY_OUTPUT_PROPERTIES,
    optional: true,
  },
  createdAt: { type: 'string', description: 'ISO 8601 timestamp when the comment was created' },
  authorId: { type: 'string', description: 'Account ID of the comment author' },
  version: {
    type: 'object',
    description: 'Comment version information',
    properties: VERSION_OUTPUT_PROPERTIES,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete comment object output definition.
 */
export const COMMENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Confluence comment object',
  properties: COMMENT_ITEM_PROPERTIES,
}

/**
 * Comments array output definition for list endpoints.
 */
export const COMMENTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Confluence comments',
  items: {
    type: 'object',
    properties: COMMENT_ITEM_PROPERTIES,
  },
}

/**
 * Attachment item properties from Confluence API v2.
 * Based on GET /wiki/api/v2/attachments response structure.
 */
export const ATTACHMENT_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Unique attachment identifier (prefixed with "att")' },
  title: { type: 'string', description: 'Attachment file name' },
  status: { type: 'string', description: 'Attachment status (e.g., current, archived, trashed)' },
  mediaType: { type: 'string', description: 'MIME type of the attachment' },
  fileSize: { type: 'number', description: 'File size in bytes' },
  downloadUrl: { type: 'string', description: 'URL to download the attachment' },
  webuiUrl: {
    type: 'string',
    description: 'URL to view the attachment in Confluence UI',
    optional: true,
  },
  pageId: {
    type: 'string',
    description: 'ID of the page the attachment belongs to',
    optional: true,
  },
  blogPostId: {
    type: 'string',
    description: 'ID of the blog post the attachment belongs to',
    optional: true,
  },
  comment: { type: 'string', description: 'Comment/description of the attachment', optional: true },
  version: {
    type: 'object',
    description: 'Attachment version information',
    properties: VERSION_OUTPUT_PROPERTIES,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete attachment object output definition.
 */
export const ATTACHMENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Confluence attachment object',
  properties: ATTACHMENT_ITEM_PROPERTIES,
}

/**
 * Attachments array output definition for list endpoints.
 */
export const ATTACHMENTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Confluence attachments',
  items: {
    type: 'object',
    properties: ATTACHMENT_ITEM_PROPERTIES,
  },
}

/**
 * Label item properties from Confluence API v2.
 * Based on GET /wiki/api/v2/labels response structure.
 */
export const LABEL_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Unique label identifier' },
  name: { type: 'string', description: 'Label name' },
  prefix: { type: 'string', description: 'Label prefix/type (e.g., global, my, team)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete label object output definition.
 */
export const LABEL_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Confluence label object',
  properties: LABEL_ITEM_PROPERTIES,
}

/**
 * Labels array output definition for list endpoints.
 */
export const LABELS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Confluence labels',
  items: {
    type: 'object',
    properties: LABEL_ITEM_PROPERTIES,
  },
}

/**
 * Search result space info properties.
 * Based on Confluence search API space object in results.
 */
export const SEARCH_RESULT_SPACE_PROPERTIES = {
  id: { type: 'string', description: 'Space identifier' },
  key: { type: 'string', description: 'Space key' },
  name: { type: 'string', description: 'Space name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Search result item properties from Confluence API.
 * Based on GET /wiki/rest/api/search response structure.
 */
export const SEARCH_RESULT_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Unique content identifier' },
  title: { type: 'string', description: 'Content title' },
  type: { type: 'string', description: 'Content type (e.g., page, blogpost, attachment, comment)' },
  status: { type: 'string', description: 'Content status (e.g., current)', optional: true },
  url: { type: 'string', description: 'URL to view the content in Confluence' },
  excerpt: { type: 'string', description: 'Text excerpt matching the search query' },
  spaceKey: {
    type: 'string',
    description: 'Key of the space containing the content',
    optional: true,
  },
  space: {
    type: 'object',
    description: 'Space information for the content',
    properties: SEARCH_RESULT_SPACE_PROPERTIES,
    optional: true,
  },
  lastModified: {
    type: 'string',
    description: 'ISO 8601 timestamp of last modification',
    optional: true,
  },
  entityType: {
    type: 'string',
    description: 'Entity type identifier (e.g., content, space)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search result object output definition.
 */
export const SEARCH_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Confluence search result object',
  properties: SEARCH_RESULT_ITEM_PROPERTIES,
}

/**
 * Search results array output definition.
 */
export const SEARCH_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of search results',
  items: {
    type: 'object',
    properties: SEARCH_RESULT_ITEM_PROPERTIES,
  },
}

/**
 * Pagination links properties for list responses.
 */
export const PAGINATION_LINKS_PROPERTIES = {
  next: { type: 'string', description: 'URL to fetch the next page of results', optional: true },
  base: { type: 'string', description: 'Base URL for the API', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Common timestamp output property.
 */
export const TIMESTAMP_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'ISO 8601 timestamp of the operation',
}

/**
 * Common page ID output property.
 */
export const PAGE_ID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Confluence page ID',
}

/**
 * Common success status output property.
 */
export const SUCCESS_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Operation success status',
}

/**
 * Common deleted status output property.
 */
export const DELETED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Deletion status',
}

/**
 * Common URL output property.
 */
export const URL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'URL to view in Confluence',
}

// Page operations
export interface ConfluenceRetrieveParams {
  accessToken: string
  pageId: string
  domain: string
  cloudId?: string
}

export interface ConfluenceRetrieveResponse extends ToolResponse {
  output: {
    ts: string
    pageId: string
    content: string
    title: string
  }
}

export interface ConfluencePage {
  id: string
  title: string
  spaceKey?: string
  url?: string
  lastModified?: string
}

export interface ConfluenceUpdateParams {
  accessToken: string
  domain: string
  pageId: string
  title?: string
  content?: string
  version?: number
  cloudId?: string
}

export interface ConfluenceUpdateResponse extends ToolResponse {
  output: {
    ts: string
    pageId: string
    title: string
    success: boolean
  }
}

export interface ConfluenceCreatePageParams {
  accessToken: string
  domain: string
  spaceId: string
  title: string
  content: string
  parentId?: string
  cloudId?: string
}

export interface ConfluenceCreatePageResponse extends ToolResponse {
  output: {
    ts: string
    pageId: string
    title: string
    url: string
  }
}

export interface ConfluenceDeletePageParams {
  accessToken: string
  domain: string
  pageId: string
  cloudId?: string
}

export interface ConfluenceDeletePageResponse extends ToolResponse {
  output: {
    ts: string
    pageId: string
    deleted: boolean
  }
}

// Search operations
export interface ConfluenceSearchParams {
  accessToken: string
  domain: string
  query: string
  limit?: number
  cloudId?: string
}

export interface ConfluenceSearchResponse extends ToolResponse {
  output: {
    ts: string
    results: Array<{
      id: string
      title: string
      type: string
      url: string
      excerpt: string
    }>
  }
}

// Comment operations
export interface ConfluenceCommentParams {
  accessToken: string
  domain: string
  pageId: string
  comment: string
  cloudId?: string
}

export interface ConfluenceCommentResponse extends ToolResponse {
  output: {
    ts: string
    commentId: string
    pageId: string
  }
}

// Attachment operations
export interface ConfluenceAttachmentParams {
  accessToken: string
  domain: string
  pageId?: string
  attachmentId?: string
  limit?: number
  cloudId?: string
}

export interface ConfluenceAttachmentResponse extends ToolResponse {
  output: {
    ts: string
    attachments?: Array<{
      id: string
      title: string
      fileSize: number
      mediaType: string
      downloadUrl: string
    }>
    attachmentId?: string
    deleted?: boolean
  }
}

export interface ConfluenceUploadAttachmentParams {
  accessToken: string
  domain: string
  pageId: string
  file: any
  fileName?: string
  comment?: string
  cloudId?: string
}

export interface ConfluenceUploadAttachmentResponse extends ToolResponse {
  output: {
    ts: string
    attachmentId: string
    title: string
    fileSize: number
    mediaType: string
    downloadUrl: string
    pageId: string
  }
}

// Label operations
export interface ConfluenceLabelParams {
  accessToken: string
  domain: string
  pageId: string
  labelName?: string
  cloudId?: string
}

export interface ConfluenceLabelResponse extends ToolResponse {
  output: {
    ts: string
    labels?: Array<{
      id: string
      name: string
      prefix: string
    }>
    pageId?: string
    labelName?: string
    added?: boolean
    removed?: boolean
  }
}

// Space operations
export interface ConfluenceSpaceParams {
  accessToken: string
  domain: string
  spaceId?: string
  limit?: number
  cloudId?: string
}

export interface ConfluenceSpaceResponse extends ToolResponse {
  output: {
    ts: string
    spaces?: Array<{
      id: string
      name: string
      key: string
      type: string
      status: string
    }>
    spaceId?: string
    name?: string
    key?: string
    type?: string
    status?: string
  }
}

export type ConfluenceResponse =
  | ConfluenceRetrieveResponse
  | ConfluenceUpdateResponse
  | ConfluenceCreatePageResponse
  | ConfluenceDeletePageResponse
  | ConfluenceSearchResponse
  | ConfluenceCommentResponse
  | ConfluenceAttachmentResponse
  | ConfluenceUploadAttachmentResponse
  | ConfluenceLabelResponse
  | ConfluenceSpaceResponse
