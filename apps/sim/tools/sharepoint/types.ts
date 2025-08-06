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
  '@odata.type'?: string
  id?: string
  name: string
  title: string
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
  }
}

export interface SharepointReadSiteResponse extends ToolResponse {
  output: {
    site?: {
      id: string
      name: string
      displayName: string
      webUrl: string
      description?: string
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
      description?: string
      createdDateTime?: string
      lastModifiedDateTime?: string
    }>
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
  maxPages?: number
}

export interface GraphApiResponse {
  id?: string
  name?: string
  title?: string
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

export interface SharepointReadSiteResponse extends ToolResponse {
  output: {
    site?: {
      id: string
      name: string
      displayName: string
      webUrl: string
      description?: string
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
      description?: string
      createdDateTime?: string
      lastModifiedDateTime?: string
    }>
  }
}

export type SharepointResponse =
  | SharepointListSitesResponse
  | SharepointCreatePageResponse
  | SharepointReadPageResponse
  | SharepointReadSiteResponse
