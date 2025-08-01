import type { ToolResponse } from '@/tools/types'

export interface SharepointSite {
  id: string
  name: string
  displayName: string
  webUrl: string
  description?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
}

export interface SharepointPage {
  id: string
  name: string
  title: string
  webUrl: string
  pageLayout?: string
  promotionKind?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  contentType?: {
    id: string
    name: string
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
  }
}

export interface SharepointListSitesResponse extends ToolResponse {
  output: {
    sites: SharepointSite[]
    nextPageToken?: string
  }
}

export interface SharepointCreatePageResponse extends ToolResponse {
  output: {
    page: SharepointPage
  }
}

export interface SharepointReadPageResponse extends ToolResponse {
  output: {
    page: SharepointPage
    content: SharepointPageContent
  }
}

export interface SharepointToolParams {
  accessToken: string
  siteId?: string
  siteSelector?: string
  pageId?: string
  pageName?: string
  pageContent?: string
  pageTitle?: string
  publishingState?: string
  query?: string
  pageSize?: number
  pageToken?: string
  hostname?: string
  serverRelativePath?: string
  groupId?: string
}

export type SharepointResponse =
  | SharepointListSitesResponse
  | SharepointCreatePageResponse
  | SharepointReadPageResponse
