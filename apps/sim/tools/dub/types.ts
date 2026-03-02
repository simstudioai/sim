import type { ToolResponse } from '@/tools/types'

export interface DubBaseParams {
  apiKey: string
}

export interface DubCreateLinkParams extends DubBaseParams {
  url: string
  domain?: string
  key?: string
  externalId?: string
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
  showArchived?: boolean
  sortBy?: string
  sortOrder?: string
  page?: number
  pageSize?: number
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

export interface DubLink {
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
  clicks: number
  leads: number
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

export type DubResponse =
  | DubCreateLinkResponse
  | DubGetLinkResponse
  | DubUpdateLinkResponse
  | DubUpsertLinkResponse
  | DubDeleteLinkResponse
  | DubListLinksResponse
  | DubGetAnalyticsResponse
