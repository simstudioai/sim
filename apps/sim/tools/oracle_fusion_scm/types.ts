import type { ToolResponse } from '@/tools/types'

export interface OracleFusionScmAuthParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}

export interface OracleFusionScmListParams extends OracleFusionScmAuthParams {
  q?: string
  finder?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionScmFinderListParams extends OracleFusionScmListParams {
  finder?: string
}

export interface OracleFusionScmSupplyOrderLineListParams extends OracleFusionScmListParams {
  supplyRequestKey: string
}

export type OracleFusionScmDetailParams<Key extends string> = OracleFusionScmAuthParams &
  Record<Key, string>

export interface OracleFusionScmSupplyOrderLineDetailParams extends OracleFusionScmAuthParams {
  supplyRequestKey: string
  supplyOrderLineKey: string
}

export interface OracleFusionScmListResponse extends ToolResponse {
  output: {
    items: Array<Record<string, unknown>>
    count: number
    hasMore: boolean
    limit: number
    offset: number
    totalResults?: number
    nextOffset?: number
  }
}

export type OracleFusionScmDetailResponse<Wrapper extends string> = ToolResponse & {
  output: Record<Wrapper, Record<string, unknown>>
}

export type OracleFusionScmParentListParams<Key extends string> = OracleFusionScmListParams &
  Record<Key, string>

export type OracleFusionScmMutationParams<Key extends string = never> = OracleFusionScmAuthParams &
  Record<Key, string> & {
    body: Record<string, unknown> | string
  }
