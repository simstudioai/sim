import type { SessionPrincipal } from '@sim/auth/principal'
import type { CredentialAccessResult } from '@/lib/auth/credential-access'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
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

/**
 * The service whose API a selector actually reaches.
 *
 * `serviceIds` names which *credentials* a selector accepts, which is not the
 * same question as which *resource* it reads. `google.drive` accepts a Drive,
 * Docs, Sheets or Forms connection because all four carry Drive scope, but it
 * only ever calls the Drive API. Judging the integration allowlist against the
 * accepted set let a group that permits `google_sheets_v2` and excludes
 * `google_drive` read Drive through it.
 *
 * Required whenever `serviceIds` names more than one service, and must be one
 * of them; `lib/selectors/manifest.test.ts` pins both. A single-service
 * declaration is its own resource and omits it.
 */
export type SelectorCredentialPolicy =
  | {
      kind: 'stored'
      field: 'oauthCredential'
      serviceIds: readonly string[]
      resourceServiceId?: string
    }
  | {
      kind: 'stored-or-fixed-token'
      field: 'oauthCredential'
      serviceIds: readonly string[]
      tokenPrefixes: readonly string[]
      resourceServiceId?: string
    }

export interface AuthorizedSelectorCredential {
  suppliedId: string
  organization?: { principal: SessionPrincipal; organizationId: string }
  access?: CredentialAccessResult
  fixedToken?: string
  /** Trusted provider id loaded during server-side credential binding. */
  providerId?: string
  /** Cancels only this selector's wait for shared credential resolution. */
  signal?: AbortSignal
}

export interface SelectorProtectedValues {
  add(value: string | null | undefined, kind?: SelectorProtectedValueKind): void
  contains(value: string): boolean
  containsExceptExact(value: string, allowedExactValue: string): boolean
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
  workspaceId?: string
  organizationId?: string
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
  /**
   * The block type(s) whose integration this selector's API belongs to, for a
   * selector the OAuth credential catalog cannot identify.
   *
   * The integration gate normally derives the block type from the credential
   * policy's service ids. Two shapes defeat that: a selector authenticated from
   * raw context fields rather than a stored connection (CloudWatch's AWS keys,
   * IMAP's host and password) declares no policy at all, and an API-key
   * integration (Snowflake, NetSuite, Harmonic) owns no OAuth catalog entry, so
   * its service id maps to nothing. Both still reach a third-party API with the
   * caller's credentials, so both must name their integration here. Internal
   * selectors — the ones reading only Sim's own workspace data — name none, and
   * that is what leaves them ungated.
   */
  integrationBlockTypes?: readonly string[]
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
  const overBudget = items.length > MAX_SELECTOR_OPTIONS
  const boundedItems = overBudget ? items.slice(0, MAX_SELECTOR_OPTIONS) : items
  const boundedDiagnostics = overBudget
    ? {
        ...diagnostics,
        truncated: {
          ...diagnostics?.truncated,
          reason: 'provider-cap' as const,
          limit: MAX_SELECTOR_OPTIONS,
        },
      }
    : diagnostics
  return {
    kind: 'list',
    items: boundedItems,
    ...(nextCursor ? { nextCursor } : {}),
    ...(boundedDiagnostics ? { diagnostics: boundedDiagnostics } : {}),
  }
}

export function detailSelectorResult(item: SafeSelectorOption | null): SelectorExecutionResult {
  return { kind: 'detail', item }
}

export function definePreparedSelectorAttachment<TPrepared>(input: {
  credential?: SelectorCredentialPolicy
  integrationBlockTypes?: readonly string[]
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
    ...(input.integrationBlockTypes ? { integrationBlockTypes: input.integrationBlockTypes } : {}),
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
