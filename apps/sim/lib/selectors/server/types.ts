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

export type SelectorProtectedValueKind = 'secret' | 'reference'

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
  /** Trusted provider id loaded during server-side credential binding. */
  providerId?: string
}

export interface SelectorProtectedValues {
  add(value: string | null | undefined, kind?: SelectorProtectedValueKind): void
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
  recordCredentialUse?: (providerId: string) => void
}

export interface SelectorServerDiagnostics {
  truncated?: {
    reason: 'provider-cap'
    limit?: number
    pages?: number
  }
}

export type ServerSelectorExecutionResult = SelectorExecutionResult & {
  diagnostics?: SelectorServerDiagnostics
}

export interface PreparedSelectorDestination {
  kind: Exclude<SelectorDestinationPolicy, 'fixed'>
  prepare(args: ExecuteServerSelectorArgs): Promise<unknown>
}

export interface ServerSelectorAttachment {
  credential?: SelectorCredentialPolicy
  destination: 'fixed' | PreparedSelectorDestination
  auditCredentialUse?: boolean
  execute(
    args: ExecuteServerSelectorArgs,
    preparedDestination?: unknown
  ): Promise<ServerSelectorExecutionResult>
}

export type ServerSelectorAttachmentMap<K extends ServerSelectorKey = ServerSelectorKey> = {
  [P in K]: ServerSelectorAttachment
}

export function listSelectorResult(
  items: SafeSelectorOption[],
  nextCursor?: string,
  diagnostics?: SelectorServerDiagnostics
): ServerSelectorExecutionResult {
  return {
    kind: 'list',
    items,
    ...(nextCursor ? { nextCursor } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  }
}

export function detailSelectorResult(item: SafeSelectorOption | null): SelectorExecutionResult {
  return { kind: 'detail', item }
}

export function definePreparedSelectorAttachment<TPrepared>(input: {
  credential?: SelectorCredentialPolicy
  destination: {
    kind: Exclude<SelectorDestinationPolicy, 'fixed'>
    prepare(args: ExecuteServerSelectorArgs): Promise<TPrepared>
  }
  auditCredentialUse?: boolean
  execute(
    args: ExecuteServerSelectorArgs,
    preparedDestination: TPrepared
  ): Promise<ServerSelectorExecutionResult>
}): ServerSelectorAttachment {
  return {
    ...(input.credential ? { credential: input.credential } : {}),
    destination: {
      kind: input.destination.kind,
      prepare: input.destination.prepare,
    },
    ...(input.auditCredentialUse ? { auditCredentialUse: true } : {}),
    execute: async (args, preparedDestination) =>
      input.execute(
        args,
        preparedDestination === undefined
          ? await input.destination.prepare(args)
          : (preparedDestination as TPrepared)
      ),
  }
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
