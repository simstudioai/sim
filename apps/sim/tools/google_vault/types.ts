import type { ToolResponse } from '@/tools/types'

export interface GoogleVaultCommonParams {
  accessToken: string
  matterId: string
}

// Exports
export interface GoogleVaultCreateMattersExportParams extends GoogleVaultCommonParams {
  exportName: string
  corpus: GoogleVaultCorpus
  accountEmails?: string // Comma-separated list or array handled in the tool
  orgUnitId?: string
  terms?: string
  startTime?: string
  endTime?: string
  timeZone?: string
  includeSharedDrives?: boolean
}

export interface GoogleVaultListMattersExportParams extends GoogleVaultCommonParams {
  pageSize?: number
  pageToken?: string
  exportId?: string // Short input to fetch a specific export
}

export interface GoogleVaultListMattersExportResponse extends ToolResponse {
  output: any
}

// Holds
// Simplified: default to BASIC_HOLD by omission in requests
export type GoogleVaultHoldView = 'BASIC_HOLD' | 'FULL_HOLD'

export type GoogleVaultCorpus = 'MAIL' | 'DRIVE' | 'GROUPS' | 'HANGOUTS_CHAT' | 'VOICE'

export interface GoogleVaultCreateMattersHoldsParams extends GoogleVaultCommonParams {
  holdName: string
  corpus: GoogleVaultCorpus
  accountEmails?: string // Comma-separated list or array handled in the tool
  orgUnitId?: string
}

export interface GoogleVaultListMattersHoldsParams extends GoogleVaultCommonParams {
  pageSize?: number
  pageToken?: string
  holdId?: string // Short input to fetch a specific hold
}

export interface GoogleVaultListMattersHoldsResponse extends ToolResponse {
  output: any
}
