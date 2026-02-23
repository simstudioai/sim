'use client'

export const PENDING_OAUTH_CREDENTIAL_DRAFT_KEY = 'sim.pending-oauth-credential-draft'
export const PENDING_CREDENTIAL_CREATE_REQUEST_KEY = 'sim.pending-credential-create-request'
export const PENDING_CREDENTIAL_CREATE_REQUEST_EVENT = 'sim:pending-credential-create-request'

export interface PendingOAuthCredentialDraft {
  workspaceId: string
  providerId: string
  displayName: string
  existingCredentialIds: string[]
  existingAccountIds: string[]
  requestedAt: number
}

interface PendingOAuthCredentialCreateRequest {
  workspaceId: string
  type: 'oauth'
  providerId: string
  displayName: string
  serviceId: string
  requiredScopes: string[]
  requestedAt: number
}

interface PendingSecretCredentialCreateRequest {
  workspaceId: string
  type: 'env_personal' | 'env_workspace'
  envKey?: string
  requestedAt: number
}

export type PendingCredentialCreateRequest =
  | PendingOAuthCredentialCreateRequest
  | PendingSecretCredentialCreateRequest

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function readPendingOAuthCredentialDraft(): PendingOAuthCredentialDraft | null {
  if (typeof window === 'undefined') return null
  return parseJson<PendingOAuthCredentialDraft>(
    window.sessionStorage.getItem(PENDING_OAUTH_CREDENTIAL_DRAFT_KEY)
  )
}

export function writePendingOAuthCredentialDraft(payload: PendingOAuthCredentialDraft) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(PENDING_OAUTH_CREDENTIAL_DRAFT_KEY, JSON.stringify(payload))
}

export function clearPendingOAuthCredentialDraft() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(PENDING_OAUTH_CREDENTIAL_DRAFT_KEY)
}

export function readPendingCredentialCreateRequest(): PendingCredentialCreateRequest | null {
  if (typeof window === 'undefined') return null
  return parseJson<PendingCredentialCreateRequest>(
    window.sessionStorage.getItem(PENDING_CREDENTIAL_CREATE_REQUEST_KEY)
  )
}

export function writePendingCredentialCreateRequest(payload: PendingCredentialCreateRequest) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(PENDING_CREDENTIAL_CREATE_REQUEST_KEY, JSON.stringify(payload))
  window.dispatchEvent(
    new CustomEvent<PendingCredentialCreateRequest>(PENDING_CREDENTIAL_CREATE_REQUEST_EVENT, {
      detail: payload,
    })
  )
}

export function clearPendingCredentialCreateRequest() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(PENDING_CREDENTIAL_CREATE_REQUEST_KEY)
}
