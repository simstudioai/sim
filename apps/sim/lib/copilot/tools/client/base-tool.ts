import type { LucideIcon } from 'lucide-react'

export enum ClientToolCallState {
  generating = 'generating',
  pending = 'pending',
  executing = 'executing',
  aborted = 'aborted',
  rejected = 'rejected',
  success = 'success',
  error = 'error',
  review = 'review',
  background = 'background',
}

export interface ClientToolDisplay {
  text: string
  icon: LucideIcon
}

export interface BaseClientToolMetadata {
  displayNames: Partial<Record<ClientToolCallState, ClientToolDisplay>>
  uiConfig?: Record<string, unknown>
  getDynamicText?: (params: Record<string, unknown>, state: ClientToolCallState) => string | undefined
}

export type DynamicTextFormatter = (
  params: Record<string, unknown>,
  state: ClientToolCallState
) => string | undefined

export const WORKFLOW_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000

/** Event detail for OAuth connect events dispatched by the copilot. */
export interface OAuthConnectEventDetail {
  providerName: string
  serviceId: string
  providerId: string
  requiredScopes: string[]
  newScopes?: string[]
}
