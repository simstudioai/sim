import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface SharepointSite {
  id: string
  name: string
  displayName: string
  webUrl: string
  description?: string | null
  createdDateTime?: string
  lastModifiedDateTime?: string
}

export interface SharepointPage {
  '@odata.type'?: string
  id?: string
  name: string
  title: string
  description?: string | null
  webUrl?: string
  pageLayout?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  publishingState?: {
    level: string
  }
  canvasLayout?: {
    horizontalSections: Array<{
      layout: string
      id: string
      emphasis: string
      columns?: Array<{
        id: string
        width: number
        webparts: Array<{
          id: string
          innerHtml: string
        }>
      }>
      webparts?: Array<{
        id: string
        innerHtml: string
      }>
    }>
  }
}

export interface SharepointPageContent {
  content: string
  canvasLayout?: {
    horizontalSections: Array<{
      layout: string
      id: string
      emphasis: string
      webparts: Array<{
        id: string
        innerHtml: string
      }>
    }>
  } | null
}

export interface SharepointColumn {
  id?: string
  name?: string
  displayName?: string
  description?: string
  indexed?: boolean
  enforcedUniqueValues?: boolean
  hidden?: boolean
  readOnly?: boolean
  required?: boolean
  columnGroup?: string
  [key: string]: unknown
}

export interface SharepointListItem {
  id: string
  fields?: Record<string, unknown>
}

export interface SharepointList {
  id: string
  displayName?: string
  name?: string
  webUrl?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  list?: {
    template?: string
  }
  columns?: SharepointColumn[]
  items?: SharepointListItem[]
}

export interface SharepointListSitesResponse extends ToolResponse {
  output: {
    sites: SharepointSite[]
    nextPageUrl?: string
  }
}

export interface SharepointCreatePageResponse extends ToolResponse {
  output: {
    page: SharepointPage
  }
}

export interface SharepointPageWithContent {
  page: SharepointPage
  content: SharepointPageContent
}

export interface SharepointReadPageResponse extends ToolResponse {
  output: {
    page?: SharepointPage
    pages?: SharepointPageWithContent[]
    content?: SharepointPageContent
    totalPages?: number
    nextPageUrl?: string
  }
}

export interface SharepointReadSiteResponse extends ToolResponse {
  output: {
    site?: {
      id: string
      name: string
      displayName: string
      webUrl: string
      description?: string | null
      createdDateTime?: string
      lastModifiedDateTime?: string
      isPersonalSite?: boolean
      root?: {
        serverRelativeUrl: string
      }
      siteCollection?: {
        hostname: string
      }
    }
    sites?: Array<{
      id: string
      name: string
      displayName: string
      webUrl: string
      description?: string | null
      createdDateTime?: string
      lastModifiedDateTime?: string
    }>
    nextPageUrl?: string
  }
}

export interface SharepointToolParams {
  accessToken: string
  siteId?: string
  siteSelector?: string
  pageId?: string
  pageName?: string
  pageContent?: string | unknown[] | { columns?: unknown[] }
  pageTitle?: string
  publishingState?: string
  query?: string
  pageSize?: number
  nextPageUrl?: string
  hostname?: string
  serverRelativePath?: string
  groupId?: string
  maxPages?: number
  // Lists
  listId?: string
  listTitle?: string
  includeColumns?: boolean
  includeItems?: boolean
  // Create List
  listDisplayName?: string
  listDescription?: string
  listTemplate?: string
  // Update List Item
  itemId?: string
  listItemFields?: Record<string, unknown>
  // Upload File
  driveId?: string
  folderPath?: string
  fileName?: string
  files?: UserFile[]
}

export interface GraphApiResponse {
  id?: string
  name?: string
  title?: string
  description?: string | null
  webUrl?: string
  pageLayout?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  canvasLayout?: CanvasLayout
  value?: GraphApiPageItem[]
  error?: {
    message: string
  }
}

export interface GraphApiPageItem {
  id: string
  name: string
  title?: string
  description?: string | null
  webUrl?: string
  pageLayout?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
}

export interface CanvasLayout {
  horizontalSections?: Array<{
    layout?: string
    id?: string
    emphasis?: string
    columns?: Array<{
      webparts?: Array<{
        id?: string
        innerHtml?: string
      }>
    }>
    webparts?: Array<{
      id?: string
      innerHtml?: string
    }>
  }>
}

export type SharepointResponse =
  | SharepointListSitesResponse
  | SharepointCreatePageResponse
  | SharepointReadPageResponse
  | SharepointReadSiteResponse
  | SharepointGetListResponse
  | SharepointCreateListResponse
  | SharepointUpdateListItemResponse
  | SharepointAddListItemResponse
  | SharepointUploadFileResponse

export interface SharepointGetListResponse extends ToolResponse {
  output: {
    list?: SharepointList
    lists?: SharepointList[]
    items?: SharepointListItem[]
    nextPageUrl?: string
  }
}

export interface SharepointCreateListResponse extends ToolResponse {
  output: {
    list: SharepointList
  }
}

export interface SharepointUpdateListItemResponse extends ToolResponse {
  output: {
    item: {
      id: string
      fields?: Record<string, unknown>
    }
  }
}

export interface SharepointAddListItemResponse extends ToolResponse {
  output: {
    item: {
      id: string
      fields?: Record<string, unknown>
    }
  }
}

export interface SharepointUploadedFile {
  id: string
  name: string
  webUrl: string
  size: number
  createdDateTime?: string
  lastModifiedDateTime?: string
}

export interface SharepointSkippedFile {
  name: string
  size: number
  limit: number
  reason: string
}

export interface SharepointUploadError {
  name: string
  error: string
  status?: number
}

export interface SharepointUploadFileResponse extends ToolResponse {
  output: {
    uploadedFiles: SharepointUploadedFile[]
    fileCount: number
    skippedFiles?: SharepointSkippedFile[]
    skippedCount?: number
    errors?: SharepointUploadError[]
  }
}
