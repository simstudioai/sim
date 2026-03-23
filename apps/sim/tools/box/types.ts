import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface BoxUploadFileParams {
  accessToken: string
  parentFolderId: string
  file?: unknown
  fileContent?: string
  fileName?: string
}

export interface BoxDownloadFileParams {
  accessToken: string
  fileId: string
}

export interface BoxGetFileInfoParams {
  accessToken: string
  fileId: string
}

export interface BoxListFolderItemsParams {
  accessToken: string
  folderId: string
  limit?: number
  offset?: number
  sort?: string
  direction?: string
}

export interface BoxCreateFolderParams {
  accessToken: string
  name: string
  parentFolderId: string
}

export interface BoxDeleteFileParams {
  accessToken: string
  fileId: string
}

export interface BoxDeleteFolderParams {
  accessToken: string
  folderId: string
  recursive?: boolean
}

export interface BoxCopyFileParams {
  accessToken: string
  fileId: string
  parentFolderId: string
  name?: string
}

export interface BoxSearchParams {
  accessToken: string
  query: string
  limit?: number
  offset?: number
  ancestorFolderId?: string
  fileExtensions?: string
  type?: string
}

export interface BoxUpdateFileParams {
  accessToken: string
  fileId: string
  name?: string
  description?: string
  parentFolderId?: string
  tags?: string
}

export interface BoxUploadFileResponse extends ToolResponse {
  output: {
    id: string
    name: string
    size: number
    sha1: string | null
    createdAt: string | null
    modifiedAt: string | null
    parentId: string | null
    parentName: string | null
  }
}

export interface BoxDownloadFileResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string
      size: number
    }
    content: string
  }
}

export interface BoxFileInfoResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
    size: number
    sha1: string | null
    createdAt: string | null
    modifiedAt: string | null
    createdBy: { id: string; name: string; login: string } | null
    modifiedBy: { id: string; name: string; login: string } | null
    ownedBy: { id: string; name: string; login: string } | null
    parentId: string | null
    parentName: string | null
    sharedLink: Record<string, unknown> | null
    tags: string[]
    commentCount: number | null
  }
}

export interface BoxFolderItemsResponse extends ToolResponse {
  output: {
    entries: Array<Record<string, unknown>>
    totalCount: number
    offset: number
    limit: number
  }
}

export interface BoxFolderResponse extends ToolResponse {
  output: {
    id: string
    name: string
    createdAt: string | null
    modifiedAt: string | null
    parentId: string | null
    parentName: string | null
  }
}

export interface BoxSearchResponse extends ToolResponse {
  output: {
    results: Array<Record<string, unknown>>
    totalCount: number
  }
}

const USER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'User ID' },
  name: { type: 'string', description: 'User name' },
  login: { type: 'string', description: 'User email/login' },
} as const satisfies Record<string, OutputProperty>

export const FILE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'File ID' },
  name: { type: 'string', description: 'File name' },
  description: { type: 'string', description: 'File description', optional: true },
  size: { type: 'number', description: 'File size in bytes' },
  sha1: { type: 'string', description: 'SHA1 hash of file content', optional: true },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  modifiedAt: { type: 'string', description: 'Last modified timestamp', optional: true },
  createdBy: {
    type: 'object',
    description: 'User who created the file',
    optional: true,
    properties: USER_OUTPUT_PROPERTIES,
  },
  modifiedBy: {
    type: 'object',
    description: 'User who last modified the file',
    optional: true,
    properties: USER_OUTPUT_PROPERTIES,
  },
  ownedBy: {
    type: 'object',
    description: 'User who owns the file',
    optional: true,
    properties: USER_OUTPUT_PROPERTIES,
  },
  parentId: { type: 'string', description: 'Parent folder ID', optional: true },
  parentName: { type: 'string', description: 'Parent folder name', optional: true },
  sharedLink: { type: 'json', description: 'Shared link details', optional: true },
  tags: {
    type: 'array',
    description: 'File tags',
    items: { type: 'string' },
    optional: true,
  },
  commentCount: { type: 'number', description: 'Number of comments', optional: true },
} as const satisfies Record<string, OutputProperty>

export const FOLDER_ITEMS_OUTPUT_PROPERTIES = {
  entries: {
    type: 'array',
    description: 'List of items in the folder',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Item type (file, folder, web_link)' },
        id: { type: 'string', description: 'Item ID' },
        name: { type: 'string', description: 'Item name' },
        size: { type: 'number', description: 'Item size in bytes', optional: true },
        createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
        modifiedAt: { type: 'string', description: 'Last modified timestamp', optional: true },
      },
    },
  },
  totalCount: { type: 'number', description: 'Total number of items in the folder' },
  offset: { type: 'number', description: 'Current pagination offset' },
  limit: { type: 'number', description: 'Current pagination limit' },
} as const satisfies Record<string, OutputProperty>

export const FOLDER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Folder ID' },
  name: { type: 'string', description: 'Folder name' },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  modifiedAt: { type: 'string', description: 'Last modified timestamp', optional: true },
  parentId: { type: 'string', description: 'Parent folder ID', optional: true },
  parentName: { type: 'string', description: 'Parent folder name', optional: true },
} as const satisfies Record<string, OutputProperty>

export const SEARCH_RESULT_OUTPUT_PROPERTIES = {
  results: {
    type: 'array',
    description: 'Search results',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Item type (file, folder, web_link)' },
        id: { type: 'string', description: 'Item ID' },
        name: { type: 'string', description: 'Item name' },
        size: { type: 'number', description: 'Item size in bytes', optional: true },
        createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
        modifiedAt: { type: 'string', description: 'Last modified timestamp', optional: true },
        parentId: { type: 'string', description: 'Parent folder ID', optional: true },
        parentName: { type: 'string', description: 'Parent folder name', optional: true },
      },
    },
  },
  totalCount: { type: 'number', description: 'Total number of matching results' },
} as const satisfies Record<string, OutputProperty>

export const UPLOAD_FILE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'File ID' },
  name: { type: 'string', description: 'File name' },
  size: { type: 'number', description: 'File size in bytes' },
  sha1: { type: 'string', description: 'SHA1 hash of file content', optional: true },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  modifiedAt: { type: 'string', description: 'Last modified timestamp', optional: true },
  parentId: { type: 'string', description: 'Parent folder ID', optional: true },
  parentName: { type: 'string', description: 'Parent folder name', optional: true },
} as const satisfies Record<string, OutputProperty>
