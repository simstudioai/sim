import type { SessionPrincipal } from '@sim/auth/principal'
import type { CredentialAccessResult } from '@/lib/auth/credential-access'
import type { SelectorKey, ServerSelectorKey } from '@/lib/selectors/manifest'
import type {
  SafeSelectorOption,
  SelectorContext,
  SelectorExecutionResult,
  SelectorRequest,
  SelectorScope,
} from '@/lib/selectors/types'

export type SelectorDestinationPolicy = 'fixed' | 'credential-bound' | 'user-controlled'

export type SelectorCredentialPolicy =
  | {
      kind: 'stored'
      field: 'oauthCredential'
      serviceIds: readonly string[]
    }
  | {
      kind: 'stored-or-fixed-token'
      field: 'oauthCredential'
      serviceIds: readonly string[]
      tokenPrefixes: readonly string[]
    }

export interface AuthorizedSelectorCredential {
  suppliedId: string
  access?: CredentialAccessResult
  fixedToken?: string
}

export interface SelectorProtectedValues {
  add(value: string | null | undefined): void
  contains(value: string): boolean
}

export interface ResolvedSelectorReference {
  field: string
  name: string
  scope: 'personal' | 'workspace'
  visible: boolean
}

export interface ExecuteServerSelectorArgs {
  selectorKey: ServerSelectorKey
  context: SelectorContext
  request: SelectorRequest
  scope: SelectorScope
  workspaceId: string
  principal: SessionPrincipal
  requesterUserId: string
  credential?: AuthorizedSelectorCredential
  references: ReadonlyMap<string, ResolvedSelectorReference>
  signal?: AbortSignal
  protectedValues: SelectorProtectedValues
}

export interface ServerSelectorAttachment {
  credential?: SelectorCredentialPolicy
  destination: SelectorDestinationPolicy
  execute(args: ExecuteServerSelectorArgs): Promise<SelectorExecutionResult>
}

export type ServerSelectorAttachmentMap<K extends ServerSelectorKey = ServerSelectorKey> = {
  [P in K]: ServerSelectorAttachment
}

export function listSelectorResult(
  items: SafeSelectorOption[],
  nextCursor?: string
): SelectorExecutionResult {
  return { kind: 'list', items, ...(nextCursor ? { nextCursor } : {}) }
}

export function detailSelectorResult(item: SafeSelectorOption | null): SelectorExecutionResult {
  return { kind: 'detail', item }
}

export function requireListRequest(
  selectorKey: SelectorKey,
  request: SelectorRequest
): Extract<SelectorRequest, { kind: 'list' }> {
  if (request.kind !== 'list') {
    throw new Error(`Selector ${selectorKey} received an unsupported detail request`)
  }
  return request
}

export function requireDetailRequest(
  selectorKey: SelectorKey,
  request: SelectorRequest
): Extract<SelectorRequest, { kind: 'detail' }> {
  if (request.kind !== 'detail') {
    throw new Error(`Selector ${selectorKey} received an unsupported list request`)
  }
  return request
}
