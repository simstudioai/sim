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
 * when the draft differs. `'draft'` publishes only a draft the directory vouches for: the one this
 * apply's workflow write leaves, or one that still prints as the workflow folder's base (an edit
 * of the folder applied before without its deploy). A draft holding edits the directory does not
 * declare (made in the editor) is not published (`W_DEPLOY_DRAFT_NOT_SOURCE`), and the deploy
 * names the vouched draft's fingerprint, so one edited between the plan and the deploy is refused
 * rather than published. A deploy is keyed by the deployment's fingerprint and the version it
 * replaces, so a re-run after a failure replays the same deploy instead of publishing twice.
 *
 * The server keeps a chat password only encrypted, so the base records which variable the last
 * apply set it from (`x-passwordEnv`), and the stored chat reads as that `env.NAME` against it.
 * Publishing to an MCP server is not part of source.
 */
import { sha256Hex } from '@sim/security/hash'
import { mapWithConcurrency } from '@sim/utils/concurrency'
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
import { workflowFolder, workflowSourceBase } from '@sim/workspace-code/kinds/workflow'
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
import { generateRequestId } from '@/lib/core/utils/request'
import {
  deployWorkflow,
  readWorkflowDeploymentStatus,
  undeployWorkflow,
  WorkflowDraftChangedError,
} from '@/lib/workflows/application/deployments'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readDraftFingerprint } from '@/lib/workflows/application/read-workflow-source'
import { updateWorkflowPublicApi } from '@/lib/workflows/application/update-workflow-deployment-settings'
import {
  ResourceChangedError,
  WorkspaceSourceRejectedError,
} from '@/lib/workspace-source/application/errors'
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
  liveTriggerCounts,
  oneTrigger,
} from '@/lib/workspace-source/application/kinds/deployment/triggers'
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
  StoredResource,
  StoredSet,
} from '@/lib/workspace-source/application/types'
import { resolveIds } from '@/lib/workspaces/resource-keys'

/** Deployed workflows per page while listing them. */
const LIST_PAGE = 200

/** Deployments a plan or a get reads at once. */
const READ_CONCURRENCY = 4

/**
 * A listed deployed workflow's settings: `null` until read. A load lists deployed workflows only;
 * a plan reads the settings of those it needs ({@link readNeeded}) and a get those it prints.
 */
type ListedDeployment = StoredDeployment | null

/** The base entry field naming the variable a chat password was last set from. */
const PASSWORD_ENV = 'x-passwordEnv'

/**
 * The base entry field holding each part's fingerprint (`api`, `chat`): an apply writes the flag
 * and the chat through separate use cases, so one stopped between them leaves the server partway,
 * and a re-run tells that from a teammate's edit part by part.
 */
const PARTS = 'x-parts'

/** What an apply carries out for one deployment, decided at plan time. */
export interface DeploymentPlan {
  /** The workflow, when it exists at plan time (not one this apply creates). */
  workflowId?: string
  /** Publish the draft: a first deploy, or `live: 'draft'` with a draft that differs. */
  deploy: boolean
  /**
   * The draft a deploy, or a chat write that redeploys, may publish: the one this apply's workflow
   * write stores (`written`, its fingerprint known once written), or the draft with the `sf1:`
   * fingerprint the plan vouched for (for a chat write without a deploy, the draft it saw).
   */
  draft?: { written: true } | { fingerprint: string }
  /** The public API flag to set: on a first deploy (an undeploy keeps the old one), or a change. */
  publicApi?: boolean
  /** Whether the chat is written or removed. */
  chat?: 'replace' | 'delete'
  /** The variable the base recorded the stored chat password under (for `storedFingerprintNow`). */
  basePasswordEnv?: string
  /**
   * The stored chat's output block names at plan time, by the block id the chat stores. The
   * workflow writes first, and may rename or re-create those blocks, so `storedFingerprintNow`
   * reads each output by this name, as the plan did: the check compares the block ids the chat
   * stores, and an output re-pointed at another block since the plan still moves the fingerprint.
   */
  plannedOutputNames?: Record<string, string>
}

type DeploymentChange = PlannedChange<'deployment'>

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
 * name: counted, so the chat is written again, its outputs resolved to that block. When several
 * share it, it refuses (`E_DEPLOY_CHAT_OUTPUT`). A kept chat declares the names it stores, so one
 * no block has is refused by {@link checkChat}'s name check, which runs as well; both before
 * anything goes live.
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

/**
 * The draft of workflow `key` the directory vouches for, which a deploy may publish: the one this
 * apply's workflow write leaves (`draftEdited`); else the stored draft when it still prints as the
 * workflow folder's base, so it holds no edit the directory does not declare; else, with no folder
 * declared, the stored draft of a first deploy, which publishes no earlier version over anything.
 * `undefined` when the stored draft holds edits the directory does not declare. Reads the stored
 * draft only when no write vouches for it.
 */
async function vouchedDraft(
  ctx: PlanContext,
  options: {
    workflowId: string | undefined
    draftEdited: boolean
    folder: PlannedChange<'workflow'> | undefined
    firstDeploy: boolean
  }
): Promise<DeploymentPlan['draft']> {
  if (options.draftEdited) return { written: true }
  const { workflowId, folder } = options
  if (!workflowId) return undefined
  const base = folder?.decl ? workflowSourceBase(folder.decl) : null
  if (!base && (folder || !options.firstDeploy)) return undefined
  const fingerprint = await readDraftFingerprint.execute({
    principal: ctx.principal,
    input: { workflowId },
  })
  if (base && (base.workflowId !== workflowId || base.fingerprint !== fingerprint)) return undefined
  return { fingerprint }
}

/** `W_DEPLOY_DRAFT_NOT_SOURCE`: the draft of workflow `key` holds edits the directory does not. */
function draftNotSourceFinding(key: string, declared: boolean) {
  return deploymentFinding(
    key,
    'W_DEPLOY_DRAFT_NOT_SOURCE',
    declared
      ? `${where('workflow', key)}'s draft holds edits ${workflowFolder(key)}/ does not (made outside source), so this apply does not deploy it; the live version keeps running.`
      : `${where('workflow', key)}'s draft differs from its live version, and this directory does not declare the workflow, so this apply does not deploy it; the live version keeps running.`,
    declared
      ? `To deploy those edits, get them into the directory (\`sim workspaces source get\` into a fresh directory) and apply, or deploy from the editor. To drop them, edit ${workflowFolder(key)}/ and apply.`
      : `Add ${workflowFolder(key)}/ to deploy what it declares, or deploy from the editor.`
  )
}

/**
 * The deployment `next` of a workflow whose draft differs from its live version: `live: 'draft'`
 * deploys the draft the directory vouches for (`W_DEPLOY_DRAFT_NOT_SOURCE` when it vouches for
 * none, refusing a chat write that would deploy it), and `live: 'pinned'` keeps the live version
 * (refusing a chat write, which would deploy the draft).
 */
async function planLiveDraft(
  next: DeploymentChange,
  detail: DeploymentPlan,
  decl: DeploymentDecl,
  ctx: PlanContext,
  facts: {
    key: string
    workflowId: string | undefined
    draftEdited: boolean
    workflowChange: PlannedChange<'workflow'> | undefined
  }
): Promise<void> {
  const { key, workflowChange } = facts
  if (decl.live !== 'draft') {
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
    return
  }
  const draft = await vouchedDraft(ctx, {
    workflowId: facts.workflowId,
    draftEdited: facts.draftEdited,
    folder: workflowChange,
    firstDeploy: false,
  })
  if (draft) {
    detail.deploy = true
    detail.draft = draft
    next.action = 'update'
    next.fields = ['live version', ...(next.fields ?? [])]
    return
  }
  next.diagnostics.push(draftNotSourceFinding(key, workflowChange !== undefined))
  if (detail.chat === 'replace') {
    next.diagnostics.push(
      deploymentFinding(
        key,
        'E_DEPLOY_DRAFT_NOT_SOURCE_CHAT',
        'Writing the chat deploys the draft, which holds edits this directory does not declare.',
        `Get those edits into ${workflowFolder(key)}/ first, or leave the chat as it is.`
      )
    )
  }
}

/** Plans one declared deployment against the workflow under the same key. */
async function planDeployment(
  key: string,
  decl: DeploymentDecl,
  stored: StoredSet<ListedDeployment>,
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
    (planned): planned is PlannedChange<'workflow'> =>
      planned.kind === 'workflow' && planned.key === key
  )
  const creating = workflowChange?.action === 'create'
  const listed = stored.bound.get(key)
  const deployed = listed?.state ? { ...listed, state: listed.state } : undefined
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
    const draft = await vouchedDraft(ctx, {
      workflowId,
      draftEdited,
      folder: workflowChange,
      firstDeploy: true,
    })
    if (!draft) {
      change.diagnostics.push(draftNotSourceFinding(key, true))
      return change
    }
    detail.deploy = true
    detail.draft = draft
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
    next.storedFingerprint = storedFingerprint(state, basePasswordEnv)
    const plannedOutputNames = Object.fromEntries(
      (state.chat?.outputs ?? []).flatMap((output) =>
        output.block === undefined ? [] : [[output.blockId, output.block]]
      )
    )
    if (Object.keys(plannedOutputNames).length > 0) detail.plannedOutputNames = plannedOutputNames
    if (state.needsRedeployment || draftEdited) {
      await planLiveDraft(next, detail, decl, ctx, { key, workflowId, draftEdited, workflowChange })
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
  // A chat write redeploys a draft that differs from the live version: it may publish only the
  // draft the plan vouched for, or else the one it saw, never one edited since.
  if (writesChat && !detail.draft && workflowId) {
    detail.draft = {
      fingerprint: await readDraftFingerprint.execute({
        principal: ctx.principal,
        input: { workflowId },
      }),
    }
  }
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
function idempotencyKey(decl: DeploymentDecl, workflowId: string, live: string | null) {
  const local = fingerprintOf(deploymentCodec.canonical(decl))
  return `workspace-source:${sha256Hex(JSON.stringify([workflowId, local, live]))}`
}

/**
 * The `sf1:` fingerprint of the draft change `change` may publish on workflow `workflowId`, or
 * `undefined` when its plan vouched for none (a chat write on a workflow this apply creates).
 */
function expectedDraftOf(
  change: DeploymentChange,
  workflowId: string,
  ctx: ApplyContext
): string | undefined {
  const draft = change.detail?.draft
  return draft && 'written' in draft ? ctx.writtenDrafts.get(workflowId) : draft?.fingerprint
}

/** Runs a publish, refusing as stale a draft that moved since the plan vouched for it. */
async function publishing(change: DeploymentChange, publish: () => Promise<unknown>) {
  try {
    await publish()
  } catch (error) {
    if (!(error instanceof WorkflowDraftChangedError)) throw error
    throw new ResourceChangedError({ kind: 'workflow', key: change.key })
  }
}

/**
 * Deploys the draft unless it already is the live version: a re-run after a deploy that
 * succeeded finds nothing to publish, and one after a deploy that failed replays the same key.
 */
async function deployDraft(
  change: DeploymentChange,
  decl: DeploymentDecl,
  workflowId: string,
  ctx: ApplyContext
) {
  const { principal } = ctx
  const expectedDraftFingerprint = expectedDraftOf(change, workflowId, ctx)
  if (!expectedDraftFingerprint) throw new Error('A deploy needs the draft it publishes')
  const status = await readWorkflowDeploymentStatus.execute({ principal, input: { workflowId } })
  if (status.isDeployed && !status.needsRedeployment) return
  await publishing(change, () =>
    deployWorkflow.execute({
      principal,
      input: {
        workflowId,
        requestId: generateRequestId(),
        expectedDraftFingerprint,
        idempotencyKey: idempotencyKey(
          decl,
          workflowId,
          status.activeDeployment?.deploymentVersionId ?? null
        ),
      },
    })
  )
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

/** What undeploying a workflow stops: its API, chat and live triggers, counted by kind. */
async function stopsOnUndeploy(
  ctx: SourceContext,
  workflowId: string,
  state: StoredDeployment
): Promise<Record<string, number>> {
  return {
    api: 1,
    ...(state.chat ? { chat: 1 } : {}),
    ...(await liveTriggerCounts(ctx, workflowId)),
  }
}

function describeStops(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([what, count]) => {
      if (what === 'api' || what === 'chat') return `its ${what}`
      return `${count} ${count === 1 ? oneTrigger(what) : what}`
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

export const deploymentAdapter: KindAdapter<'deployment', ListedDeployment> = {
  codec: deploymentCodec,

  async load(ctx, { allocate }) {
    const workflows = await listDeployedWorkflows(ctx)
    const records = workflows.map(({ id, name }) => ({ id, name, state: null }))
    return bindStored<ListedDeployment>(ctx, 'workflow', records, { allocate })
  },

  async plan(desired, listed, ctx) {
    const stored = await readNeeded(listed, desired, ctx)
    const changes: DeploymentChange[] = []
    for (const [key, decl] of desired) changes.push(await planDeployment(key, decl, stored, ctx))
    const undeclared = planUndeclared('deployment', desired, stored, ctx, {
      fingerprint: (record, base) =>
        record.state ? storedFingerprint(record.state, passwordEnvOf(base)) : '',
      detail: (record, base) => ({
        workflowId: record.id,
        deploy: false,
        ...(passwordEnvOf(base) ? { basePasswordEnv: passwordEnvOf(base) } : {}),
      }),
    })
    // Undeploying stops the workflow's triggers: the plan says which, deleting or refusing to.
    for (const change of undeclared) {
      const record = change.storedId ? stored.bound.get(change.key) : undefined
      const refused = change.diagnostics.find(
        (finding) => finding.code === 'E_APPLY_DELETE_NOT_ALLOWED'
      )
      if (!record?.state || (change.action !== 'delete' && !refused)) continue
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

  async storedFingerprintNow(change, ctx) {
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
    if (detail.deploy) await deployDraft(change, decl, workflowId, ctx)
    if (chatInput) {
      const expectedDraftFingerprint = expectedDraftOf(change, workflowId, ctx)
      await publishing(change, () =>
        replaceWorkflowChatDeployment.execute({
          principal,
          input: {
            ...chatInput,
            ...(expectedDraftFingerprint ? { expectedDraftFingerprint } : {}),
          },
        })
      )
    }
    if (detail.chat === 'delete') {
      await deleteWorkflowChatDeployment.execute({ principal, input: { workflowId } })
    }
    const state = await readDeployment(ctx, workflowId)
    if (!state) throw new Error('A deployed workflow read back as not deployed')
    // A deleted chat has no password left for the base to record a variable for.
    const passwordEnv =
      detail.chat === 'replace'
        ? declaredPasswordEnv(decl)
        : detail.chat === 'delete'
          ? undefined
          : detail.basePasswordEnv
    const written = declOf(state, { live: decl.live, passwordEnv })
    return {
      id: workflowId,
      base: baseEntry(workflowId, state, passwordEnv),
      text: written ? deploymentCodec.print(change.key, written).text : {},
    }
  },

  read: readListed,

  async readMany(stored, ctx) {
    const reads = await mapWithConcurrency(stored, READ_CONCURRENCY, async (resource) => {
      const outcome = await readListed(resource, ctx).then(
        (read) => ({ read }),
        (error: unknown) => ({ error })
      )
      return [resource.key, outcome] as const
    })
    return new Map(reads)
  },
}

/**
 * The listed deployments a plan reads the settings of: those the directory declares and those the
 * base records, which a plan may update, adopt or undeploy. The rest stay unread (`null`): the plan
 * only says they are kept. A workflow undeployed since the listing drops out, as if never listed.
 */
async function readNeeded(
  listed: StoredSet<ListedDeployment>,
  desired: ReadonlyMap<string, unknown>,
  ctx: PlanContext
): Promise<StoredSet<ListedDeployment>> {
  const bound = await mapWithConcurrency(
    [...listed.bound],
    READ_CONCURRENCY,
    async ([key, record]) => {
      const recorded = ctx.base?.resources[resourceAddress('deployment', key)]?.id === record.id
      if (!desired.has(key) && !recorded) return [[key, record] as const]
      const state = await readDeployment(ctx, record.id)
      return state ? [[key, { ...record, state }] as const] : []
    }
  )
  return { bound: new Map(bound.flat()), unbound: listed.unbound }
}

/** A listed deployment as source, its settings read now. */
async function readListed(stored: StoredResource<ListedDeployment>, ctx: SourceContext) {
  const state = await readDeployment(ctx, stored.id)
  if (!state) throw new OrchestrationError('not_found', 'The workflow is no longer deployed.')
  // A draft that differs reads as pinned, so applying what a get wrote never publishes it.
  const decl = declOf(state, { live: state.needsRedeployment ? 'pinned' : 'draft' })
  if (!decl) {
    throw new OrchestrationError(
      'validation',
      state.chat?.authType === null
        ? 'Its chat gates access in a way source cannot name (public, password, emails or SSO).'
        : 'Its chat answers with a block the draft no longer has, which source cannot name.'
    )
  }
  return {
    text: deploymentCodec.print(stored.key, decl).text,
    blobs: [],
    base: baseEntry(stored.id, state, undefined),
  }
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
