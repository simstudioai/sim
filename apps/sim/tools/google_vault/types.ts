import type { ToolResponse } from '@/tools/types'

interface GoogleVaultCommonParams {
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

interface GoogleVaultListMattersExportResponse extends ToolResponse {
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

export interface GoogleVaultUpdateMatterParams {
  accessToken: string
  matterId: string
  name: string
  description?: string
}

export interface GoogleVaultMatterActionParams {
  accessToken: string
  matterId: string
}

export interface GoogleVaultAddMatterPermissionsParams {
  accessToken: string
  matterId: string
  accountId: string
  role: 'COLLABORATOR' | 'OWNER'
  sendEmails?: boolean
  ccMe?: boolean
}

export interface GoogleVaultRemoveMatterPermissionsParams {
  accessToken: string
  matterId: string
  accountId: string
}

export interface GoogleVaultDeleteMattersExportParams {
  accessToken: string
  matterId: string
  exportId: string
}

export interface GoogleVaultUpdateMattersHoldsParams extends GoogleVaultCommonParams {
  holdId: string
  holdName: string
  corpus: GoogleVaultCorpus
  accountEmails?: string
  orgUnitId?: string
  terms?: string
  startTime?: string
  endTime?: string
  includeSharedDrives?: boolean
}

export interface GoogleVaultDeleteMattersHoldsParams extends GoogleVaultCommonParams {
  holdId: string
}

export interface GoogleVaultAddHeldAccountsParams extends GoogleVaultCommonParams {
  holdId: string
  accountEmails: string
}

export interface GoogleVaultRemoveHeldAccountsParams extends GoogleVaultCommonParams {
  holdId: string
  accountIds: string
}

export interface GoogleVaultCreateSavedQueryParams extends GoogleVaultCommonParams {
  displayName: string
  corpus: GoogleVaultCorpus
  accountEmails?: string
  orgUnitId?: string
  terms?: string
  startTime?: string
  endTime?: string
}

export interface GoogleVaultListSavedQueriesParams extends GoogleVaultCommonParams {
  pageSize?: number
  pageToken?: string
  savedQueryId?: string
}

export interface GoogleVaultDeleteSavedQueryParams extends GoogleVaultCommonParams {
  savedQueryId: string
}

interface GoogleVaultListMattersHoldsResponse extends ToolResponse {
  output: any
}
