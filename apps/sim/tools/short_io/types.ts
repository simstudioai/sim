export interface ShortIoCreateLinkParams {
  apiKey: string
  domain: string
  originalURL: string
  path?: string
}

export interface ShortIoListDomainsParams {
  apiKey: string
}

export interface ShortIoListLinksParams {
  apiKey: string
  domainId: number
  limit?: number
  pageToken?: string
  dateSortOrder?: 'asc' | 'desc'
}

export interface ShortIoDeleteLinkParams {
  apiKey: string
  linkId: string
}

export interface ShortIoGetQrParams {
  apiKey: string
  linkId: string
  color?: string
  backgroundColor?: string
  size?: number
  type?: 'png' | 'svg'
  useDomainSettings?: boolean
}

export interface ShortIoGetAnalyticsParams {
  apiKey: string
  linkId: string
  period: string
  tz?: string
}
