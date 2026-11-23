/**
 * Credentials as workspace source: `credentials.ts` binds each key a workflow names
 * (`credential('slack')`) to one of this workspace's saved credentials, by provider, never by
 * token. A reference kind: an apply never creates, changes or deletes a credential; it only binds
 * and unbinds keys, through `bindCredentialKey` and `releaseCredentialKey` (write, audited), and
 * lists credentials through `listWorkspaceCredentials`, so the caller binds only what their
 * credential listing shows (a workspace API key, the shared ones), which each bind re-checks.
 *
 * For each declared key, in key order:
 * - bound to a credential that fits (the declared provider, and `name` when declared): a no-op;
 * - else the one credential that fits and no other declared key holds is bound to it: adopted, or
 *   for a key bound to a credential that no longer fits, rebound (`update`);
 * - else none fits (`W_CREDENTIAL_MISSING`) or several do (`W_CREDENTIAL_AMBIGUOUS`), and every
 *   change the apply writes that uses the key is held back with the error twin of that finding.
 *   The key stands in under a placeholder id, so a workflow using it still dry-runs.
 *
 * A key bound to a credential the caller cannot see is missing for them: binding over it would
 * take another user's credential away from the workflows that use it. A credential bound to a key
 * neither declared nor recorded in the base (bound outside source) is not a candidate either:
 * binding it would silently unbind that key from the workflows that use it.
 *
 * A key the base records that the directory no longer declares is unbound only with
 * `--allow-delete`; one no base records is left bound, with no finding. Binding a credential to a
 * new key moves it off the key it held (a renamed key). Applying the directory to another
 * workspace binds every key to that workspace's own credentials.
 */
import { compareStrings } from '@sim/utils/string'
import { KIND_DIRS, resourceAddress } from '@sim/workspace-code'
import {
  type CredentialDecl,
  type CredentialsDecl,
  credentialCodec,
  credentialFingerprint,
} from '@sim/workspace-code/kinds/credentials'
import { fileKindGroupKey } from '@sim/workspace-code/kinds/entries'
import type { CursorKey } from '@/lib/api/list-query'
import {
  bindCredentialKey,
  releaseCredentialKey,
} from '@/lib/credentials/application/credential-keys'
import { listWorkspaceCredentials } from '@/lib/credentials/application/list-workspace-credentials'
import { kindFinding, reboundFinding, where } from '@/lib/workspace-source/application/findings'
import { bindStored, listUpTo, pendingOf } from '@/lib/workspace-source/application/keys'
import type {
  KindAdapter,
  PlanContext,
  PlannedChange,
  StoredResource,
  StoredSet,
} from '@/lib/workspace-source/application/types'
import { resolveIds } from '@/lib/workspaces/resource-keys'

/** A stored credential as source sees it: the provider it is for, never a token. */
interface StoredCredential {
  provider: string
}

/** What a binding carries out: the declared entry, and the credential the key moves off. */
export interface CredentialPlan {
  entry?: CredentialDecl
  boundTo?: string
}

type CredentialChange = PlannedChange<'credential'>
type Credential = StoredResource<StoredCredential>

/** Credentials per page while listing a workspace's credentials. */
const LIST_PAGE = 200

/** Credentials a finding names before it only counts the rest. */
const NAMED_CREDENTIALS = 10

/** Whether `credential` is one `entry` may bind to. */
function fits(credential: Credential, entry: CredentialDecl): boolean {
  return (
    credential.state.provider === entry.provider &&
    (entry.name === undefined || credential.name === entry.name)
  )
}

/** The declaration a get prints for a stored credential: its provider alone. */
function declOf(credential: Credential): CredentialDecl {
  return { provider: credential.state.provider }
}

function connectHint(entry: CredentialDecl): string {
  return `Connect one with \`sim credentials connect ${entry.provider} --name "<display name>"\` (or in the workspace's integrations), then apply again.`
}

function namedList(credentials: readonly Credential[]): string {
  const named = credentials.slice(0, NAMED_CREDENTIALS).map((credential) => `"${credential.name}"`)
  const more = credentials.length - named.length
  return `${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
}

/**
 * Marks `change` unbindable: a warning on `credentials.ts`, the error every change using the key
 * is held back with, and a placeholder that lets a workflow using it dry-run.
 */
function unavailable(
  change: CredentialChange,
  entry: CredentialDecl,
  candidates: readonly Credential[],
  bound: readonly Credential[],
  heldOutside: ReadonlyArray<{ credential: Credential; key: string }>,
  hiddenBinding: boolean
): CredentialChange {
  const { key } = change
  const wanted = `${entry.provider} credential${entry.name !== undefined ? ` named "${entry.name}"` : ''}`
  const ambiguous = candidates.length > 1
  const holders = heldOutside
    .slice(0, NAMED_CREDENTIALS)
    .map((held) => `"${held.credential.name}" (key "${held.key}")`)
    .join(', ')
  const reason = hiddenBinding
    ? `the key "${key}" is bound to a credential you cannot see.`
    : ambiguous
      ? `the key "${key}" could bind to any of ${candidates.length} ${entry.provider} credentials: ${namedList(candidates)}.`
      : bound.length > 0
        ? `the key "${key}" has no ${wanted} to bind to; ${namedList(bound)} ${bound.length === 1 ? 'is' : 'are'} bound to other declared keys.`
        : heldOutside.length > 0
          ? `the key "${key}" has no ${wanted} to bind to; ${holders} ${heldOutside.length === 1 ? 'is' : 'are'} bound to keys ${KIND_DIRS.credential} does not declare.`
          : `this workspace has no ${wanted} for the key "${key}".`
  const hint = hiddenBinding
    ? 'Ask the credential owner to share it with you, or declare another key.'
    : ambiguous
      ? `Pick one by its display name: \`${key}: { provider: '${entry.provider}', name: '${candidates[0]?.name ?? ''}' }\` in ${KIND_DIRS.credential}.`
      : bound.length === 0 && heldOutside.length > 0
        ? `${connectHint(entry)} Or declare the key "${heldOutside[0]?.key}" in ${KIND_DIRS.credential} and use it instead.`
        : connectHint(entry)
  change.diagnostics.push(
    kindFinding(
      'credential',
      key,
      ambiguous ? 'W_CREDENTIAL_AMBIGUOUS' : 'W_CREDENTIAL_MISSING',
      `${where('credential', key)} binds to nothing: ${reason}`,
      { hint, file: KIND_DIRS.credential }
    )
  )
  return {
    ...change,
    unavailable: {
      code: ambiguous ? 'E_CREDENTIAL_AMBIGUOUS' : 'E_CREDENTIAL_MISSING',
      message: `it uses credential('${key}'), and ${reason}`,
      hint,
    },
    pending: pendingOf({ ...change, action: 'create' }),
  }
}

/** Keys bound to a live credential the caller's listing does not show, among `keys`. */
async function hiddenBindings(
  ctx: PlanContext,
  keys: readonly string[]
): Promise<ReadonlySet<string>> {
  if (keys.length === 0) return new Set()
  const ids = await resolveIds(
    ctx.workspace.workspaceId,
    keys.map((key) => ({ kind: 'credential' as const, key }))
  )
  return new Set(ids.get('credential')?.keys() ?? [])
}

/** Plans every declared key against the workspace's credentials. */
async function planDeclared(
  declared: CredentialsDecl,
  stored: StoredSet<StoredCredential>,
  ctx: PlanContext
): Promise<CredentialChange[]> {
  const keys = Object.keys(declared).sort(compareStrings)
  const all = [...stored.bound.values(), ...stored.unbound]
  // Credentials a declared key keeps: bound to it already, and still fitting.
  const taken = new Map<string, string>()
  for (const key of keys) {
    const bound = stored.bound.get(key)
    if (bound && fits(bound, declared[key])) taken.set(bound.id, key)
  }
  // Credentials bound outside source: to a key neither declared nor recorded by the base. A key
  // the base records (a renamed key) may still move, which `planUndeclaredKeys` relies on.
  const heldOutside = new Map<string, string>()
  for (const [key, credential] of stored.bound) {
    if (Object.hasOwn(declared, key)) continue
    const recorded = ctx.base?.resources[resourceAddress('credential', key)]
    if (recorded?.id !== credential.id) heldOutside.set(credential.id, key)
  }
  const hidden = await hiddenBindings(
    ctx,
    keys.filter((key) => !stored.bound.has(key))
  )
  const changes: CredentialChange[] = []
  for (const key of keys) {
    const entry = declared[key]
    const change: CredentialChange = { kind: 'credential', key, action: 'noop', diagnostics: [] }
    const bound = stored.bound.get(key)
    if (bound && taken.get(bound.id) === key) {
      const recorded = ctx.base?.resources[resourceAddress('credential', key)]
      const fingerprint = credentialFingerprint(entry)
      changes.push({
        ...change,
        storedId: bound.id,
        ...(recorded?.id !== bound.id || recorded.fingerprint !== fingerprint
          ? { base: { id: bound.id, fingerprint } }
          : {}),
      })
      continue
    }
    // By name, then id: the finding names them and its hint picks the first, the same every plan.
    const fitting = all
      .filter((credential) => fits(credential, entry))
      .sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.id, b.id))
    const candidates = fitting.filter(
      (credential) => !taken.has(credential.id) && !heldOutside.has(credential.id)
    )
    const only = candidates.length === 1 ? candidates[0] : undefined
    if (!only || hidden.has(key)) {
      const elsewhere = fitting.filter((credential) => taken.has(credential.id))
      const outside = fitting.flatMap((credential) => {
        const holder = heldOutside.get(credential.id)
        return holder !== undefined && !taken.has(credential.id)
          ? [{ credential, key: holder }]
          : []
      })
      changes.push(unavailable(change, entry, candidates, elsewhere, outside, hidden.has(key)))
      continue
    }
    taken.set(only.id, key)
    const action = bound ? 'update' : 'adopt'
    changes.push({
      ...change,
      action,
      storedId: only.id,
      fields: [`binds "${only.name}"`],
      pending: pendingOf({ ...change, action, storedId: only.id }),
      detail: { entry, ...(bound ? { boundTo: bound.id } : {}) },
    })
  }
  return changes
}

/**
 * Keys the directory no longer declares: one its base records is unbound with `--allow-delete`
 * (refused without), unless a declared key binds the same credential now (a renamed key, whose
 * claim moves the binding); one no base records is left bound.
 */
function planUndeclaredKeys(
  declared: CredentialsDecl,
  stored: StoredSet<StoredCredential>,
  ctx: PlanContext,
  changes: readonly CredentialChange[]
): CredentialChange[] {
  const claimed = new Set(changes.map((change) => change.storedId))
  const undeclared: CredentialChange[] = []
  for (const [key, credential] of stored.bound) {
    if (Object.hasOwn(declared, key) || claimed.has(credential.id)) continue
    const recorded = ctx.base?.resources[resourceAddress('credential', key)]
    if (recorded?.id !== credential.id) continue
    const change: CredentialChange = {
      kind: 'credential',
      key,
      action: 'noop',
      storedId: credential.id,
      diagnostics: [],
    }
    if (!ctx.allowDelete) {
      change.diagnostics.push(
        kindFinding(
          'credential',
          key,
          'E_APPLY_DELETE_NOT_ALLOWED',
          `${where('credential', key)} is no longer declared; unbinding it from "${credential.name}" needs --allow-delete. The credential itself is kept either way.`,
          { hint: 'Pass --allow-delete to unbind the key, or declare it again to keep it.' }
        )
      )
      undeclared.push(change)
      continue
    }
    undeclared.push({
      ...change,
      action: 'delete',
      destructive: { what: 'credential key', counts: {} },
      detail: { boundTo: credential.id },
    })
  }
  return undeclared
}

export const credentialAdapter: KindAdapter<'credential', StoredCredential> = {
  codec: credentialCodec,

  async load(ctx, { allocate }) {
    type Cursor = CursorKey[]
    const rows = await listUpTo(async (cursorKeys: Cursor | undefined) => {
      const page = await listWorkspaceCredentials.execute({
        principal: ctx.principal,
        input: {
          workspaceId: ctx.workspace.workspaceId,
          sortBy: 'createdAt',
          sortOrder: 'asc',
          limit: LIST_PAGE,
          ...(cursorKeys ? { cursorKeys } : {}),
        },
      })
      return { items: page.credentials, next: page.nextCursorKeys }
    })
    const records = rows.map((row) => ({
      id: row.id,
      name: row.displayName,
      state: { provider: row.providerId ?? row.type },
    }))
    return bindStored(ctx, 'credential', records, { allocate })
  },

  async plan(desired, stored, ctx) {
    const declared = desired.get(fileKindGroupKey('credential')) ?? {}
    const changes = await planDeclared(declared, stored, ctx)
    return [...changes, ...planUndeclaredKeys(declared, stored, ctx, changes)]
  },

  async authorize(change, ctx) {
    if (change.action === 'noop') return
    const workspaceId = ctx.workspace.workspaceId
    const credentialId = change.storedId
    if (!credentialId) throw new Error('A credential binding needs the credential id')
    if (change.action === 'delete') {
      await releaseCredentialKey.authorize({
        principal: ctx.principal,
        input: { workspaceId, key: change.key, credentialId },
      })
      return
    }
    await bindCredentialKey.authorize({
      principal: ctx.principal,
      input: { workspaceId, key: change.key, credentialId },
    })
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const { workspaceId } = ctx.workspace
    const credentialId = change.storedId
    if (!credentialId) throw new Error('A credential binding needs the credential id')
    if (change.action === 'delete') {
      await releaseCredentialKey.execute({
        principal,
        input: { workspaceId, key: change.key, credentialId },
      })
      return { id: credentialId, text: {} }
    }
    const entry = change.detail?.entry
    if (!entry) throw new Error('A credential binding needs its declaration')
    const bound = await bindCredentialKey.execute({
      principal,
      input: {
        workspaceId,
        key: change.key,
        credentialId,
        ...(change.detail?.boundTo ? { takeFrom: change.detail.boundTo } : {}),
      },
    })
    return {
      id: credentialId,
      base: { id: credentialId, fingerprint: credentialFingerprint(entry) },
      text: {},
      ...(change.action === 'adopt' && bound.claim === 'rebound'
        ? { diagnostics: [reboundFinding('credential', change.key)] }
        : {}),
      keyClaimed: true,
    }
  },

  async read(stored) {
    return {
      text: {},
      blobs: [],
      base: { id: stored.id, fingerprint: credentialFingerprint(declOf(stored)) },
    }
  },

  printAll(read) {
    const decl: CredentialsDecl = Object.fromEntries(
      read.map((credential) => [credential.key, declOf(credential)])
    )
    return credentialCodec.print(fileKindGroupKey('credential'), decl).text
  },
}
