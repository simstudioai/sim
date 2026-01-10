import type { ToolResponse } from '@/tools/types'

export interface GoogleVaultCommonParams {
  accessToken: string
  matterId: string
}

export interface GoogleVaultCreateMattersParams {
  accessToken: string
  name: string
  description?: string
}

export interface GoogleVaultListMattersParams {
  accessToken: string
  pageSize?: number
  pageToken?: string
  matterId?: string
}

export interface GoogleVaultDownloadExportFileParams {
  accessToken: string
  matterId: string
  bucketName: string
  objectName: string
  fileName?: string
}

export interface GoogleVaultCreateMattersExportParams extends GoogleVaultCommonParams {
  exportName: string
  corpus: GoogleVaultCorpus
  accountEmails?: string
  orgUnitId?: string
  terms?: string
  startTime?: string
  endTime?: string
  includeSharedDrives?: boolean
}

export interface GoogleVaultListMattersExportParams extends GoogleVaultCommonParams {
  pageSize?: number
  pageToken?: string
  exportId?: string
}

export interface GoogleVaultListMattersExportResponse extends ToolResponse {
  output: any
}

export type GoogleVaultHoldView = 'BASIC_HOLD' | 'FULL_HOLD'

export type GoogleVaultCorpus = 'MAIL' | 'DRIVE' | 'GROUPS' | 'HANGOUTS_CHAT' | 'VOICE'

export interface GoogleVaultCreateMattersHoldsParams extends GoogleVaultCommonParams {
  holdName: string
  corpus: GoogleVaultCorpus
  accountEmails?: string
  orgUnitId?: string
  terms?: string
  startTime?: string
  endTime?: string
  includeSharedDrives?: boolean
}

export interface GoogleVaultListMattersHoldsParams extends GoogleVaultCommonParams {
  pageSize?: number
  pageToken?: string
  holdId?: string
}

export interface GoogleVaultListMattersHoldsResponse extends ToolResponse {
  output: any
}
