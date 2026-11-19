/**
 * Secrets as workspace source: `secrets.ts` names the workspace secrets workflows read, by name
 * and description. A reference kind: an apply never creates, sets or deletes a secret, and a
 * secret's value never leaves the server (the values the listing returns for a visible secret are
 * dropped on read).
 *
 * - A declared name the workspace holds a secret under is a no-op, or a description-only update
 *   through `setSecretUseCase`, decided by the three-way rule on its description. Without a base
 *   entry (a directory read from another workspace, say), a declared description is applied and an
 *   undeclared one is left as the server holds it.
 * - A declared name the workspace holds no secret under is `W_SECRET_MISSING` on `secrets.ts`, and
 *   every change the apply writes that reads it is held back (`E_SECRET_MISSING`).
 * - A secret the directory does not declare is left alone, with no finding: nothing is deleted.
 *
 * Only workspace secrets: another user's personal secret is never listed, and a name only the
 * caller's personal secret holds counts as missing, since not every run of the workspace sees it.
 * Listing secrets refuses a workspace API key, so a directory with `secrets.ts` is refused one.
 */
import { compareStrings } from '@sim/utils/string'
import { KIND_DIRS, type ResourceFingerprint, resourceAddress } from '@sim/workspace-code'
import { fileKindGroupKey } from '@sim/workspace-code/kinds/entries'
import {
  isDeclarableSecret,
  type SecretDecl,
  type SecretsDecl,
  secretCodec,
  secretFingerprint,
} from '@sim/workspace-code/kinds/secrets'
import type { CursorKey } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { listSecretsUseCase, setSecretUseCase } from '@/lib/secrets/application/use-cases'
import { kindFinding, where } from '@/lib/workspace-source/application/findings'
import { listUpTo } from '@/lib/workspace-source/application/keys'
import { resolveDeclared, settle } from '@/lib/workspace-source/application/three-way'
import type {
  KindAdapter,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredResource,
  StoredSet,
} from '@/lib/workspace-source/application/types'

/** A stored workspace secret as source sees it: its description, never its value. */
interface StoredSecret {
  description: string | null
}

/** A secret change carries the declared entry it writes. */
type SecretChange = PlannedChange<'secret'>

/** Secrets per page while listing a workspace's secrets. */
const LIST_PAGE = 200

/** The stored secret as the declaration a get prints. */
function declOf(state: StoredSecret): SecretDecl {
  return state.description ? { description: state.description } : {}
}

function storedFingerprint(
  secret: Pick<StoredResource<StoredSecret>, 'state'>
): ResourceFingerprint {
  return secretFingerprint(declOf(secret.state))
}

function setHint(name: string): string {
  return `Set it with \`sim secrets set ${name} --scope workspace\` (or in the workspace's secrets settings), then apply again.`
}

/**
 * The workspace's secrets (metadata only, never a value), up to a page past the per-kind limit;
 * `search` narrows the listing to names containing it.
 */
async function listWorkspaceSecrets(
  ctx: SourceContext,
  search?: string
): Promise<StoredResource<StoredSecret>[]> {
  const rows = await listUpTo(async (cursorKeys: CursorKey[] | undefined) => {
    const page = await listSecretsUseCase.execute({
      principal: ctx.principal,
      input: {
        workspaceId: ctx.workspace.workspaceId,
        scope: 'workspace',
        sortBy: 'name',
        sortOrder: 'asc',
        limit: LIST_PAGE,
        ...(search !== undefined ? { search } : {}),
        ...(cursorKeys ? { cursorKeys } : {}),
      },
    })
    return { items: page.secrets, next: page.nextCursorKeys }
  })
  return rows.flatMap((row) =>
    row.type === 'env_workspace' && row.envKey
      ? [{ key: row.envKey, id: row.id, name: row.envKey, state: { description: row.description } }]
      : []
  )
}

/** Plans one declared secret against the workspace secret of its name. */
function planSecret(
  name: string,
  entry: SecretDecl,
  stored: StoredSet<StoredSecret>,
  ctx: PlanContext
): SecretChange {
  const change: SecretChange = { kind: 'secret', key: name, action: 'noop', diagnostics: [] }
  const secret = stored.bound.get(name)
  if (!secret) {
    change.diagnostics.push(
      kindFinding(
        'secret',
        name,
        'W_SECRET_MISSING',
        `${where('secret', name)} is declared, but this workspace has no secret ${name}.`,
        { hint: setHint(name), file: KIND_DIRS.secret }
      )
    )
    change.unavailable = {
      code: 'E_SECRET_MISSING',
      message: `it reads the secret ${name}, which this workspace has no value for.`,
      hint: setHint(name),
    }
    return change
  }
  const update: SecretChange = {
    ...change,
    action: 'update',
    storedId: secret.id,
    fields: ['description'],
    detail: entry,
    storedFingerprint: storedFingerprint(secret),
  }
  const local = secretFingerprint(entry)
  const base = ctx.base?.resources[resourceAddress('secret', name)]
  if (base?.id !== secret.id || !base.fingerprint) {
    // No base here: a declared description is the directory's to set; an undeclared one is left.
    if (
      entry.description !== undefined &&
      (entry.description || null) !== (secret.state.description || null)
    ) {
      return update
    }
    // An undeclared description records no base entry: recording `{}` would read as a description
    // removed since the base, and recording the server's would clear it on the next apply.
    if (entry.description === undefined) return { ...change, storedId: secret.id }
    return {
      ...change,
      storedId: secret.id,
      base: { id: secret.id, fingerprint: storedFingerprint(secret) },
    }
  }
  const resolution = resolveDeclared({
    local,
    stored: secret,
    base,
    fingerprint: storedFingerprint,
    holds: () => true,
  })
  const settled = settle(resolution, change, (resource) => ({
    id: resource.id,
    fingerprint: storedFingerprint(resource),
  }))
  return 'settled' in settled ? settled.settled : update
}

export const secretAdapter: KindAdapter<'secret', StoredSecret> = {
  codec: secretCodec,

  async load(ctx) {
    const secrets = await listWorkspaceSecrets(ctx)
    return { bound: new Map(secrets.map((secret) => [secret.key, secret])), unbound: [] }
  },

  async plan(desired, stored, ctx) {
    const declared = desired.get(fileKindGroupKey('secret')) ?? {}
    return Object.keys(declared)
      .sort(compareStrings)
      .map((name) => planSecret(name, declared[name], stored, ctx))
  },

  async authorize(change, ctx) {
    if (change.action !== 'update' || !change.detail) return
    await setSecretUseCase.authorize({
      principal: ctx.principal,
      input: {
        workspaceId: ctx.workspace.workspaceId,
        name: change.key,
        scope: 'workspace',
        description: change.detail.description ?? null,
      },
    })
  },

  async storedFingerprintNow(change, ctx) {
    const secret = (await listWorkspaceSecrets(ctx, change.key)).find(
      (candidate) => candidate.key === change.key
    )
    return secret ? storedFingerprint(secret) : ''
  },

  async apply(change, ctx) {
    const entry = change.detail
    if (change.action !== 'update' || !entry) {
      throw new Error('A secret write is a description update')
    }
    const { secret } = await setSecretUseCase.execute({
      principal: ctx.principal,
      input: {
        workspaceId: ctx.workspace.workspaceId,
        name: change.key,
        scope: 'workspace',
        description: entry.description ?? null,
      },
    })
    const fingerprint = storedFingerprint({ state: { description: secret.description } })
    return { id: secret.id, base: { id: secret.id, fingerprint }, text: {} }
  },

  async read(stored) {
    if (!isDeclarableSecret(stored.key)) {
      throw new OrchestrationError(
        'validation',
        `secrets.ts cannot declare a secret named "${stored.key}", so it is left out; rename the secret to manage it from source.`
      )
    }
    return { text: {}, blobs: [], base: { id: stored.id, fingerprint: storedFingerprint(stored) } }
  },

  printAll(read) {
    const decl: SecretsDecl = Object.fromEntries(
      read.map((secret) => [secret.key, declOf(secret.state)])
    )
    return secretCodec.print(fileKindGroupKey('secret'), decl).text
  },
}
