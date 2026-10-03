'use client'

export const PENDING_OAUTH_CREDENTIAL_DRAFT_KEY = 'sim.pending-oauth-credential-draft'
export const PENDING_CREDENTIAL_CREATE_REQUEST_KEY = 'sim.pending-credential-create-request'
export const PENDING_CREDENTIAL_CREATE_REQUEST_EVENT = 'sim:pending-credential-create-request'

export interface PendingCredentialCreateRequest {
  workspaceId: string
  type: 'env_personal' | 'env_workspace'
  envKey?: string
  requestedAt: number
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
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

export const ADD_CONNECTOR_SEARCH_PARAM = 'addConnector' as const

const OAUTH_RETURN_CONTEXT_KEY = 'sim.oauth-return-context'

export type OAuthReturnOrigin = 'workflow' | 'integrations' | 'kb-connectors'

interface OAuthReturnBase {
  displayName: string
  providerId: string
  preCount: number
  baselineCredentials?: Array<{
    id: string
    accountId: string | null
    updatedAt?: string
  }>
  workspaceId?: string
  organizationId?: string
  reconnect?: boolean
  requestedAt: number
}

interface OAuthReturnWorkflow extends OAuthReturnBase {
  workspaceId: string
  organizationId?: never
  origin: 'workflow'
  workflowId: string
}

interface OAuthReturnIntegrations extends OAuthReturnBase {
  origin: 'integrations'
}

interface OAuthReturnKBConnectors extends OAuthReturnBase {
  origin: 'kb-connectors'
  knowledgeBaseId: string
  connectorType?: string
  connectorId?: string
  sourceAccess?: 'members'
}

export type OAuthReturnContext =
  | OAuthReturnWorkflow
  | OAuthReturnIntegrations
  | OAuthReturnKBConnectors

export function writeOAuthReturnContext(ctx: OAuthReturnContext) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(OAUTH_RETURN_CONTEXT_KEY, JSON.stringify(ctx))
}

export function readOAuthReturnContext(): OAuthReturnContext | null {
  if (typeof window === 'undefined') return null
  return parseJson<OAuthReturnContext>(window.sessionStorage.getItem(OAUTH_RETURN_CONTEXT_KEY))
}

export function clearOAuthReturnContext(): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(OAUTH_RETURN_CONTEXT_KEY)
}

export function consumeOAuthReturnContext(): OAuthReturnContext | null {
  const ctx = readOAuthReturnContext()
  if (ctx) clearOAuthReturnContext()
  return ctx
}
