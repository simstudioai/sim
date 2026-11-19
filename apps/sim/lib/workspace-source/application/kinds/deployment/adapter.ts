/**
 * Deployments as workspace source: `deployments/<key>.ts` deploys the workflow under the same key
 * through the deployment use cases (`deployWorkflow`, `undeployWorkflow`, `updateWorkflowPublicApi`
 * and the workflow chat use cases), so admin role, the workspace-key denial, permission-group
 * capabilities, locks, audit and the deploy's own trigger registration (schedules, webhooks) are
 * exactly a deploy's. Deployments apply after workflows, so one apply edits a workflow and then
 * publishes it.
 *
 * The three-way rule covers what the server stores: the public API flag and the chat. `live` is
 * read on every apply against the server's "draft differs" flag instead: `'draft'` deploys when
 * this apply edits the workflow or the draft already differs, `'pinned'` never redeploys and says
 * when the draft differs. A deploy is keyed by the deployment's fingerprint and the version it
 * replaces, so a re-run after a failure replays the same deploy instead of publishing twice.
 *
 * The server keeps a chat password only encrypted, so the base records which variable the last
 * apply set it from (`x-passwordEnv`), and the stored chat reads as that `env.NAME` against it.
 * Publishing to an MCP server is not part of source.
 */
import { sha256Hex } from '@sim/security/hash'
import { isRecordLike } from '@sim/utils/object'
import type { Json } from '@sim/workflow-code'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import {
  type BaseResource,
  fingerprintOf,
  resourceAddress,
  type WorkspaceDiagnosticCode,
} from '@sim/workspace-code'
import {
  type ChatDecl,
  type DeploymentDecl,
  deploymentCodec,
  deploymentDeclarationPath,
} from '@sim/workspace-code/kinds/deployment'
import { chatDeploymentOperations } from '@/lib/chat-deployments/application/operations'
import {
  assertChatReplaceAllowed,
  deleteWorkflowChatDeployment,
  isChatIdentifierHeldElsewhere,
  replaceWorkflowChatDeployment,
} from '@/lib/chat-deployments/application/workflow-chat-deployment'
import { authorizeWorkspaceOperation } from '@/lib/core/application'
import { resolvePrincipalEnvironmentVariable } from '@/lib/core/application/environment-reference'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  deployWorkflow,
  readWorkflowDeploymentStatus,
  undeployWorkflow,
} from '@/lib/workflows/application/deployments'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { listWorkflowTriggers } from '@/lib/workflows/application/triggers'
import { updateWorkflowPublicApi } from '@/lib/workflows/application/update-workflow-deployment-settings'
import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import { kindFinding, planUndeclared, where } from '@/lib/workspace-source/application/findings'
import { bindStored, listUpTo } from '@/lib/workspace-source/application/keys'
import {
  declOf,
  readBlockNames,
  readDeployment,
  type StoredDeployment,
  storedFingerprint,
} from '@/lib/workspace-source/application/kinds/deployment/stored'
import {
  holdsIn,
  type PartFingerprints,
  resolveDeclared,
  settle,
} from '@/lib/workspace-source/application/three-way'
import type {
  ApplyContext,
  KindAdapter,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredSet,
} from '@/lib/workspace-source/application/types'
import { resolveIds } from '@/lib/workspaces/resource-keys'

/** Deployed workflows per page while listing them. */
const LIST_PAGE = 200

/** Deployments a load reads at once. */
const READ_CONCURRENCY = 4

/** The base entry field naming the variable a chat password was last set from. */
const PASSWORD_ENV = 'x-passwordEnv'

/**
 * The base entry field holding each part's fingerprint (`api`, `chat`): an apply writes the flag
 * and the chat through separate use cases, so one stopped between them leaves the server partway,
 * and a re-run tells that from a teammate's edit part by part.
 */
const PARTS = 'x-parts'

/** What an apply carries out for one deployment, decided at plan time. */
interface DeploymentPlan {
  /** The workflow, when it exists at plan time (not one this apply creates). */
  workflowId?: string
  /** Publish the draft: a first deploy, or `live: 'draft'` with a draft that differs. */
  deploy: boolean
  /** The public API flag to set: on a first deploy (an undeploy keeps the old one), or a change. */
  publicApi?: boolean
  /** Whether the chat is written or removed. */
  chat?: 'replace' | 'delete'
  /** The variable the base recorded the stored chat password under (for `fingerprintNow`). */
  basePasswordEnv?: string
  /**
   * The stored chat's output block names at plan time, by the block id the chat stores. The
   * workflow writes first, and may rename or re-create those blocks, so `fingerprintNow` reads each
   * output by this name, as the plan did: the check compares the block ids the chat stores, and an
   * output re-pointed at another block since the plan still moves the fingerprint.
   */
  plannedOutputNames?: Record<string, string>
}

type DeploymentChange = PlannedChange<DeploymentDecl, DeploymentPlan>

/** The variable a base entry records the chat password under. */
function passwordEnvOf(base: BaseResource | undefined): string | undefined {
  const name = base?.[PASSWORD_ENV]
  return typeof name === 'string' ? name : undefined
}

/** Each part's fingerprint (`api`, `chat`) of a declaration. */
function partsOf(decl: DeploymentDecl): PartFingerprints {
  return Object.fromEntries(
    Object.entries(fieldsOf(deploymentCodec.canonical(decl))).map(([part, value]) => [
      part,
      fingerprintOf(value),
    ])
  )
}

/** A stored deployment's parts; `undefined` when it cannot be read as a declaration. */
function storedParts(
  state: StoredDeployment,
  passwordEnv: string | undefined
): PartFingerprints | undefined {
  const decl = declOf(state, { live: 'draft', passwordEnv })
  return decl ? partsOf(decl) : undefined
}

/** The parts a base entry records, or `undefined` for a base written before it recorded them. */
function basePartsOf(base: BaseResource | undefined): PartFingerprints | undefined {
  const parts = base?.[PARTS]
  if (!isRecordLike(parts)) return undefined
  const read: Record<string, string> = {}
  for (const [part, value] of Object.entries(parts)) {
    if (typeof value !== 'string') return undefined
    read[part] = value
  }
  return read
}

/**
 * Whether a deployment the base has no entry for is a first deploy of `decl` that stopped before
 * its chat: the workflow is deployed with the declared API flag and either no chat yet or the
 * declared one. Finishing it overwrites nothing the server holds, so it resumes instead of asking
 * for a get, which would print over the declared chat.
 */
function startedFirstDeploy(decl: DeploymentDecl, state: StoredDeployment): boolean {
  const server = storedParts(state, undefined)
  if (!server) return false
  const local = partsOf(decl)
  const noChat = fingerprintOf(null)
  return Object.keys({ ...local, ...server }).every(
    (part) => server[part] === local[part] || (part === 'chat' && server[part] === noChat)
  )
}

/** The base entry for a stored deployment, the chat password read as `passwordEnv`. */
function baseEntry(
  id: string,
  state: StoredDeployment,
  passwordEnv: string | undefined
): BaseResource {
  const parts = storedParts(state, passwordEnv)
  return {
    id,
    fingerprint: storedFingerprint(state, passwordEnv),
    ...(parts ? { [PARTS]: parts } : {}),
    ...(passwordEnv ? { [PASSWORD_ENV]: passwordEnv } : {}),
  }
}

/** The variable a declaration sets the chat password from, if any. */
function declaredPasswordEnv(decl: DeploymentDecl): string | undefined {
  const auth = decl.chat?.auth
  if (auth === undefined || auth === 'public' || !('password' in auth)) return undefined
  return auth.password === 'stored' ? undefined : auth.password.env
}

function deploymentFinding(
  key: string,
  code: WorkspaceDiagnosticCode,
  message: string,
  hint?: string
) {
  return kindFinding('deployment', key, code, message, {
    file: deploymentDeclarationPath(key),
    ...(hint ? { hint } : {}),
  })
}

/** The live workflow bound to `key`, by id, or `undefined`. */
async function workflowIdByKey(ctx: SourceContext, key: string): Promise<string | undefined> {
  const ids = await resolveIds(ctx.workspace.workspaceId, [{ kind: 'workflow', key }])
  return ids.get('workflow')?.get(key)
}

/** A canonical declaration's fields; the codec's canonical form is always an object. */
function fieldsOf(canonical: Json): Record<string, Json> {
  return canonical !== null && typeof canonical === 'object' && !Array.isArray(canonical)
    ? canonical
    : {}
}

/**
 * The top-level fields (`api`, `chat`) whose canonical values differ; every field when the stored
 * deployment cannot be read as a declaration.
 */
function changedFields(before: DeploymentDecl | null, after: DeploymentDecl): string[] {
  const now = fieldsOf(deploymentCodec.canonical(after))
  if (!before) return Object.keys(now)
  const was = fieldsOf(deploymentCodec.canonical(before))
  return Object.keys(now).filter(
    (field) => fingerprintOf(now[field]) !== fingerprintOf(was[field] ?? null)
  )
}

/**
 * Checks, before anything is written, what the chat needs: when the apply writes it, that no other
 * live chat holds its identifier and the password variable is set (a `stored()` password needs one
 * stored); and that each output names a
 * block of the draft the chat answers from. For a workflow this apply edits or creates, that is
 * the graph its plan evaluated (`editedBlocks`), so an output naming a block the edit removes
 * refuses the plan before anything goes live; otherwise it is the stored draft.
 */
async function checkChat(
  change: DeploymentChange,
  chat: ChatDecl,
  ctx: PlanContext,
  options: {
    workflowId?: string
    writesChat: boolean
    storedPassword: boolean
    draftEdited: boolean
    editedBlocks?: ReadonlyMap<string, string>
  }
): Promise<void> {
  const { key } = change
  const { auth } = chat
  if (
    options.writesChat &&
    (await isChatIdentifierHeldElsewhere(chat.identifier, options.workflowId))
  ) {
    change.diagnostics.push(
      deploymentFinding(
        key,
        'E_DEPLOY_CHAT_IDENTIFIER',
        `Another chat already serves at "${chat.identifier}".`,
        'Choose another chat identifier.'
      )
    )
  }
  if (options.writesChat && auth !== 'public' && 'password' in auth) {
    if (auth.password === 'stored') {
      if (!options.storedPassword) {
        change.diagnostics.push(
          deploymentFinding(
            key,
            'E_DEPLOY_SECRET',
            '`stored()` keeps a stored chat password, but this chat has none.',
            'Set the password from a secret: `auth: { password: env.NAME }`.'
          )
        )
      }
    } else {
      const value = await resolvePrincipalEnvironmentVariable(
        ctx.principal,
        ctx.workspace.workspaceId,
        auth.password.env
      )
      if (value === undefined) {
        change.diagnostics.push(
          deploymentFinding(
            key,
            'E_DEPLOY_SECRET',
            `The secret ${auth.password.env} is not set for this workspace or you.`,
            `Set it first: \`sim secrets set ${auth.password.env}\`.`
          )
        )
      }
    }
  }
  const outputs = chat.outputs ?? []
  if (outputs.length === 0) return
  let blocks: ReadonlySet<string>
  if (options.draftEdited) {
    // A workflow that did not evaluate has errors of its own, which refuse the plan.
    if (!options.editedBlocks) return
    blocks = new Set(options.editedBlocks.values())
  } else {
    if (!options.workflowId) return
    blocks = new Set((await readBlockNames(ctx, options.workflowId)).idOf.keys())
  }
  for (const output of outputs) {
    if (blocks.has(normalizeWorkflowBlockName(output.block))) continue
    change.diagnostics.push(
      deploymentFinding(
        key,
        'E_DEPLOY_CHAT_OUTPUT',
        `The chat output names block "${output.block}", which ${where('workflow', key)} does not have.`,
        'Name a block of the workflow by its name.'
      )
    )
  }
}

/**
 * Checks a chat this apply keeps unchanged against the graph an edit leaves: the chat stores its
 * outputs by block id, so an edit that deletes a block and adds one under the same name leaves
 * it answering from a block that no longer exists. Every output whose block is still there is
 * fine. One whose block is gone is re-created when exactly one block of the edited graph has its
 * name: counted, so the chat is written again, its outputs resolved to that block. When several share it, it refuses (`E_DEPLOY_CHAT_OUTPUT`). A kept chat
 * declares the names it stores, so one no block has is refused by {@link checkChat}'s name
 * check, which runs as well; both before anything goes live.
 */
function checkKeptOutputs(
  change: DeploymentChange,
  outputs: ReadonlyArray<{ blockId: string; block?: string }>,
  editedBlocks: ReadonlyMap<string, string>
): number {
  let recreated = 0
  for (const output of outputs) {
    if (editedBlocks.has(output.blockId) || output.block === undefined) continue
    const name = normalizeWorkflowBlockName(output.block)
    const matches = [...editedBlocks.values()].filter((block) => block === name).length
    if (matches === 1) {
      recreated += 1
      continue
    }
    if (matches === 0) continue
    change.diagnostics.push(
      deploymentFinding(
        change.key,
        'E_DEPLOY_CHAT_OUTPUT',
        `The chat answers from block "${output.block}", which this edit re-creates, and ${matches} blocks of ${where('workflow', change.key)} now share its name.`,
        'Give the chat output block a name no other block has.'
      )
    )
  }
  return recreated
}

/** Plans one declared deployment against the workflow under the same key. */
async function planDeployment(
  key: string,
  decl: DeploymentDecl,
  stored: StoredSet<StoredDeployment>,
  ctx: PlanContext
): Promise<DeploymentChange> {
  const change: DeploymentChange = {
    kind: 'deployment',
    key,
    action: 'noop',
    decl,
    refs: [{ kind: 'workflow', key }],
    diagnostics: [],
  }
  const workflowChange = ctx.planned.find(
    (planned) => planned.kind === 'workflow' && planned.key === key
  )
  const creating = workflowChange?.action === 'create'
  const deployed = stored.bound.get(key)
  const workflowId =
    deployed?.id ??
    workflowChange?.storedId ??
    (creating ? undefined : await workflowIdByKey(ctx, key))
  if (!workflowId && !creating) {
    change.diagnostics.push(
      deploymentFinding(
        key,
        'E_DEPLOY_WORKFLOW',
        `${deploymentDeclarationPath(key)} deploys workflow "${key}", which this workspace does not hold.`,
        `Name a workflow by its folder key (workflows/<key>/), or add ${where('workflow', key)}/.`
      )
    )
    return change
  }
  const draftEdited = workflowChange?.action === 'update' || creating
  const base = ctx.base?.resources[resourceAddress('deployment', key)]
  const basePasswordEnv = passwordEnvOf(base)
  const resolved = resolveDeclared({
    local: fingerprintOf(deploymentCodec.canonical(decl)),
    stored: deployed,
    base,
    fingerprint: (record, entry) => storedFingerprint(record.state, passwordEnvOf(entry)),
    holds: holdsIn(stored),
    parts: {
      local: partsOf(decl),
      base: basePartsOf(base),
      server: (record, entry) => storedParts(record.state, passwordEnvOf(entry)),
    },
  })
  const resolution =
    resolved.action === 'no-base' && startedFirstDeploy(decl, resolved.stored.state)
      ? { action: 'adopt' as const, stored: resolved.stored }
      : resolved
  const planned = settle(resolution, change, (record) =>
    baseEntry(record.id, record.state, basePasswordEnv)
  )
  // A no-op leaves the stored settings as they are, but the draft may still go live.
  if ('settled' in planned && resolution.action !== 'noop') return planned.settled

  const detail: DeploymentPlan = {
    ...(workflowId ? { workflowId } : {}),
    deploy: false,
    ...(basePasswordEnv ? { basePasswordEnv } : {}),
  }
  const state = deployed?.state
  let next: DeploymentChange
  if ('settled' in planned) {
    next = planned.settled
  } else if (planned.action === 'create') {
    detail.deploy = true
    // An undeploy keeps the workflow's public API flag, so a first deploy always writes it.
    detail.publicApi = decl.api?.public === true
    if (decl.chat) detail.chat = 'replace'
    next = {
      ...change,
      action: 'create',
      fields: ['deploy', ...(detail.publicApi ? ['api'] : []), ...(decl.chat ? ['chat'] : [])],
    }
  } else {
    const before = declOf(planned.stored.state, { live: decl.live, passwordEnv: basePasswordEnv })
    const fields = changedFields(before, decl)
    if (fields.includes('api')) detail.publicApi = decl.api?.public === true
    if (fields.includes('chat')) detail.chat = decl.chat ? 'replace' : 'delete'
    next = { ...change, action: 'update', storedId: planned.stored.id, fields }
  }
  if (state) {
    next.serverFingerprint = storedFingerprint(state, basePasswordEnv)
    const plannedOutputNames = Object.fromEntries(
      (state.chat?.outputs ?? []).flatMap((output) =>
        output.block === undefined ? [] : [[output.blockId, output.block]]
      )
    )
    if (Object.keys(plannedOutputNames).length > 0) detail.plannedOutputNames = plannedOutputNames
    const draftDiffers = state.needsRedeployment || draftEdited
    if (draftDiffers && decl.live === 'draft') {
      detail.deploy = true
      next.action = 'update'
      next.fields = ['live version', ...(next.fields ?? [])]
    } else if (draftDiffers) {
      next.diagnostics.push(
        deploymentFinding(
          key,
          'I_DEPLOY_DRAFT_NOT_LIVE',
          `${where('workflow', key)}'s draft differs from its live version, which keeps running: the deployment is pinned.`,
          "Set `live: 'draft'` to deploy the draft with this apply."
        )
      )
      if (detail.chat === 'replace') {
        next.diagnostics.push(
          deploymentFinding(
            key,
            'E_DEPLOY_PINNED_CHAT',
            'Writing the chat deploys the draft, which this pinned deployment keeps out of the live version.',
            "Set `live: 'draft'`, or leave the chat as it is until the draft should go live."
          )
        )
      }
    }
  }
  if (next.action === 'noop') return next
  if (
    state?.chat &&
    decl.chat &&
    detail.chat === undefined &&
    detail.deploy &&
    draftEdited &&
    workflowChange?.blocks
  ) {
    if (checkKeptOutputs(next, state.chat.outputs, workflowChange.blocks) > 0) {
      detail.chat = 'replace'
      next.fields = [...(next.fields ?? []), 'chat outputs']
    }
  }
  const writesChat = detail.chat === 'replace'
  // A chat the apply keeps goes live with the edited draft all the same.
  const publishesEditedDraft = detail.deploy && draftEdited
  if (decl.chat && (writesChat || publishesEditedDraft)) {
    await checkChat(next, decl.chat, ctx, {
      workflowId,
      writesChat,
      storedPassword: state?.chat?.hasPassword === true,
      draftEdited,
      ...(workflowChange?.blocks ? { editedBlocks: workflowChange.blocks } : {}),
    })
  }
  return { ...next, detail }
}

/** The deployment's idempotency key: its fingerprint, workflow and the live version it replaces. */
function idempotencyKey(change: DeploymentChange, workflowId: string, live: string | null) {
  const local = change.decl ? fingerprintOf(deploymentCodec.canonical(change.decl)) : null
  return `workspace-source:${sha256Hex(JSON.stringify([workflowId, local, live]))}`
}

/**
 * Deploys the draft unless it already is the live version: a re-run after a deploy that
 * succeeded finds nothing to publish, and one after a deploy that failed replays the same key.
 */
async function deployDraft(change: DeploymentChange, workflowId: string, ctx: ApplyContext) {
  const { principal } = ctx
  const status = await readWorkflowDeploymentStatus.execute({ principal, input: { workflowId } })
  if (status.isDeployed && !status.needsRedeployment) return
  await deployWorkflow.execute({
    principal,
    input: {
      workflowId,
      requestId: generateRequestId(),
      idempotencyKey: idempotencyKey(
        change,
        workflowId,
        status.activeDeployment?.deploymentVersionId ?? null
      ),
    },
  })
}

/** The block ids a chat's outputs name, refusing a block the workflow does not have. */
async function outputConfigs(
  ctx: ApplyContext,
  key: string,
  workflowId: string,
  chat: ChatDecl
): Promise<Array<{ blockId: string; path: string }>> {
  const outputs = chat.outputs ?? []
  if (outputs.length === 0) return []
  const { idOf } = await readBlockNames(ctx, workflowId)
  const missing = outputs.filter((output) => !idOf.has(normalizeWorkflowBlockName(output.block)))
  if (missing.length > 0) {
    throw new WorkspaceSourceRejectedError(
      missing.map((output) =>
        deploymentFinding(
          key,
          'E_DEPLOY_CHAT_OUTPUT',
          `The chat output names block "${output.block}", which ${where('workflow', key)} does not have.`
        )
      )
    )
  }
  return outputs.map((output) => ({
    blockId: idOf.get(normalizeWorkflowBlockName(output.block)) ?? '',
    path: output.path,
  }))
}

type ChatReplaceInput = Parameters<typeof replaceWorkflowChatDeployment.execute>[0]['input']

/**
 * The replace input for the declared chat: its password read from its variable and its outputs
 * resolved to block ids of the (already written) draft, with the replace's own predictable refusals
 * (identifier taken, auth mode denied) checked. Resolved before the deployment writes anything, so a
 * chat that cannot be written refuses while the flag and the live version are still the old ones.
 */
async function resolveChat(
  ctx: ApplyContext,
  key: string,
  workflowId: string,
  chat: ChatDecl
): Promise<ChatReplaceInput> {
  const { auth } = chat
  let password: string | undefined
  if (auth !== 'public' && 'password' in auth && auth.password !== 'stored') {
    password = await resolvePrincipalEnvironmentVariable(
      ctx.principal,
      ctx.workspace.workspaceId,
      auth.password.env
    )
    if (password === undefined) {
      throw new OrchestrationError(
        'validation',
        `The secret ${auth.password.env} is not set for this workspace or you.`
      )
    }
  }
  const authType =
    auth === 'public'
      ? 'public'
      : 'password' in auth
        ? 'password'
        : 'emails' in auth
          ? 'email'
          : 'sso'
  await assertChatReplaceAllowed(ctx.principal, {
    workspaceId: ctx.workspace.workspaceId,
    workflowId,
    identifier: chat.identifier,
    authType,
  })
  return {
    workflowId,
    identifier: chat.identifier,
    title: chat.title,
    ...(chat.description ? { description: chat.description } : {}),
    ...(chat.customizations ? { customizations: chat.customizations } : {}),
    authType,
    ...(password !== undefined ? { password } : {}),
    ...(auth !== 'public' && 'emails' in auth ? { allowedEmails: auth.emails } : {}),
    ...(auth !== 'public' && 'sso' in auth ? { allowedEmails: auth.sso } : {}),
    outputConfigs: await outputConfigs(ctx, key, workflowId, chat),
    includeThinking: chat.includeThinking === true,
    includeToolCalls: chat.includeToolCalls === true,
    requestId: generateRequestId(),
  }
}

type TriggerKind = Awaited<
  ReturnType<typeof listWorkflowTriggers.execute>
>['triggers'][number]['kind']

/** How an undeploy message names each kind of live trigger: one, then many (the count's key). */
const TRIGGER_NOUNS: Record<TriggerKind, readonly [one: string, many: string]> = {
  schedule: ['schedule', 'schedules'],
  webhook: ['webhook', 'webhooks'],
  polling: ['polling trigger', 'polling triggers'],
  event: ['event trigger', 'event triggers'],
}

/** What undeploying a workflow stops: its API, chat and live triggers, counted by kind. */
async function stopsOnUndeploy(
  ctx: SourceContext,
  workflowId: string,
  state: StoredDeployment
): Promise<Record<string, number>> {
  const { triggers } = await listWorkflowTriggers.execute({
    principal: ctx.principal,
    input: { workflowId },
  })
  const counts: Record<string, number> = { api: 1, ...(state.chat ? { chat: 1 } : {}) }
  for (const { kind } of triggers) {
    const [, many] = TRIGGER_NOUNS[kind]
    counts[many] = (counts[many] ?? 0) + 1
  }
  return counts
}

/** The single noun of a count key {@link stopsOnUndeploy} wrote in the plural. */
const ONE_TRIGGER: ReadonlyMap<string, string> = new Map(
  Object.values(TRIGGER_NOUNS).map(([one, many]) => [many, one])
)

function describeStops(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([what, count]) => {
      if (what === 'api' || what === 'chat') return `its ${what}`
      return `${count} ${count === 1 ? (ONE_TRIGGER.get(what) ?? what) : what}`
    })
    .join(', ')
}

type CursorKeys = Awaited<ReturnType<typeof listWorkflows.execute>>['nextCursorKeys']

/**
 * The workspace's deployed workflows, listed once per request: the kind's load and the plan's
 * check of edited deployed workflows both read it. It is the list as the plan saw it, so nothing
 * that runs after a write may read it.
 */
function listDeployedWorkflows(ctx: SourceContext) {
  ctx.listings.deployedWorkflows ??= listAllDeployedWorkflows(ctx)
  return ctx.listings.deployedWorkflows
}

function listAllDeployedWorkflows(ctx: SourceContext) {
  return listUpTo(async (cursorKeys: CursorKeys | undefined) => {
    const page = await listWorkflows.execute({
      principal: ctx.principal,
      input: {
        workspaceId: ctx.workspace.workspaceId,
        scope: 'active',
        deployedOnly: true,
        sortBy: 'createdAt',
        sortOrder: 'asc',
        limit: LIST_PAGE,
        ...(cursorKeys ? { cursorKeys } : {}),
      },
    })
    return { items: page.workflows, next: page.nextCursorKeys }
  })
}

export const deploymentAdapter: KindAdapter<DeploymentDecl, StoredDeployment, DeploymentPlan> = {
  codec: deploymentCodec,

  async load(ctx, { allocate }) {
    const workflows = await listDeployedWorkflows(ctx)
    const records = await mapWithConcurrency(workflows, READ_CONCURRENCY, async (workflow) => {
      const state = await readDeployment(ctx, workflow.id)
      return state ? [{ id: workflow.id, name: workflow.name, state }] : []
    })
    return bindStored(ctx, 'workflow', records.flat(), { allocate })
  },

  async plan(desired, stored, ctx) {
    const changes: DeploymentChange[] = []
    for (const [key, decl] of desired) changes.push(await planDeployment(key, decl, stored, ctx))
    const undeclared = planUndeclared<StoredDeployment, DeploymentDecl, DeploymentPlan>(
      'deployment',
      desired,
      stored,
      ctx,
      {
        fingerprint: (record, base) => storedFingerprint(record.state, passwordEnvOf(base)),
        detail: (record, base) => ({
          workflowId: record.id,
          deploy: false,
          ...(passwordEnvOf(base) ? { basePasswordEnv: passwordEnvOf(base) } : {}),
        }),
      }
    )
    // Undeploying stops the workflow's triggers: the plan says which, deleting or refusing to.
    for (const change of undeclared) {
      const record = change.storedId ? stored.bound.get(change.key) : undefined
      const refused = change.diagnostics.find(
        (finding) => finding.code === 'E_APPLY_DELETE_NOT_ALLOWED'
      )
      if (!record || (change.action !== 'delete' && !refused)) continue
      const counts = await stopsOnUndeploy(ctx, record.id, record.state)
      if (change.destructive) change.destructive = { what: 'deployment', counts }
      if (refused) {
        refused.message = `${deploymentDeclarationPath(change.key)} is removed; undeploying "${record.name}" stops ${describeStops(counts)}, and needs --allow-delete.`
      }
    }
    return [...changes, ...undeclared]
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workflowId = change.detail?.workflowId
    const requestId = generateRequestId()
    if (change.action === 'delete') {
      if (workflowId)
        await undeployWorkflow.authorize({ principal, input: { workflowId, requestId } })
      return
    }
    const detail = change.detail
    if (!detail) return
    if (!workflowId) {
      // A workflow this apply creates has no id yet: its deploy is held to the same operations
      // at workspace level now, and to the use cases themselves when it is written.
      await authorizeWorkspaceOperation(principal, workflowOperations.deploy, ctx.workspace)
      if (detail.chat) {
        await authorizeWorkspaceOperation(
          principal,
          chatDeploymentOperations.replace,
          ctx.workspace
        )
      }
      return
    }
    if (detail.deploy)
      await deployWorkflow.authorize({ principal, input: { workflowId, requestId } })
    if (detail.publicApi !== undefined) {
      await updateWorkflowPublicApi.authorize({
        principal,
        input: { workflowId, isPublicApi: detail.publicApi },
      })
    }
    if (detail.chat === 'replace' && change.decl?.chat) {
      await replaceWorkflowChatDeployment.authorize({
        principal,
        input: {
          workflowId,
          identifier: change.decl.chat.identifier,
          title: change.decl.chat.title,
          requestId,
        },
      })
    }
    if (detail.chat === 'delete') {
      await deleteWorkflowChatDeployment.authorize({ principal, input: { workflowId } })
    }
  },

  async fingerprintNow(change, ctx) {
    const workflowId = change.detail?.workflowId
    if (!workflowId) throw new Error('A deployment check needs the workflow id')
    const read = await readDeployment(ctx, workflowId)
    if (!read) return ''
    const planned = change.detail?.plannedOutputNames ?? {}
    const state: StoredDeployment = read.chat
      ? {
          ...read,
          chat: {
            ...read.chat,
            outputs: read.chat.outputs.map(({ blockId, path }) =>
              planned[blockId] === undefined
                ? { blockId, path }
                : { blockId, path, block: planned[blockId] }
            ),
          },
        }
      : read
    return storedFingerprint(state, change.detail?.basePasswordEnv)
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workflowId = change.detail?.workflowId ?? (await workflowIdByKey(ctx, change.key))
    if (!workflowId) throw new Error('A deployment write needs its workflow')
    if (change.action === 'delete') {
      await undeployWorkflow.execute({
        principal,
        input: { workflowId, requestId: generateRequestId() },
      })
      return { id: workflowId, text: {} }
    }
    const { decl, detail } = change
    if (!decl || !detail) throw new Error('A deployment write needs its declaration and plan')
    // Everything the chat needs is resolved and checked first: a chat that cannot be written
    // refuses before the flag or the deploy changes anything.
    const chatInput =
      detail.chat === 'replace' && decl.chat
        ? await resolveChat(ctx, change.key, workflowId, decl.chat)
        : undefined
    // The flag is written before the deploy, so the API never goes live under a stale one.
    if (detail.publicApi !== undefined) {
      await updateWorkflowPublicApi.execute({
        principal,
        input: { workflowId, isPublicApi: detail.publicApi },
      })
    }
    if (detail.deploy) await deployDraft(change, workflowId, ctx)
    if (chatInput) await replaceWorkflowChatDeployment.execute({ principal, input: chatInput })
    if (detail.chat === 'delete') {
      await deleteWorkflowChatDeployment.execute({ principal, input: { workflowId } })
    }
    const state = await readDeployment(ctx, workflowId)
    if (!state) throw new Error('A deployed workflow read back as not deployed')
    const passwordEnv =
      detail.chat === 'replace' ? declaredPasswordEnv(decl) : detail.basePasswordEnv
    const written = declOf(state, { live: decl.live, passwordEnv })
    return {
      id: workflowId,
      base: baseEntry(workflowId, state, passwordEnv),
      text: written ? deploymentCodec.print(change.key, written).text : {},
    }
  },

  async read(stored) {
    const { state } = stored
    // A draft that differs reads as pinned, so applying what a get wrote never publishes it.
    const decl = declOf(state, { live: state.needsRedeployment ? 'pinned' : 'draft' })
    if (!decl) {
      throw new OrchestrationError(
        'validation',
        'Its chat answers with a block the draft no longer has, which source cannot name.'
      )
    }
    return {
      text: deploymentCodec.print(stored.key, decl).text,
      blobs: [],
      base: baseEntry(stored.id, state, undefined),
    }
  },
}

/**
 * Warns on every workflow this apply edits that is deployed while no deployment file in the
 * directory decides what happens to its live version (`W_DEPLOYED_DRAFT_CHANGED`): the edit
 * changes the draft, and the triggers keep running the old one. Reads the deployed workflows only
 * when the plan edits one.
 */
export async function warnDeployedDraftChanges(
  changes: readonly PlannedChange[],
  ctx: SourceContext
): Promise<void> {
  const declared = new Set(
    changes
      .filter((change) => change.kind === 'deployment' && change.decl)
      .map((change) => change.key)
  )
  const edited = changes.filter(
    (change) =>
      change.kind === 'workflow' &&
      change.action === 'update' &&
      change.storedId !== undefined &&
      !declared.has(change.key)
  )
  if (edited.length === 0) return
  const deployedIds = new Set((await listDeployedWorkflows(ctx)).map((workflow) => workflow.id))
  for (const change of edited) {
    if (!change.storedId || !deployedIds.has(change.storedId)) continue
    change.diagnostics.push(
      kindFinding(
        'workflow',
        change.key,
        'W_DEPLOYED_DRAFT_CHANGED',
        `${where('workflow', change.key)} is deployed: this apply changes its draft, and the live version keeps running the old one.`,
        {
          hint: `Add ${deploymentDeclarationPath(change.key)} with \`live: 'draft'\` to deploy it with each apply, or deploy it: \`sim workflows deploy\`.`,
        }
      )
    )
  }
}
