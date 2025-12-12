import type { ToolResponse } from '@/tools/types'

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
  | ConfluenceLabelResponse
  | ConfluenceSpaceResponse
