import type { ToolResponse } from '@/tools/types'

interface DubBaseParams {
  apiKey: string
}

export interface DubCreateLinkParams extends DubBaseParams {
  url: string
  domain?: string
  key?: string
  externalId?: string
  tenantId?: string
  folderId?: string
  trackConversion?: boolean
  tagIds?: string
  comments?: string
  expiresAt?: string
  password?: string
  rewrite?: boolean
  archived?: boolean
  title?: string
  description?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}

export interface DubGetLinkParams extends DubBaseParams {
  linkId?: string
  externalId?: string
  domain?: string
  key?: string
}

export interface DubUpdateLinkParams extends DubBaseParams {
  linkId: string
  url?: string
  domain?: string
  key?: string
  title?: string
  description?: string
  externalId?: string
  tenantId?: string
  folderId?: string
  trackConversion?: boolean
  tagIds?: string
  comments?: string
  expiresAt?: string
  password?: string
  rewrite?: boolean
  archived?: boolean
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}

export interface DubUpsertLinkParams extends DubBaseParams {
  url: string
  domain?: string
  key?: string
  externalId?: string
  tenantId?: string
  folderId?: string
  trackConversion?: boolean
  tagIds?: string
  comments?: string
  expiresAt?: string
  password?: string
  rewrite?: boolean
  archived?: boolean
  title?: string
  description?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}

export interface DubDeleteLinkParams extends DubBaseParams {
  linkId: string
}

export interface DubListLinksParams extends DubBaseParams {
  domain?: string
  search?: string
  tagIds?: string
  tenantId?: string
  folderId?: string
  showArchived?: boolean
  page?: number
  pageSize?: number
  startingAfter?: string
  endingBefore?: string
}

export interface DubGetAnalyticsParams extends DubBaseParams {
  event?: string
  groupBy?: string
  linkId?: string
  externalId?: string
  domain?: string
  interval?: string
  start?: string
  end?: string
  country?: string
  timezone?: string
}

export interface DubGetLinksCountParams extends DubBaseParams {
  domain?: string
  search?: string
  tagIds?: string
  tagNames?: string
  folderId?: string
  showArchived?: boolean
  groupBy?: string
}

export interface DubGetEventsParams extends DubBaseParams {
  event?: string
  linkId?: string
  externalId?: string
  domain?: string
  interval?: string
  start?: string
  end?: string
  country?: string
  timezone?: string
  page?: number
  limit?: number
  sortOrder?: string
}

export interface DubBulkCreateLinksParams extends DubBaseParams {
  links: unknown
}

export interface DubBulkUpdateLinksParams extends DubBaseParams {
  linkIds?: string
  externalIds?: string
  data: unknown
}

export interface DubBulkDeleteLinksParams extends DubBaseParams {
  linkIds: string
}

export interface DubGetQrCodeParams extends DubBaseParams {
  url: string
  logo?: string
  size?: number
  level?: string
  fgColor?: string
  bgColor?: string
  hideLogo?: boolean
  margin?: number
}

export interface DubListDomainsParams extends DubBaseParams {
  archived?: boolean
  search?: string
  page?: number
  pageSize?: number
}

export interface DubListTagsParams extends DubBaseParams {
  search?: string
  sortBy?: string
  sortOrder?: string
  page?: number
  pageSize?: number
}

export interface DubCreateTagParams extends DubBaseParams {
  name: string
  color?: string
}

export interface DubListFoldersParams extends DubBaseParams {
  search?: string
  page?: number
  pageSize?: number
}

interface DubLink {
  id: string
  domain: string
  key: string
  url: string
  shortLink: string
  qrCode: string
  archived: boolean
  externalId: string | null
  title: string | null
  description: string | null
  tags: Array<{ id: string; name: string; color: string }>
  folderId: string | null
  tenantId: string | null
  trackConversion: boolean
  clicks: number
  leads: number
  conversions: number
  sales: number
  saleAmount: number
  lastClicked: string | null
  createdAt: string
  updatedAt: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
}

export interface DubCreateLinkResponse extends ToolResponse {
  output: DubLink
}

export interface DubGetLinkResponse extends ToolResponse {
  output: DubLink
}

export interface DubUpdateLinkResponse extends ToolResponse {
  output: DubLink
}

export interface DubUpsertLinkResponse extends ToolResponse {
  output: DubLink
}

export interface DubDeleteLinkResponse extends ToolResponse {
  output: {
    id: string
  }
}

export interface DubListLinksResponse extends ToolResponse {
  output: {
    links: DubLink[]
    count: number
  }
}

export interface DubGetAnalyticsResponse extends ToolResponse {
  output: {
    clicks: number
    leads: number
    sales: number
    saleAmount: number
    data: Record<string, unknown>[] | null
  }
}

export interface DubGetLinksCountResponse extends ToolResponse {
  output: {
    count: number
    groups: Record<string, unknown>[] | null
  }
}

export interface DubGetEventsResponse extends ToolResponse {
  output: {
    events: Record<string, unknown>[]
    count: number
  }
}

export interface DubBulkCreateLinksResponse extends ToolResponse {
  output: {
    created: Record<string, unknown>[]
    errors: Record<string, unknown>[]
    count: number
  }
}

export interface DubBulkUpdateLinksResponse extends ToolResponse {
  output: {
    updated: Record<string, unknown>[]
    count: number
  }
}

export interface DubBulkDeleteLinksResponse extends ToolResponse {
  output: {
    deletedCount: number
  }
}

export interface DubGetQrCodeResponse extends ToolResponse {
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

export interface DubListDomainsResponse extends ToolResponse {
  output: {
    domains: Record<string, unknown>[]
    count: number
  }
}

export interface DubListTagsResponse extends ToolResponse {
  output: {
    tags: Record<string, unknown>[]
    count: number
  }
}

export interface DubCreateTagResponse extends ToolResponse {
  output: {
    id: string
    name: string
    color: string
  }
}

export interface DubListFoldersResponse extends ToolResponse {
  output: {
    folders: Record<string, unknown>[]
    count: number
  }
}

export type DubResponse =
  | DubCreateLinkResponse
  | DubGetLinkResponse
  | DubUpdateLinkResponse
  | DubUpsertLinkResponse
  | DubDeleteLinkResponse
  | DubListLinksResponse
  | DubGetAnalyticsResponse
  | DubGetLinksCountResponse
  | DubGetEventsResponse
  | DubBulkCreateLinksResponse
  | DubBulkUpdateLinksResponse
  | DubBulkDeleteLinksResponse
  | DubGetQrCodeResponse
  | DubListDomainsResponse
  | DubListTagsResponse
  | DubCreateTagResponse
  | DubListFoldersResponse
