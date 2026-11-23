/**
 * MCP servers as workspace source: `mcp/<key>.ts` declares one server the workspace consumes.
 * Every read and write goes through the MCP server use cases, so their authorization (the URL
 * allowlist and SSRF checks included), audit and cache invalidation apply unchanged.
 *
 * A server's id derives from its URL (`generateMcpServerId`), so the URL is its identity: an
 * unbound server at the declared URL is adopted when the declaration matches it (any other adopt is
 * refused, see `refuseUnreadAdopt`), two declarations of one URL refuse, and a URL
 * that keeps the id (only its query string differs) is set in place through the reconfigure use
 * case, which validates the URL before it writes anything. A URL with a new id replaces the server
 * (created at the new URL, then the old one deleted). A replace breaks stored workflows that still
 * call the old server by id, so it needs `--allow-delete` when any does. A replace that stopped
 * partway resumes: the server it created is unbound and holds exactly the declaration, so the next
 * apply adopts it, before deleting the old server (a replacement left beside it) or in its place
 * (the old server already deleted). Servers a Credential Group manages are not source's to manage
 * and are left out.
 *
 * `checkRefs` checks the tools workflows call (`mcp(key).tool(name)`) against the server's own
 * listing, through the discovery use case: an unknown tool refuses the plan with a did-you-mean,
 * and a server that cannot be listed (unreachable, created by this apply, or a caller that may not
 * discover, such as a workspace API key) is a warning.
 */
import { createLogger } from '@sim/logger'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { getErrorMessage } from '@sim/utils/errors'
import { didYouMean, type SourceSpan } from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import {
  type BaseResource,
  type FlatDiagnostic,
  fingerprintOf,
  resourceAddress,
} from '@sim/workspace-code'
import {
  MCP_DEFAULTS,
  type McpServerDecl,
  mcpCodec,
  mcpDeclarationPath,
} from '@sim/workspace-code/kinds/mcp'
import { workflowFolder } from '@sim/workspace-code/kinds/workflow'
import type { CursorKey } from '@/lib/api/list-query'
import { authorizeWorkspaceOperation, ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import {
  assertMcpServerUrlAccepted,
  createMcpServerUseCase,
  deleteMcpServerUseCase,
  discoverMcpServerToolsUseCase,
  getMcpServerUseCase,
  listMcpServersUseCase,
  reconfigureMcpServerUseCase,
  updateMcpServerUseCase,
} from '@/lib/mcp/application/use-cases'
import type { McpServerRow } from '@/lib/mcp/queries'
import { generateMcpServerId } from '@/lib/mcp/utils'
import { admitOnce } from '@/lib/workspace-source/application/context'
import {
  finding,
  kindFinding,
  planUndeclared,
  serverGoneFinding,
  where,
} from '@/lib/workspace-source/application/findings'
import { inUseUncheckedFinding, workflowsUsing } from '@/lib/workspace-source/application/in-use'
import { bindStored, listUpTo, pendingOf } from '@/lib/workspace-source/application/keys'
import {
  concealHeaderValues,
  declOf,
  headersToWrite,
  hiddenHeadersWritten,
  holdsDeclaration,
  keepsStoredHeaders,
  resolveStoredHeaders,
  storedFingerprint,
} from '@/lib/workspace-source/application/kinds/mcp/stored'
import { changedFields } from '@/lib/workspace-source/application/kinds/named'
import {
  holdsIn,
  refuseUnreadAdopt,
  resolveDeclared,
  settle,
} from '@/lib/workspace-source/application/three-way'
import type {
  AppliedResource,
  KindAdapter,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredResource,
  StoredSet,
} from '@/lib/workspace-source/application/types'
import { resolveIds } from '@/lib/workspaces/resource-keys'

const logger = createLogger('WorkspaceSourceMcpServers')

const PAGE_SIZE = 200
/** How long a plan waits on one server's tool listing (mostly served from the tool cache). */
const DISCOVERY_TIMEOUT_MS = 10_000

/** Servers a plan lists tools of at once: each waits up to {@link DISCOVERY_TIMEOUT_MS}. */
const LIST_TOOLS_CONCURRENCY = 6

/** What the apply carries out for an existing server, decided at plan time. */
export interface McpPlan {
  /** The declaration fields that differ from the stored server. */
  changed: string[]
  /** The URL changed its id: create the server at the new URL and delete the stored one. */
  replace?: boolean
  /**
   * The server at the new URL an interrupted replace already created, which this replace adopts
   * instead of creating one.
   */
  replacement?: string
}

type McpChange = PlannedChange<'mcp-server'>
type StoredServer = StoredResource<McpServerRow>

/** The id the server at `url` has in this workspace. */
function serverIdOf(ctx: SourceContext, url: string): string {
  return generateMcpServerId(ctx.workspace.workspaceId, url)
}

function baseOf(record: StoredServer): BaseResource {
  return { id: record.id, fingerprint: storedFingerprint(record.state) }
}

/**
 * Plans one declared server. `claimed` maps each server id the directory declares so far to its
 * key, so two declarations of one URL refuse.
 */
async function planServer(
  key: string,
  declared: McpServerDecl,
  stored: StoredSet<McpServerRow>,
  ctx: PlanContext,
  claimed: Map<string, string>
): Promise<McpChange> {
  const file = mcpDeclarationPath(key)
  const change: McpChange = { kind: 'mcp-server', key, action: 'noop', diagnostics: [] }
  const finding = (code: Parameters<typeof kindFinding>[2], message: string, hint?: string) =>
    change.diagnostics.push(
      kindFinding('mcp-server', key, code, message, { file, ...(hint ? { hint } : {}) })
    )
  const id = serverIdOf(ctx, declared.url)
  const first = claimed.get(id)
  if (first !== undefined) {
    finding(
      'E_NAME_TAKEN',
      `${declared.url} is also declared by ${where('mcp-server', first)}.`,
      'Declare each MCP server once.'
    )
    return change
  }
  claimed.set(id, key)

  const bound = stored.bound.get(key)
  const adoptable = stored.unbound.find((record) => record.id === id)
  const target = bound ?? adoptable
  // A caller who cannot see a header's stored value may only keep it: comparing text they wrote
  // with the hidden value would tell them whether they guessed it. The plan compares the
  // declaration with the bound server and with the one at its URL, so both are checked.
  const compared = [bound, adoptable].flatMap((record) => (record ? [record] : []))
  if (compared.length > 0 && (await revealsHeaderValues(ctx)) !== true) {
    const hidden = new Set(
      compared.flatMap((record) => hiddenHeadersWritten(declared, record.state))
    )
    for (const header of hidden) {
      finding(
        'E_APPLY_FORBIDDEN',
        `Header "${header}" holds a value you cannot see, so it can only be kept as \`stored()\`.`,
        'Writing a header value the MCP server hides needs permission to update the server.'
      )
    }
    if (change.diagnostics.length > 0) return change
  }
  const { decl, missing } = resolveStoredHeaders(declared, target?.state)
  change.decl = decl
  // A server the base records that the server deleted since: its `stored()` headers have nothing
  // to keep, and the declaration cannot be compared with the base, so it stays deleted.
  const recorded = ctx.base?.resources[resourceAddress('mcp-server', key)]
  if (missing.length > 0 && !bound && recorded && !holdsIn(stored)(recorded.id)) {
    change.diagnostics.push(serverGoneFinding('mcp-server', key, false))
    return change
  }
  for (const header of missing) {
    finding(
      'E_MCP_STORED_MISSING',
      `Header "${header}" keeps its stored value (\`stored()\`), but the server holds none.`,
      `Write the header as \`env.NAME\` instead.`
    )
  }
  if (missing.length > 0) return change

  const holder = [...stored.bound.values()].find((record) => record.id === id && record.key !== key)
  if (holder) {
    finding(
      'E_NAME_TAKEN',
      `${declared.url} is the MCP server under key "${holder.key}".`,
      `Edit ${where('mcp-server', holder.key)} instead.`
    )
    return change
  }

  const base = ctx.base?.resources[resourceAddress('mcp-server', key)]
  const holds = holdsIn(stored)
  // A replace that deleted the old server and stopped before binding the key to the new one: the
  // base's server is gone and the new one holds the declaration, so it is adopted, not `deleted`.
  const resumed =
    !bound &&
    adoptable &&
    base?.fingerprint &&
    !holds(base.id) &&
    holdsDeclaration(declared, adoptable.state)
  const resolution = resumed
    ? { action: 'adopt' as const, stored: adoptable }
    : resolveDeclared({
        local: fingerprintOf(mcpCodec.canonical(decl)),
        stored: bound,
        adoptable,
        base,
        fingerprint: (record) => storedFingerprint(record.state),
        holds,
      })
  const planned = settle(resolution, change, baseOf)
  if ('settled' in planned) return planned.settled
  if (planned.action === 'create') {
    return {
      ...change,
      action: 'create',
      pending: pendingOf({ ...change, action: 'create' }, { name: decl.name }),
    }
  }
  const record = planned.stored
  const changed = changedFields(mcpCodec.canonical(declOf(record.state)), mcpCodec.canonical(decl))
  if (planned.action === 'adopt' && !resumed) {
    const refused = refuseUnreadAdopt(change, record, changed)
    if (refused) return refused
  }
  const update: McpChange = {
    ...change,
    action: planned.action,
    storedId: record.id,
    ...(planned.action === 'adopt'
      ? { pending: pendingOf({ ...change, action: 'adopt', storedId: record.id }) }
      : {}),
    ...(changed.length > 0 ? { fields: changed } : {}),
    storedFingerprint: storedFingerprint(record.state),
    detail: { changed },
  }
  // A URL that keeps the id is set in place (see `apply`); only a new id replaces the server.
  if (record.state.url === decl.url || record.id === id) return update
  if (!adoptable) return planReplace(update, record, ctx)
  // A server already at the new URL: the one an earlier replace created before it stopped, when it
  // holds the declaration (its `stored()` headers copied from this one).
  if (holdsDeclaration(declared, adoptable.state, record.state)) {
    return planReplace(update, record, ctx, adoptable)
  }
  finding(
    'E_NAME_TAKEN',
    `${declared.url} is already MCP server "${adoptable.name}", which differs from ${where('mcp-server', key)}.`,
    'Delete that server, or declare it under its own key.'
  )
  return change
}

/**
 * A changed URL: the server is created at the new URL and the stored one deleted. Stored workflows
 * call the old server by id, so a replace that breaks any needs `--allow-delete`.
 */
async function planReplace(
  change: McpChange,
  record: StoredServer,
  ctx: PlanContext,
  replacement?: StoredServer
): Promise<McpChange> {
  // `null` when the scan ran out of time: the replace deletes the old server, so it is refused.
  const using = await workflowsUsing(ctx.workspace.workspaceId, [record.id])
  const users = using?.get(record.id) ?? []
  const replaced: McpChange = {
    ...change,
    fields: ['url (replaces the server)', ...(change.fields ?? []).filter((f) => f !== 'url')],
    destructive: { what: 'MCP server (replaced)', counts: { workflows: users.length } },
    pending: replacement
      ? pendingOf(
          { ...change, action: 'adopt', storedId: replacement.id },
          { name: change.decl?.name }
        )
      : pendingOf({ ...change, action: 'create' }, { name: change.decl?.name }),
    detail: {
      changed: change.detail?.changed ?? [],
      replace: true,
      ...(replacement ? { replacement: replacement.id } : {}),
    },
  }
  const file = mcpDeclarationPath(change.key)
  replaced.diagnostics.push(
    kindFinding(
      'mcp-server',
      change.key,
      'W_MCP_REPLACE',
      replacement
        ? `The URL of ${where('mcp-server', change.key)} changed, and an earlier apply already created the server at ${change.decl?.url}: it takes the key and "${record.name}" is deleted.`
        : `The URL of ${where('mcp-server', change.key)} changed, which replaces the server: it is created at ${change.decl?.url} and "${record.name}" is deleted.`,
      { file, hint: 'Its id derives from its URL; the key moves to the new server.' }
    )
  )
  if (using === null) {
    replaced.diagnostics.push(inUseUncheckedFinding(change))
  } else if (users.length > 0 && !ctx.allowDelete) {
    replaced.diagnostics.push(
      kindFinding(
        'mcp-server',
        change.key,
        'E_APPLY_DELETE_NOT_ALLOWED',
        `Replacing "${record.name}" breaks ${users.length} stored workflow(s) that call it by id until they are applied again; it needs --allow-delete.`,
        { file, hint: 'Pass --allow-delete, or keep the URL.' }
      )
    )
  }
  return replaced
}

/** What a create or replace sends: every declared setting, with its default when undeclared. */
function createInput(ctx: SourceContext, decl: McpServerDecl, row: McpServerRow | undefined) {
  return {
    workspaceId: ctx.workspace.workspaceId,
    name: decl.name,
    description: decl.description ?? null,
    transport: decl.transport ?? MCP_DEFAULTS.transport,
    url: decl.url,
    headers: headersToWrite(decl, row),
    timeout: decl.timeout ?? MCP_DEFAULTS.timeout,
    retries: decl.retries ?? MCP_DEFAULTS.retries,
    enabled: decl.enabled !== false,
    authType: decl.auth?.type ?? MCP_DEFAULTS.auth,
    oauthClientId: decl.auth?.clientId ?? null,
    source: 'api' as const,
  }
}

/** What an update sends: the changed fields only, so the rest stay as the plan saw them. */
function updateInput(
  ctx: SourceContext,
  serverId: string,
  decl: McpServerDecl,
  changed: readonly string[],
  row: McpServerRow
) {
  const full = createInput(ctx, decl, row)
  const has = (field: keyof McpServerDecl) => changed.includes(field)
  return {
    workspaceId: full.workspaceId,
    serverId,
    source: full.source,
    ...(has('name') ? { name: full.name } : {}),
    ...(has('description') ? { description: full.description } : {}),
    ...(has('transport') ? { transport: full.transport } : {}),
    ...(has('url') ? { url: full.url } : {}),
    ...(has('headers') ? { headers: full.headers } : {}),
    ...(has('timeout') ? { timeout: full.timeout } : {}),
    ...(has('retries') ? { retries: full.retries } : {}),
    ...(has('enabled') ? { enabled: full.enabled } : {}),
    ...(has('auth') ? { authType: full.authType, oauthClientId: full.oauthClientId } : {}),
  }
}

/**
 * The use case an update goes through: reconfigure when the URL changes (the update use case
 * refuses any new URL; reconfigure takes one that keeps the server's id, and checks a new
 * destination needs an admin), update otherwise.
 */
function updateUseCaseOf(changed: readonly string[]) {
  return changed.includes('url') ? reconfigureMcpServerUseCase : updateMcpServerUseCase
}

/**
 * Whether the caller may see the header values a server stores: as the MCP server list shows them
 * only to one who may rewrite them, a get prints them only to a caller the update use case admits.
 */
function revealsHeaderValues(ctx: SourceContext): Promise<unknown> {
  return admitOnce(ctx, 'mcp:header-values', () =>
    authorizeWorkspaceOperation(ctx.principal, mcpServerOperations.update, ctx.workspace).then(
      () => true,
      (error: unknown) => {
        if (error instanceof ForbiddenOperationError) return false
        throw error
      }
    )
  )
}

/**
 * A replace that keeps `stored()` header values sends them to the new URL's host, so it needs
 * what pointing a server at another destination needs (an admin), as the reconfigure use case
 * requires.
 */
async function authorizeCarriedHeaders(change: McpChange, ctx: SourceContext): Promise<void> {
  if (!change.detail?.replace || !change.decl || !keepsStoredHeaders(change.decl)) return
  await authorizeWorkspaceOperation(
    ctx.principal,
    mcpServerOperations.changeDestination,
    ctx.workspace
  )
}

async function getServer(ctx: SourceContext, serverId: string): Promise<McpServerRow> {
  const { server } = await getMcpServerUseCase.execute({
    principal: ctx.principal,
    input: { workspaceId: ctx.workspace.workspaceId, serverId },
  })
  return server
}

function written(key: string, row: McpServerRow): AppliedResource {
  return {
    id: row.id,
    base: { id: row.id, fingerprint: storedFingerprint(row) },
    text: mcpCodec.print(key, declOf(row)).text,
  }
}

/** Why a server's tools could not be listed, as a finding says it (never the upstream text). */
function unlistedReason(error: unknown): string {
  if (error instanceof ForbiddenOperationError) return 'this caller may not list its tools'
  if (error instanceof OrchestrationError && error.code === 'conflict') return error.message
  return 'it could not be reached'
}

/** The tool names server `serverId` lists, or why they could not be listed. */
async function listTools(
  ctx: PlanContext,
  serverId: string
): Promise<{ names: string[] } | { reason: string }> {
  try {
    const { tools } = await discoverMcpServerToolsUseCase.execute({
      principal: ctx.principal,
      input: {
        workspaceId: ctx.workspace.workspaceId,
        serverId,
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        bestEffort: true,
      },
    })
    return { names: tools.map((tool) => tool.name) }
  } catch (error) {
    logger.info('Plan left MCP tool names unchecked', { serverId, error: getErrorMessage(error) })
    return { reason: unlistedReason(error) }
  }
}

/** Each change that calls tools of an MCP server, with the tools, by server key. */
function toolUsers(
  changes: readonly PlannedChange[]
): Map<string, Array<{ change: PlannedChange; tools: Map<string, SourceSpan | undefined> }>> {
  const byServer = new Map<
    string,
    Array<{ change: PlannedChange; tools: Map<string, SourceSpan | undefined> }>
  >()
  for (const change of changes) {
    if (change.action === 'delete') continue
    for (const ref of change.refs ?? []) {
      if (ref.kind !== 'mcp-server' || ref.member === undefined) continue
      const users = byServer.get(ref.key) ?? []
      let user = users.find((entry) => entry.change === change)
      if (!user) {
        user = { change, tools: new Map() }
        users.push(user)
      }
      if (!user.tools.has(ref.member)) user.tools.set(ref.member, ref.span)
      byServer.set(ref.key, users)
    }
  }
  return byServer
}

/**
 * Where a finding about the tools a change calls points: its workflow file, at the line that
 * writes the tool when the workflow's compile located it.
 */
function fileOf(change: PlannedChange, span?: SourceSpan): Partial<FlatDiagnostic> {
  if (change.kind !== 'workflow') return {}
  return {
    file: `${workflowFolder(change.key)}/${SOURCE_ENTRY_FILE}`,
    ...(span
      ? {
          line: span.line,
          column: span.column,
          endLine: span.endLine,
          endColumn: span.endColumn,
        }
      : {}),
  }
}

export const mcpAdapter: KindAdapter<'mcp-server', McpServerRow> = {
  codec: mcpCodec,
  keys: 'every-write',

  async load(ctx, { allocate }) {
    const rows = await listUpTo(async (cursorKeys: CursorKey[] | undefined) => {
      const page = await listMcpServersUseCase.execute({
        principal: ctx.principal,
        input: {
          workspaceId: ctx.workspace.workspaceId,
          sortBy: 'createdAt',
          sortOrder: 'asc',
          limit: PAGE_SIZE,
          ...(cursorKeys ? { cursorKeys } : {}),
        },
      })
      return { items: page.servers, next: page.nextCursorKeys }
    })
    const records = rows
      .filter((row) => row.url && !row.managedConnectorId && !row.credentialGroupId)
      .map((row) => ({ id: row.id, name: row.name, state: row }))
    return bindStored(ctx, 'mcp-server', records, { allocate })
  },

  async plan(desired, stored, ctx) {
    const claimed = new Map<string, string>()
    const changes: McpChange[] = []
    for (const [key, decl] of desired) {
      changes.push(await planServer(key, decl, stored, ctx, claimed))
    }
    const undeclared = planUndeclared('mcp-server', desired, stored, ctx, {
      declared: changes,
      fingerprint: (record) => storedFingerprint(record.state),
    })
    return [...changes, ...undeclared]
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    const decl = change.decl
    const createsServer =
      change.action === 'create' || (change.detail?.replace && !change.detail.replacement)
    if (createsServer && decl) {
      await createMcpServerUseCase.authorize({
        principal,
        input: { workspaceId, name: decl.name, url: decl.url },
      })
    }
    await authorizeCarriedHeaders(change, ctx)
    if (change.storedId && (change.action === 'delete' || change.detail?.replace)) {
      await deleteMcpServerUseCase.authorize({
        principal,
        input: { workspaceId, serverId: change.storedId },
      })
    } else if (change.storedId && change.action !== 'create') {
      await updateUseCaseOf(change.detail?.changed ?? []).authorize({
        principal,
        input: { workspaceId, serverId: change.storedId },
      })
    }
    // The URL is checked as the write checks it (allowlist, egress policy, DNS), so a URL the
    // write would refuse refuses the plan, not the apply after other resources were written. It
    // runs last, so only a caller who may write the server learns how its URL fares.
    if (decl && (createsServer || change.detail?.changed.includes('url'))) {
      await assertMcpServerUrlAccepted(decl.url)
    }
  },

  async storedFingerprintNow(change, ctx) {
    if (!change.storedId) throw new Error('An MCP server check needs the stored id')
    return storedFingerprint(await getServer(ctx, change.storedId))
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    const remove = (serverId: string) =>
      deleteMcpServerUseCase.execute({ principal, input: { workspaceId, serverId, source: 'api' } })
    if (change.action === 'delete') {
      if (!change.storedId) throw new Error('An MCP server delete needs the stored id')
      await remove(change.storedId)
      return { id: change.storedId, text: {} }
    }
    const decl = change.decl
    if (!decl) throw new Error('An MCP server write needs its declaration')
    const current = change.storedId ? await getServer(ctx, change.storedId) : undefined
    const create = async () =>
      (await createMcpServerUseCase.execute({ principal, input: createInput(ctx, decl, current) }))
        .server
    if (change.action === 'create') return written(change.key, await create())
    if (!current) throw new Error('An MCP server update needs the stored id')
    if (change.detail?.replace) {
      // Adopting a leftover replacement moves the key and its stored() values to the new host as
      // a create would, so it needs the same check.
      await authorizeCarriedHeaders(change, ctx)
      // Created first, so a failed create leaves the stored server as it was; a re-run after a
      // stop between the two adopts the server created here (`replacement`).
      const { replacement } = change.detail
      const created = replacement ? await getServer(ctx, replacement) : await create()
      await remove(current.id)
      return written(change.key, created)
    }
    const changed = change.detail?.changed ?? []
    if (changed.length === 0) return written(change.key, current)
    const { server } = await updateUseCaseOf(changed).execute({
      principal,
      input: updateInput(ctx, current.id, decl, changed, current),
    })
    return written(change.key, server)
  },

  async read(stored, ctx) {
    const decl = declOf(stored.state)
    const printed = mcpCodec.print(stored.key, decl)
    const parsed = mcpCodec.parse(stored.key, printed.text, [])
    const resolved = parsed.decl && resolveStoredHeaders(parsed.decl, stored.state).decl
    const fingerprint = storedFingerprint(stored.state)
    if (!resolved || fingerprintOf(mcpCodec.canonical(resolved)) !== fingerprint) {
      throw new OrchestrationError(
        'validation',
        'This MCP server holds a value source files cannot express, so it is left out.'
      )
    }
    const text =
      (await revealsHeaderValues(ctx)) === true
        ? printed.text
        : mcpCodec.print(stored.key, concealHeaderValues(decl, stored.state)).text
    return { text, blobs: [], base: { id: stored.id, fingerprint } }
  },

  async checkRefs(changes, ctx) {
    const users = toolUsers(changes)
    if (users.size === 0) return
    const servers = changes.filter(
      (change): change is McpChange => change.kind === 'mcp-server' && change.action !== 'delete'
    )
    const unresolved = [...users.keys()].filter(
      (key) => !servers.some((change) => change.key === key)
    )
    const ids =
      unresolved.length > 0
        ? (
            await resolveIds(
              ctx.workspace.workspaceId,
              unresolved.map((key) => ({ kind: 'mcp-server' as const, key }))
            )
          ).get('mcp-server')
        : undefined
    const used = [...users]
    // Every server's tools are listed at once (bounded), so servers that time out wait together.
    const listings = await mapWithConcurrency(used, LIST_TOOLS_CONCURRENCY, async ([key]) => {
      const server = servers.find((change) => change.key === key)
      if (server && (server.action === 'create' || server.detail?.replace)) {
        return { reason: 'this apply creates the server' }
      }
      const serverId = server ? server.storedId : ids?.get(key)
      // A key that names no server is the workflow's own refusal (an unknown resource).
      return serverId ? listTools(ctx, serverId) : null
    })
    used.forEach(([key, callers], index) => {
      const listed = listings[index]
      if (!listed) return
      if ('reason' in listed) {
        for (const { change } of callers) {
          change.diagnostics.push(
            kindFinding(
              change.kind,
              change.key,
              'W_MCP_TOOLS_UNCHECKED',
              `The tools ${where(change.kind, change.key)} calls on MCP server "${key}" are not checked: ${listed.reason}.`,
              {
                hint: 'A tool the server does not list fails when the agent calls it.',
                ...fileOf(change),
              }
            )
          )
        }
        return
      }
      const names = new Set(listed.names)
      for (const { change, tools } of callers) {
        for (const [tool, span] of tools) {
          if (names.has(tool)) continue
          const suggestion = didYouMean(tool, names, (name) => `"${name}"`)
          change.diagnostics.push(
            finding(
              'E_MCP_TOOL_UNKNOWN',
              `${where(change.kind, change.key)} calls tool "${tool}" on MCP server "${key}", which does not list it.${suggestion ? ` ${suggestion}` : ''}`,
              {
                hint: `The server lists: ${[...names].slice(0, 20).join(', ') || 'no tools'}.`,
                ...fileOf(change, span),
                kind: change.kind,
                key: change.key,
              }
            )
          )
        }
      }
    })
  },
}
