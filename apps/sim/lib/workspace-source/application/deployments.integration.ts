import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  chat,
  user,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowSchedule,
  workspaceEnvironment,
} from '@sim/db/schema'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import type { WorkspaceBaseV1, WorkspaceKind } from '@sim/workspace-code'
import { unchangedFiles } from '@sim/workspace-code/kinds/workflow'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { replaceWorkflowChatDeployment } from '@/lib/chat-deployments/application/workflow-chat-deployment'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { encryptSecret } from '@/lib/core/security/encryption'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import {
  deployWorkflow,
  readWorkflowDeploymentStatus,
} from '@/lib/workflows/application/deployments'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { listWorkflowTriggers } from '@/lib/workflows/application/triggers'
import { updateWorkflowPublicApi } from '@/lib/workflows/application/update-workflow-deployment-settings'
import { deploymentAdapter } from '@/lib/workspace-source/application/kinds/deployment/adapter'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'
import {
  codes,
  refusal,
  type SourceSubmission,
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'

const ownerId = generateId()
const writerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const writer = createSessionPrincipal({ userId: writerId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_DEPLOYMENTS_REPORT_PATH',
  'workspace-source-deployments.json'
)
const workspaces = sourceWorkspaces()
const runner = sourceRunner(['workflow', 'deployment'], owner)

const WORKFLOW = 'workflows/nightly/workflow.ts'
const DEPLOYMENT = 'deployments/nightly.ts'

const NIGHTLY = `// @sim-sdk 1
import { agent, t, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Nightly', {}, () => {
  const start = trigger.start('Start', { inputFormat: { question: 'string' } })
  const nightly = trigger.schedule('Every Night', {
    scheduleType: 'daily',
    dailyTime: '02:00',
    timezone: 'UTC',
  })
  const answer = agent('Answer', {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: t\`Question: \${start.question}\` }],
  })

  start.to(answer)
  nightly.to(answer)
})
`

/** The nightly workflow with its Answer agent replaced by a function block of the same name. */
const RETYPED = NIGHTLY.replace(
  "import { agent, t, trigger, workflow } from '@sim/workflow-sdk'",
  "import { fn, trigger, workflow } from '@sim/workflow-sdk'"
).replace(
  /const answer = agent\('Answer', \{[\s\S]*?\n {2}\}\)\n/,
  "const answer = fn('Answer', { code: 'return 1' })\n"
)

function deployment(body: string, imports = 'defineDeployment'): string {
  return `// @sim-sdk 1\nimport { ${imports} } from '@sim/workflow-sdk/workspace'\n\nexport default defineDeployment(${body})\n`
}

const DRAFT = deployment("{ live: 'draft' }")
const PINNED = deployment("{ live: 'pinned' }")

function withChat(chatBody: string, live = 'draft', imports = 'defineDeployment'): string {
  return deployment(`{ live: '${live}', chat: ${chatBody} }`, imports)
}

const PASSWORD_CHAT = withChat(
  "{ identifier: 'nightly-chat', title: 'Nightly', auth: { password: env.CHAT_PW }, outputs: [{ block: 'Answer', path: 'content' }] }",
  'draft',
  'defineDeployment, env'
)

type Files = Record<string, string>

/** A chat answering from the Answer block. */
function answerChat(identifier: string): string {
  return withChat(
    `{ identifier: '${identifier}', title: 'Answers', auth: 'public', outputs: [{ block: 'Answer', path: 'content' }] }`
  )
}

/** The Answer agent renamed Responder (its variable kept, so it keeps its id) and its chat with it. */
function renamedAnswer(files: Files): Files {
  return {
    ...files,
    [WORKFLOW]: files[WORKFLOW].replace("agent('Answer'", "agent('Responder'"),
    [DEPLOYMENT]: files[DEPLOYMENT].replace("block: 'Answer'", "block: 'Responder'"),
  }
}

const LEADS_TABLE = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'leads',
  columns: {
    email: column.string(),
  },
})
`

const INGEST_LEADS = `// @sim-sdk 1
import { table, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Ingest', {}, () => {
  const start = trigger.start('Start', { inputFormat: { email: 'string' } })
  const save = table.insertRow('Save Lead', {
    tableId: table('leads'),
    data: { email: start.email },
  })

  start.to(save)
})
`

const INGEST_NOTHING = `// @sim-sdk 1
import { trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Ingest', {}, () => {
  trigger.start('Start', { inputFormat: { email: 'string' } })
})
`

/** A get of `kinds` of the workspace. */
function getAll(workspaceId: string, kinds: WorkspaceKind[]) {
  return withPermissionGroupScope(() =>
    readWorkspaceSource.execute({ principal: owner, input: { workspaceId, kinds } })
  )
}

function apply(
  workspaceId: string,
  files: Files,
  options: Omit<SourceSubmission, 'files'> & { base?: WorkspaceBaseV1 } = {}
) {
  return runner.apply(workspaceId, { files, ...options })
}

/** The deployment findings of one severity; the workflow's own lint warnings are left out. */
function deploymentCodes(
  diagnostics: ReadonlyArray<{ code: string; severity: string }>,
  severity: string
): string[] {
  return codes(diagnostics, severity).filter((code) => code.includes('DEPLOY'))
}

function actions(plan: ReadonlyArray<{ kind: string; key: string; action: string }>) {
  return plan.map(({ kind, key, action }) => `${action} ${kind}:${key}`)
}

/** The workspace's single workflow id. */
async function workflowId(workspaceId: string): Promise<string> {
  const [row] = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(eq(workflow.workspaceId, workspaceId))
  if (!row) throw new Error('No workflow')
  return row.id
}

async function deployState(id: string) {
  const [row] = await db
    .select({ isDeployed: workflow.isDeployed, isPublicApi: workflow.isPublicApi })
    .from(workflow)
    .where(eq(workflow.id, id))
  const versions = await db
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(eq(workflowDeploymentVersion.workflowId, id))
  const schedules = await db
    .select({ id: workflowSchedule.id })
    .from(workflowSchedule)
    .where(and(eq(workflowSchedule.workflowId, id), isNull(workflowSchedule.archivedAt)))
  const chats = await db
    .select()
    .from(chat)
    .where(and(eq(chat.workflowId, id), isNull(chat.archivedAt)))
  return { ...row, versions: versions.length, schedules: schedules.length, chat: chats[0] }
}

/** The id of the draft's block named Answer. */
async function answerBlockId(id: string): Promise<string> {
  const [row] = await db
    .select({ id: workflowBlocks.id })
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.workflowId, id), eq(workflowBlocks.name, 'Answer')))
  if (!row) throw new Error('No Answer block')
  return row.id
}

/** A workspace with the nightly workflow created and deployed from source; its files and base. */
async function deployedWorkspace(deploymentFile = DRAFT) {
  const workspaceId = await workspaces.create({
    name: 'Workspace source deployments',
    ownerId,
    members: [{ userId: writerId, permission: 'write' }],
  })
  const created = await apply(workspaceId, { [WORKFLOW]: NIGHTLY, [DEPLOYMENT]: deploymentFile })
  expect(created.failed).toBeUndefined()
  return {
    workspaceId,
    id: await workflowId(workspaceId),
    files: { ...created.files, [DEPLOYMENT]: created.files[DEPLOYMENT] ?? deploymentFile },
    base: created.base,
  }
}

/** A public chat at `identifier` on workflow `id`, as a teammate adds one outside source. */
async function serveChat(id: string, identifier: string) {
  await replaceWorkflowChatDeployment.execute({
    principal: owner,
    input: {
      workflowId: id,
      identifier,
      title: 'Theirs',
      authType: 'public',
      requestId: generateId(),
    },
  })
}

/**
 * Edits the Answer agent's prompt in the stored draft directly, as the editor's realtime save
 * does: no source apply sees it.
 */
async function editDraftOutOfBand(id: string, text: string) {
  const [row] = await db
    .select({ id: workflowBlocks.id, subBlocks: workflowBlocks.subBlocks })
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.workflowId, id), eq(workflowBlocks.name, 'Answer')))
  if (!row) throw new Error('No Answer block')
  const stored = JSON.stringify(row.subBlocks)
  const subBlocks = JSON.parse(stored.replace(/(Question|Asked): /, text))
  if (JSON.stringify(subBlocks) === stored) throw new Error('The edit changed nothing')
  await db.update(workflowBlocks).set({ subBlocks }).where(eq(workflowBlocks.id, row.id))
}

/** The `sf1:` fingerprint a source read of workflow `id` reports now. */
async function draftFingerprint(id: string): Promise<string> {
  const read = await readWorkflowSource.execute({ principal: owner, input: { workflowId: id } })
  return read.base.fingerprint
}

/** `files` as the CLI sends them: the workflow folder, unchanged since the last write, as its base alone. */
function asSent(files: Files, workspaceId: string): Files {
  const folder = Object.fromEntries(
    Object.entries(files).filter(([path]) => path.startsWith('workflows/nightly/'))
  )
  const rest = Object.fromEntries(
    Object.entries(files).filter(([path]) => !path.startsWith('workflows/nightly/'))
  )
  return { ...rest, ...unchangedFiles('nightly', folder, workspaceId) }
}

function edited(files: Files): Files {
  return { ...files, [WORKFLOW]: files[WORKFLOW].replace('Question: ', 'Asked: ') }
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values(
    [ownerId, writerId].map((id) => ({
      id,
      name: 'Workspace source deployments fixture',
      email: `${id}@workspace-source-deployments.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
})

afterAll(async () => {
  await writeReport()
  await workspaces.cleanup()
  await db.delete(user).where(inArray(user.id, [ownerId, writerId]))
})

describe('workspace source: deployments', () => {
  check('deploys a workflow it creates, registering its schedule as a deploy does', async () => {
    const workspaceId = await workspaces.create({ name: 'Deploy from source', ownerId })
    const files = { [WORKFLOW]: NIGHTLY, [DEPLOYMENT]: DRAFT }

    const dryRun = await apply(workspaceId, files, { dryRun: true })
    expect(codes(dryRun.diagnostics)).toEqual([])
    expect(actions(dryRun.plan)).toEqual(['create workflow:nightly', 'create deployment:nightly'])

    const result = await apply(workspaceId, files)
    expect(result.failed).toBeUndefined()
    expect(actions(result.applied)).toEqual([
      'create workflow:nightly',
      'create deployment:nightly',
    ])
    const state = await deployState(await workflowId(workspaceId))
    expect(state).toMatchObject({ isDeployed: true, isPublicApi: false, versions: 1, schedules: 1 })
    expect(result.files[DEPLOYMENT]).toContain("live: 'draft'")
    expect(result.base.resources['deployment:nightly']?.id).toBe(await workflowId(workspaceId))
  })

  check(
    'plans a redeploy of a draft the directory vouches for without recording a source read',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Plan vouches quietly', ownerId })
      const created = await apply(workspaceId, { [WORKFLOW]: NIGHTLY, [DEPLOYMENT]: DRAFT })
      expect(created.failed).toBeUndefined()
      const { [DEPLOYMENT]: _deployment, ...workflowFiles } = created.files
      const edited = await apply(
        workspaceId,
        { ...workflowFiles, [WORKFLOW]: created.files[WORKFLOW].replace("'02:00'", "'03:00'") },
        { kinds: ['workflow'], base: created.base }
      )
      expect(edited.failed).toBeUndefined()
      const read = await getAll(workspaceId, ['workflow', 'deployment'])
      posthogServerMockFns.mockCaptureServerEvent.mockClear()

      const plan = await apply(
        workspaceId,
        { ...read.files, [DEPLOYMENT]: DRAFT },
        {
          base: read.base,
          dryRun: true,
          principal: createPersonalApiKeyPrincipal({ userId: ownerId, keyId: generateId() }),
        }
      )

      expect(actions(plan.plan)).toContain('update deployment:nightly')
      expect(
        posthogServerMockFns.mockCaptureServerEvent.mock.calls.map(([, event]) => event)
      ).not.toContain('workflow_source_read')
    }
  )

  check(
    'a get prints a deployment for each deployed workflow and applies back as a no-op',
    async () => {
      const { workspaceId, id } = await deployedWorkspace()
      const undeployed = await apply(workspaceId, {
        'workflows/draft-only/workflow.ts': NIGHTLY.replace("'Nightly', {}", "'Draft Only', {}"),
      })
      expect(undeployed.failed).toBeUndefined()

      const read = await runner.get(workspaceId)
      expect(Object.keys(read.files).filter((path) => path.startsWith('deployments/'))).toEqual([
        DEPLOYMENT,
      ])
      const again = await apply(workspaceId, read.files, { base: read.base })
      expect(actions(again.plan)).toContain('noop deployment:nightly')
      expect(again.applied).toEqual([])
      expect((await deployState(id)).versions).toBe(1)
      expect((await runner.get(workspaceId)).files).toEqual(read.files)
    }
  )

  check(
    'an edit under live: draft redeploys once, and a re-run publishes nothing more',
    async () => {
      const { workspaceId, id, files, base } = await deployedWorkspace()

      const result = await apply(workspaceId, edited(files), { base })
      expect(result.failed).toBeUndefined()
      expect(actions(result.applied)).toEqual([
        'update workflow:nightly',
        'update deployment:nightly',
      ])
      expect(result.plan.find((change) => change.kind === 'deployment')?.fields).toContain(
        'live version'
      )
      expect(deploymentCodes(result.diagnostics, 'warning')).toEqual([])
      expect((await deployState(id)).versions).toBe(2)

      const rerun = await apply(
        workspaceId,
        { ...edited(files), ...result.files },
        { base: result.base }
      )
      expect(rerun.applied).toEqual([])
      expect((await deployState(id)).versions).toBe(2)
    }
  )

  check('a pinned deployment never redeploys and says the draft is not live', async () => {
    const { workspaceId, id, files, base } = await deployedWorkspace(PINNED)

    const result = await apply(workspaceId, edited(files), { base })
    expect(result.failed).toBeUndefined()
    expect(actions(result.applied)).toEqual(['update workflow:nightly'])
    expect(codes(result.diagnostics, 'info')).toContain('I_DEPLOY_DRAFT_NOT_LIVE')
    expect(deploymentCodes(result.diagnostics, 'warning')).toEqual([])
    expect((await deployState(id)).versions).toBe(1)

    const chatOnPinned = await refusal(
      apply(
        workspaceId,
        {
          ...result.files,
          [DEPLOYMENT]: withChat(
            "{ identifier: 'pinned-chat', title: 'P', auth: 'public' }",
            'pinned'
          ),
        },
        { base: result.base }
      )
    )
    expect(codes(chatOnPinned.diagnostics)).toEqual(['E_DEPLOY_PINNED_CHAT'])
    expect((await deployState(id)).chat).toBeUndefined()
  })

  check('creates, updates and removes a chat, its password set from a secret', async () => {
    const { workspaceId, id, files, base } = await deployedWorkspace()

    const literal = await refusal(
      apply(
        workspaceId,
        {
          ...files,
          [DEPLOYMENT]: withChat(
            "{ identifier: 'nightly-chat', title: 'N', auth: { password: 'hunter22' } }"
          ),
        },
        { base }
      )
    )
    expect(codes(literal.diagnostics)).toEqual(['E_DEPLOY_SECRET'])
    const unset = await refusal(
      apply(workspaceId, { ...files, [DEPLOYMENT]: PASSWORD_CHAT }, { base })
    )
    expect(codes(unset.diagnostics)).toEqual(['E_DEPLOY_SECRET'])

    await db.insert(workspaceEnvironment).values({
      id: generateId(),
      workspaceId,
      variables: { CHAT_PW: (await encryptSecret('correct horse battery')).encrypted },
    })
    const created = await apply(workspaceId, { ...files, [DEPLOYMENT]: PASSWORD_CHAT }, { base })
    expect(created.failed).toBeUndefined()
    expect(actions(created.applied)).toEqual(['update deployment:nightly'])
    const stored = (await deployState(id)).chat
    expect(stored).toMatchObject({ identifier: 'nightly-chat', authType: 'password' })
    expect(stored?.password).toBeTruthy()
    expect(stored?.password).not.toContain('correct horse')
    expect(stored?.outputConfigs).toEqual([{ blockId: expect.any(String), path: 'content' }])
    expect(created.files[DEPLOYMENT]).toContain('password: env.CHAT_PW')
    expect(created.files[DEPLOYMENT]).toContain("block: 'Answer'")

    const rerun = await apply(workspaceId, { ...files, ...created.files }, { base: created.base })
    expect(rerun.applied).toEqual([])
    expect((await deployState(id)).chat?.updatedAt).toEqual(stored?.updatedAt)

    const renamed = await apply(
      workspaceId,
      {
        ...files,
        [DEPLOYMENT]: created.files[DEPLOYMENT].replace("title: 'Nightly'", "title: 'Night'"),
      },
      { base: created.base }
    )
    expect(renamed.plan.find((change) => change.kind === 'deployment')?.fields).toEqual(['chat'])
    // A chat write sets the password from its variable again.
    expect((await deployState(id)).chat).toMatchObject({ title: 'Night', authType: 'password' })

    const removed = await apply(
      workspaceId,
      { ...files, [DEPLOYMENT]: DRAFT },
      { base: renamed.base }
    )
    expect(removed.failed).toBeUndefined()
    expect(renamed.base.resources['deployment:nightly']).toHaveProperty('x-passwordEnv', 'CHAT_PW')
    expect(removed.base.resources['deployment:nightly']).not.toHaveProperty('x-passwordEnv')
    expect((await deployState(id)).chat).toBeUndefined()
    expect((await deployState(id)).isDeployed).toBe(true)
  })

  check(
    'a chat stored with an auth type source cannot name is left out of a get and never rewritten as public',
    async () => {
      const { workspaceId, id, files, base } = await deployedWorkspace()
      const created = await apply(
        workspaceId,
        { ...files, [DEPLOYMENT]: answerChat('gated-chat') },
        { base }
      )
      expect(created.failed).toBeUndefined()
      await db.update(chat).set({ authType: 'magic-link' }).where(eq(chat.workflowId, id))

      const read = await runner.get(workspaceId)
      expect(read.files[DEPLOYMENT]).toBeUndefined()
      expect(read.skipped).toContainEqual(
        expect.objectContaining({ kind: 'deployment', key: 'nightly' })
      )

      const retitled = await refusal(
        apply(
          workspaceId,
          {
            ...files,
            ...created.files,
            [DEPLOYMENT]: created.files[DEPLOYMENT].replace("title: 'Answers'", "title: 'Asked'"),
          },
          { base: created.base }
        )
      )
      expect(codes(retitled.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect((await deployState(id)).chat).toMatchObject({
        title: 'Answers',
        authType: 'magic-link',
      })
    }
  )

  check(
    'refuses at plan time a chat output naming a block the edit removes, deploying nothing',
    async () => {
      const answering = withChat(
        "{ identifier: 'answer-chat', title: 'Answers', auth: 'public', outputs: [{ block: 'Answer', path: 'content' }] }"
      )
      const deployed = await deployedWorkspace(answering)
      const { workspaceId, id, base } = deployed
      const files: Files = deployed.files
      const before = await deployState(id)
      expect(before).toMatchObject({ versions: 1, chat: { identifier: 'answer-chat' } })
      const renamed = {
        ...files,
        [WORKFLOW]: files[WORKFLOW].replace("agent('Answer'", "agent('Responder'"),
      }
      expect(renamed[WORKFLOW]).not.toEqual(files[WORKFLOW])

      // The chat kept as it is would go live with the edited draft; the chat rewritten would too.
      const kept = await refusal(apply(workspaceId, renamed, { base, allowDelete: true }))
      expect(deploymentCodes(kept.diagnostics, 'error')).toEqual(['E_DEPLOY_CHAT_OUTPUT'])
      const rewritten = await refusal(
        apply(
          workspaceId,
          {
            ...renamed,
            [DEPLOYMENT]: files[DEPLOYMENT].replace("title: 'Answers'", "title: 'Replies'"),
          },
          { base, allowDelete: true }
        )
      )
      expect(deploymentCodes(rewritten.diagnostics, 'error')).toEqual(['E_DEPLOY_CHAT_OUTPUT'])

      const after = await deployState(id)
      expect(after.versions).toBe(1)
      expect(after.chat).toMatchObject({
        title: 'Answers',
        outputConfigs: before.chat?.outputConfigs,
      })
    }
  )

  check(
    'rewrites a kept chat whose output block the edit re-creates under a new id, before it goes live',
    async () => {
      const answering = withChat(
        "{ identifier: 'recreated-chat', title: 'Answers', auth: 'public', outputs: [{ block: 'Answer', path: 'content' }] }"
      )
      const deployed = await deployedWorkspace(answering)
      const { workspaceId, id, base } = deployed
      const files: Files = deployed.files
      const before = await deployState(id)
      const [oldOutput] = toArray(before.chat?.outputConfigs)
      expect(await answerBlockId(id)).toEqual(toRecord(oldOutput).blockId)

      // An agent retyped as a function under the same name is deleted and re-created: a new id.
      expect(RETYPED).toContain("fn('Answer'")
      const recreated = { ...files, [WORKFLOW]: RETYPED }

      const dryRun = await apply(workspaceId, recreated, { base, allowDelete: true, dryRun: true })
      expect(deploymentCodes(dryRun.diagnostics, 'error')).toEqual([])
      expect(dryRun.plan.find((change) => change.kind === 'deployment')?.fields).toContain(
        'chat outputs'
      )

      const result = await apply(workspaceId, recreated, { base, allowDelete: true })
      expect(result.failed).toBeUndefined()
      const newId = await answerBlockId(id)
      expect(newId).not.toEqual(toRecord(oldOutput).blockId)
      const after = await deployState(id)
      expect(after.versions).toBe(2)
      expect(after.chat?.outputConfigs).toEqual([{ blockId: newId, path: 'content' }])
    }
  )

  check(
    'renames a chat output block and the chat naming it in one apply, keeping the block id',
    async () => {
      const deployed = await deployedWorkspace(answerChat('renamed-chat'))
      const { workspaceId, id, base } = deployed
      const answerId = await answerBlockId(id)

      const result = await apply(workspaceId, renamedAnswer(deployed.files), { base })
      expect(result.failed).toBeUndefined()
      const [renamedBlock] = await db
        .select({ name: workflowBlocks.name })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.id, answerId))
      expect(renamedBlock?.name).toBe('Responder')
      const after = await deployState(id)
      expect(after.versions).toBe(2)
      expect(after.chat?.outputConfigs).toEqual([{ blockId: answerId, path: 'content' }])
      expect(result.files[DEPLOYMENT]).toContain("block: 'Responder'")
    }
  )

  check('a rename apply still refuses a chat the server re-pointed after the plan', async () => {
    const deployed = await deployedWorkspace(answerChat('repointed-chat'))
    const { workspaceId, id, base } = deployed
    const [start] = await db
      .select({ id: workflowBlocks.id })
      .from(workflowBlocks)
      .where(and(eq(workflowBlocks.workflowId, id), eq(workflowBlocks.name, 'Start')))
    if (!start) throw new Error('No Start block')
    const check = deploymentAdapter.storedFingerprintNow
    if (!check) throw new Error('The deployment adapter checks fingerprints before writing')
    // A teammate points the chat at another block between the plan and the pre-write check.
    const moved = vi
      .spyOn(deploymentAdapter, 'storedFingerprintNow')
      .mockImplementation(async (change, ctx) => {
        await db
          .update(chat)
          .set({ outputConfigs: [{ blockId: start.id, path: 'input' }] })
          .where(eq(chat.workflowId, id))
        return check.call(deploymentAdapter, change, ctx)
      })
    try {
      const result = await apply(workspaceId, renamedAnswer(deployed.files), { base })
      expect(moved).toHaveBeenCalledOnce()
      expect([result.failed?.key, result.failed?.code]).toEqual(['nightly', 'E_APPLY_STALE'])
    } finally {
      moved.mockRestore()
    }
    const after = await deployState(id)
    expect(after.versions).toBe(1)
    expect(after.chat?.outputConfigs).toEqual([{ blockId: start.id, path: 'input' }])
  })

  check(
    'a chat rewrite with a stored() password keeps that password, on the re-created-output path and a plain edit',
    async () => {
      const guardedChat = (identifier: string) =>
        withChat(
          `{ identifier: '${identifier}', title: 'Guarded', auth: { password: env.CHAT_PW }, outputs: [{ block: 'Answer', path: 'content' }] }`,
          'draft',
          'defineDeployment, env'
        )
      /** A deployed workflow whose password chat a get prints as `stored()`, with that get. */
      const storedPasswordWorkspace = async (identifier: string) => {
        const workspaceId = await workspaces.create({ name: 'Stored chat password', ownerId })
        await db.insert(workspaceEnvironment).values({
          id: generateId(),
          workspaceId,
          variables: { CHAT_PW: (await encryptSecret('correct horse battery')).encrypted },
        })
        const created = await apply(workspaceId, {
          [WORKFLOW]: NIGHTLY,
          [DEPLOYMENT]: guardedChat(identifier),
        })
        expect(created.failed).toBeUndefined()
        const id = await workflowId(workspaceId)
        const read = await runner.get(workspaceId)
        const files: Files = read.files
        expect(files[DEPLOYMENT]).toContain('password: stored()')
        const before = (await deployState(id)).chat
        expect(before).toMatchObject({ authType: 'password', identifier })
        expect(before?.password).toBeTruthy()
        return { workspaceId, id, files, base: read.base, before }
      }

      // The rewrite a re-created output block forces.
      const recreated = await storedPasswordWorkspace('stored-recreated-chat')
      const rewritten = await apply(
        recreated.workspaceId,
        { ...recreated.files, [WORKFLOW]: RETYPED },
        { base: recreated.base, allowDelete: true }
      )
      expect(rewritten.failed).toBeUndefined()
      expect(rewritten.plan.find((change) => change.kind === 'deployment')?.fields).toContain(
        'chat outputs'
      )
      const afterRecreate = (await deployState(recreated.id)).chat
      expect(afterRecreate?.outputConfigs).toEqual([
        { blockId: await answerBlockId(recreated.id), path: 'content' },
      ])
      expect(afterRecreate).toMatchObject({
        authType: 'password',
        password: recreated.before?.password,
      })

      // A plain chat edit that writes the chat again.
      const plain = await storedPasswordWorkspace('stored-plain-chat')
      const retitled = await apply(
        plain.workspaceId,
        {
          ...plain.files,
          [DEPLOYMENT]: plain.files[DEPLOYMENT].replace("title: 'Guarded'", "title: 'Kept'"),
        },
        { base: plain.base }
      )
      expect(retitled.failed).toBeUndefined()
      expect(retitled.plan.find((change) => change.kind === 'deployment')?.fields).toEqual(['chat'])
      expect((await deployState(plain.id)).chat).toMatchObject({
        title: 'Kept',
        authType: 'password',
        password: plain.before?.password,
      })
    }
  )

  check('undeploying needs --allow-delete, and the plan says what stops', async () => {
    const { workspaceId, id, files, base } = await deployedWorkspace()
    const { [DEPLOYMENT]: _removed, ...withoutDeployment } = files

    const gated = await refusal(apply(workspaceId, withoutDeployment, { base }))
    expect(codes(gated.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
    expect(
      gated.diagnostics.find((finding) => finding.code === 'E_APPLY_DELETE_NOT_ALLOWED')?.message
    ).toContain('1 schedule,')
    expect((await deployState(id)).isDeployed).toBe(true)

    const result = await apply(workspaceId, withoutDeployment, { base, allowDelete: true })
    expect(result.failed).toBeUndefined()
    const undeploy = result.applied.find((change) => change.kind === 'deployment')
    expect(undeploy).toMatchObject({
      action: 'delete',
      destructive: { what: 'deployment', counts: { api: 1, schedules: 1 } },
    })
    expect(await deployState(id)).toMatchObject({ isDeployed: false, schedules: 0 })
    expect(result.base.resources['deployment:nightly']).toBeUndefined()
  })

  check(
    'deleting a deployed workflow counts the live triggers that go with it, so the plan says its schedule and webhook URLs end',
    async () => {
      const { workspaceId, files, base } = await deployedWorkspace()
      const kept = NIGHTLY.replace("workflow('Nightly'", "workflow('Kept'")
      const withKept = await apply(
        workspaceId,
        { ...files, 'workflows/kept/workflow.ts': kept },
        { base }
      )
      // The kept workflow carries the same schedule but is never deployed, so it serves nothing.
      expect(withKept.failed).toBeUndefined()
      const withoutNightly = Object.fromEntries(
        Object.entries({ ...files, ...withKept.files }).filter(
          ([path]) => !path.startsWith('workflows/nightly/') && path !== DEPLOYMENT
        )
      )

      const plan = await apply(workspaceId, withoutNightly, {
        base: withKept.base,
        allowDelete: true,
        dryRun: true,
      })

      expect(
        plan.plan.find((change) => change.kind === 'workflow' && change.action === 'delete')
      ).toMatchObject({
        key: 'nightly',
        destructive: { what: 'workflow', counts: { schedules: 1 } },
      })
    }
  )

  check(
    'refuses deleting a workflow whose live triggers could not be counted, never claiming none end',
    async () => {
      const { workspaceId, files, base } = await deployedWorkspace()
      const kept = NIGHTLY.replace("workflow('Nightly'", "workflow('Kept'")
      const withKept = await apply(
        workspaceId,
        { ...files, 'workflows/kept/workflow.ts': kept },
        { base }
      )
      expect(withKept.failed).toBeUndefined()
      const withoutNightly = Object.fromEntries(
        Object.entries({ ...files, ...withKept.files }).filter(
          ([path]) => !path.startsWith('workflows/nightly/') && path !== DEPLOYMENT
        )
      )
      // The workflow plan reads the trigger listing first; the deployment's undeploy reads it next.
      const listTriggers = listWorkflowTriggers.execute.bind(listWorkflowTriggers)
      vi.spyOn(listWorkflowTriggers, 'execute')
        .mockRejectedValueOnce(new Error('trigger listing went away'))
        .mockImplementation(listTriggers)

      const plan = await apply(workspaceId, withoutNightly, {
        base: withKept.base,
        allowDelete: true,
        dryRun: true,
      }).finally(() => vi.mocked(listWorkflowTriggers.execute).mockRestore())

      expect(
        plan.diagnostics
          .filter((finding) => finding.severity === 'error')
          .map((finding) => `${finding.code} ${finding.kind}:${finding.key}`)
      ).toEqual(['E_APPLY_STALE workflow:nightly'])
    }
  )

  check('refuses a workspace API key and a member below admin, writing nothing', async () => {
    const { workspaceId, id, files, base } = await deployedWorkspace()
    const publicApi = {
      ...files,
      [DEPLOYMENT]: deployment("{ live: 'draft', api: { public: true } }"),
    }
    const key: Principal = createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() })

    for (const principal of [key, writer]) {
      const refused = await refusal(
        apply(workspaceId, publicApi, { base, principal, only: ['deployment'] })
      )
      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_FORBIDDEN'])
      expect(refused.diagnostics.find((finding) => finding.severity === 'error')?.kind).toBe(
        'deployment'
      )
    }
    expect((await deployState(id)).isPublicApi).toBe(false)

    const allowed = await apply(workspaceId, publicApi, { base })
    expect(allowed.failed).toBeUndefined()
    expect((await deployState(id)).isPublicApi).toBe(true)
  })

  check(
    'redeploys an undeployed public workflow as private when the API is not declared',
    async () => {
      const { workspaceId, id, files, base } = await deployedWorkspace(
        deployment("{ live: 'draft', api: { public: true } }")
      )
      expect((await deployState(id)).isPublicApi).toBe(true)
      const { [DEPLOYMENT]: _removed, ...withoutDeployment } = files
      const undeployed = await apply(workspaceId, withoutDeployment, { base, allowDelete: true })
      expect(undeployed.failed).toBeUndefined()
      expect(await deployState(id)).toMatchObject({ isDeployed: false, isPublicApi: true })

      const redeployed = await apply(
        workspaceId,
        { ...withoutDeployment, ...undeployed.files, [DEPLOYMENT]: DRAFT },
        { base: undeployed.base }
      )
      expect(redeployed.failed).toBeUndefined()
      expect(actions(redeployed.applied)).toContain('create deployment:nightly')
      expect(await deployState(id)).toMatchObject({ isDeployed: true, isPublicApi: false })
    }
  )

  check(
    'refuses a chat identifier another chat holds before the public API flag changes',
    async () => {
      await deployedWorkspace(answerChat('held-chat'))
      const { workspaceId, id, files, base } = await deployedWorkspace()
      const publicWithChat = {
        ...files,
        [DEPLOYMENT]: withChat(
          "{ identifier: 'held-chat', title: 'Mine', auth: 'public' }",
          'draft',
          'defineDeployment'
        ).replace("live: 'draft',", "live: 'draft', api: { public: true },"),
      }
      expect(publicWithChat[DEPLOYMENT]).toContain('api: { public: true }')

      // Taken when the plan runs: refused with nothing written.
      const planned = await refusal(apply(workspaceId, publicWithChat, { base }))
      expect(deploymentCodes(planned.diagnostics, 'error')).toEqual(['E_DEPLOY_CHAT_IDENTIFIER'])
      expect(await deployState(id)).toMatchObject({ isPublicApi: false, chat: undefined })

      // Taken between the plan and the write: the write refuses before it sets the flag.
      const check = deploymentAdapter.storedFingerprintNow
      if (!check) throw new Error('The deployment adapter checks fingerprints before writing')
      const other = await deployedWorkspace()
      const claimed = vi
        .spyOn(deploymentAdapter, 'storedFingerprintNow')
        .mockImplementation(async (change, ctx) => {
          await serveChat(other.id, 'raced-chat')
          return check.call(deploymentAdapter, change, ctx)
        })
      try {
        const raced = await apply(
          workspaceId,
          {
            ...publicWithChat,
            [DEPLOYMENT]: publicWithChat[DEPLOYMENT].replace('held-chat', 'raced-chat'),
          },
          { base }
        )
        expect(claimed).toHaveBeenCalledOnce()
        expect(raced.failed?.key).toBe('nightly')
      } finally {
        claimed.mockRestore()
      }
      expect((await deployState(other.id)).chat?.identifier).toBe('raced-chat')
      expect(await deployState(id)).toMatchObject({ isPublicApi: false, chat: undefined })
    }
  )

  check(
    'a re-run finishes a deployment an apply left partway, and still refuses a teammate edit',
    async () => {
      /** A public API and a chat at `identifier`: two writes, the flag first. */
      const target = (identifier: string) =>
        withChat(
          `{ identifier: '${identifier}', title: 'Partway', auth: 'public' }`,
          'draft',
          'defineDeployment'
        ).replace("live: 'draft',", "live: 'draft', api: { public: true },")
      expect(target('partway-chat')).toContain('api: { public: true }')

      /** Applies `target`, stopping it after the flag is set and before the chat is written. */
      const interrupted = async (identifier: string) => {
        const deployed = await deployedWorkspace()
        const stopped = vi
          .spyOn(replaceWorkflowChatDeployment, 'execute')
          .mockRejectedValueOnce(new Error('process stopped'))
        try {
          const result = await apply(
            deployed.workspaceId,
            { ...deployed.files, [DEPLOYMENT]: target(identifier) },
            { base: deployed.base }
          )
          expect(result.failed?.key).toBe('nightly')
        } finally {
          stopped.mockRestore()
        }
        expect(await deployState(deployed.id)).toMatchObject({
          isPublicApi: true,
          chat: undefined,
        })
        return deployed
      }

      // The base is the one from before the interrupted apply, as a crash leaves it.
      const resumed = await interrupted('partway-chat')
      const rerun = await apply(
        resumed.workspaceId,
        { ...resumed.files, [DEPLOYMENT]: target('partway-chat') },
        { base: resumed.base }
      )
      expect(rerun.failed).toBeUndefined()
      expect(actions(rerun.applied)).toEqual(['update deployment:nightly'])
      expect(rerun.plan.find((change) => change.kind === 'deployment')?.fields).toEqual(['chat'])
      expect(await deployState(resumed.id)).toMatchObject({
        isPublicApi: true,
        chat: { identifier: 'partway-chat', title: 'Partway' },
      })
      const settled = await apply(
        resumed.workspaceId,
        { ...resumed.files, ...rerun.files },
        { base: rerun.base }
      )
      expect(settled.applied).toEqual([])

      // A part that matches neither the base nor the directory moved on the server: stale.
      const teammate = await interrupted('mine-chat')
      await serveChat(teammate.id, 'teammate-chat')
      const stale = await refusal(
        apply(
          teammate.workspaceId,
          { ...teammate.files, [DEPLOYMENT]: target('mine-chat') },
          { base: teammate.base }
        )
      )
      expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect((await deployState(teammate.id)).chat?.identifier).toBe('teammate-chat')
    }
  )

  check(
    'a re-run finishes a first deploy that stopped before its chat, and still asks for a get when the flag differs',
    async () => {
      /** The nightly workflow, first deployed with a chat by an apply stopped before the chat. */
      const stopped = async (identifier: string) => {
        const workspaceId = await workspaces.create({ name: 'First deploy stopped', ownerId })
        const created = await apply(workspaceId, { [WORKFLOW]: NIGHTLY })
        expect(created.failed).toBeUndefined()
        const files = { ...created.files, [DEPLOYMENT]: answerChat(identifier) }
        const chatWrite = vi
          .spyOn(replaceWorkflowChatDeployment, 'execute')
          .mockRejectedValueOnce(new Error('process stopped'))
        let failed: Awaited<ReturnType<typeof apply>>
        try {
          failed = await apply(workspaceId, files, { base: created.base })
        } finally {
          chatWrite.mockRestore()
        }
        expect(failed.failed?.key).toBe('nightly')
        expect(failed.base.resources['deployment:nightly']).toBeUndefined()
        const id = await workflowId(workspaceId)
        expect(await deployState(id)).toMatchObject({ isDeployed: true, chat: undefined })
        return { workspaceId, id, files, base: failed.base }
      }

      const resumed = await stopped('first-deploy-chat')
      const rerun = await apply(resumed.workspaceId, resumed.files, { base: resumed.base })
      expect(rerun.failed).toBeUndefined()
      expect(actions(rerun.applied)).toEqual(['update deployment:nightly'])
      expect((await deployState(resumed.id)).chat?.identifier).toBe('first-deploy-chat')
      expect(rerun.base.resources['deployment:nightly']?.id).toBe(resumed.id)

      // A flag the directory does not declare was set by someone else: get it first.
      const moved = await stopped('moved-flag-chat')
      await updateWorkflowPublicApi.execute({
        principal: owner,
        input: { workflowId: moved.id, isPublicApi: true },
      })
      const refused = await refusal(apply(moved.workspaceId, moved.files, { base: moved.base }))
      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_NO_BASE'])
    }
  )

  check('refuses an edit when the server changed the deployment since the base', async () => {
    const { workspaceId, files, base, id } = await deployedWorkspace()
    await updateWorkflowPublicApi.execute({
      principal: owner,
      input: { workflowId: id, isPublicApi: true },
    })

    const stale = await refusal(
      apply(
        workspaceId,
        {
          ...files,
          [DEPLOYMENT]: withChat("{ identifier: 'stale-chat', title: 'S', auth: 'public' }"),
        },
        { base }
      )
    )
    expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
    const unchanged = await apply(workspaceId, files, { base })
    expect(codes(unchanged.diagnostics, 'warning')).toContain('W_SERVER_CHANGED')
  })

  check('warns when an apply edits a deployed workflow no deployment file covers', async () => {
    const { workspaceId, id, files, base } = await deployedWorkspace()
    const { [DEPLOYMENT]: _deployment, ...workflowOnly } = files

    const result = await apply(workspaceId, edited(workflowOnly), { base, kinds: ['workflow'] })
    expect(result.failed).toBeUndefined()
    expect(deploymentCodes(result.diagnostics, 'warning')).toEqual(['W_DEPLOYED_DRAFT_CHANGED'])
    expect((await deployState(id)).versions).toBe(1)
  })

  check(
    'warns when a delete breaks the live version of a workflow whose draft no longer uses it, unless the apply redeploys',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Deployed table user', ownerId })
      const kinds: WorkspaceKind[] = ['table', 'workflow', 'deployment']
      const created = await apply(
        workspaceId,
        {
          'tables/leads.ts': LEADS_TABLE,
          'workflows/ingest/workflow.ts': INGEST_LEADS,
          'deployments/ingest.ts': DRAFT,
        },
        { kinds }
      )
      expect(created.failed).toBeUndefined()
      const read = await getAll(workspaceId, kinds)
      const { 'tables/leads.ts': _leads, ...withoutTable } = read.files
      // The draft stops writing to the table, which the live version still does.
      const dropped: Files = {
        ...withoutTable,
        'workflows/ingest/workflow.ts': INGEST_NOTHING,
      }

      const { 'deployments/ingest.ts': _deployment, ...undeclaredDeployment } = dropped
      const kept = await apply(workspaceId, undeclaredDeployment, {
        kinds: ['table', 'workflow'],
        base: read.base,
        allowDelete: true,
        dryRun: true,
      })
      expect(codes(kept.diagnostics)).toEqual([])
      const warning = kept.diagnostics.find((finding) => finding.code === 'W_RESOURCE_IN_USE')
      expect(warning).toMatchObject({ kind: 'table', key: 'leads' })
      expect(warning?.message).toContain('"Ingest" (live version)')

      const redeployed = await apply(workspaceId, dropped, {
        kinds,
        base: read.base,
        allowDelete: true,
        dryRun: true,
      })
      expect(codes(redeployed.diagnostics)).toEqual([])
      expect(actions(redeployed.plan)).toContain('update deployment:ingest')
      expect(codes(redeployed.diagnostics, 'warning')).not.toContain('W_RESOURCE_IN_USE')
    }
  )

  check(
    'warns when a column rename breaks the live version of a workflow whose draft writes the new name, unless the apply redeploys',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Deployed column user', ownerId })
      const kinds: WorkspaceKind[] = ['table', 'workflow', 'deployment']
      const created = await apply(
        workspaceId,
        {
          'tables/leads.ts': LEADS_TABLE,
          'workflows/ingest/workflow.ts': INGEST_LEADS,
          'deployments/ingest.ts': DRAFT,
        },
        { kinds }
      )
      expect(created.failed).toBeUndefined()
      const read = await getAll(workspaceId, kinds)
      // The table renames email, and the draft writes the new name; the live version still writes email.
      const renamed: Files = {
        ...read.files,
        'tables/leads.ts': LEADS_TABLE.replace(
          'email: column.string(),',
          "email: column.string({ name: 'email_address' }),"
        ),
        'workflows/ingest/workflow.ts': INGEST_LEADS.replace(
          'data: { email: start.email }',
          'data: { email_address: start.email }'
        ),
      }

      const { 'deployments/ingest.ts': _deployment, ...undeclaredDeployment } = renamed
      const kept = await apply(workspaceId, undeclaredDeployment, {
        kinds: ['table', 'workflow'],
        base: read.base,
        dryRun: true,
      })
      expect(codes(kept.diagnostics)).toEqual([])
      const warning = kept.diagnostics.find(
        (finding) => finding.code === 'W_TABLE_COLUMN_RENAMED_IN_USE'
      )
      expect(warning).toMatchObject({ kind: 'table', key: 'leads' })
      expect(warning?.message).toContain('live version')

      const redeployed = await apply(workspaceId, renamed, {
        kinds,
        base: read.base,
        dryRun: true,
      })
      expect(codes(redeployed.diagnostics)).toEqual([])
      expect(actions(redeployed.plan)).toContain('update deployment:ingest')
      expect(codes(redeployed.diagnostics, 'warning')).not.toContain(
        'W_TABLE_COLUMN_RENAMED_IN_USE'
      )
    }
  )

  check(
    'reads the deployment state of only the workflows the directory declares or its base records',
    async () => {
      const { workspaceId, id, files, base } = await deployedWorkspace()
      const others: Files = {}
      for (const name of ['alpha', 'beta', 'gamma']) {
        others[`workflows/${name}/workflow.ts`] = NIGHTLY.replace(
          "workflow('Nightly'",
          `workflow('${name}'`
        )
        others[`deployments/${name}.ts`] = DRAFT
      }
      const deployedOthers = await apply(workspaceId, others)
      expect(deployedOthers.failed).toBeUndefined()

      const reads = vi.spyOn(readWorkflowDeploymentStatus, 'execute')
      try {
        const plan = await apply(workspaceId, files, { base, kinds: ['deployment'], dryRun: true })
        expect(plan.failed).toBeUndefined()
        expect(new Set(reads.mock.calls.map(([call]) => call.input.workflowId))).toEqual(
          new Set([id])
        )
      } finally {
        reads.mockRestore()
      }
    }
  )

  check('refuses a deployment of a workflow the workspace does not hold', async () => {
    const workspaceId = await workspaces.create({ name: 'Deploy nothing', ownerId })
    const refused = await refusal(apply(workspaceId, { 'deployments/missing.ts': DRAFT }))
    expect(codes(refused.diagnostics)).toEqual(['E_DEPLOY_WORKFLOW'])
  })

  check(
    'a deploy carrying the draft fingerprint it expects refuses a draft edited since, deploying nothing',
    async () => {
      const { id } = await deployedWorkspace(PINNED)
      const reviewed = await draftFingerprint(id)
      await editDraftOutOfBand(id, 'Edited in the editor: ')

      const refused = await deployWorkflow
        .execute({
          principal: owner,
          input: { workflowId: id, requestId: generateId(), expectedDraftFingerprint: reviewed },
        })
        .then(
          () => null,
          (error: unknown) => error
        )
      expect(refused).toBeInstanceOf(OrchestrationError)
      expect((refused as OrchestrationError).code).toBe('conflict')
      expect((await deployState(id)).versions).toBe(1)

      const current = await draftFingerprint(id)
      expect(current).not.toBe(reviewed)
      await deployWorkflow.execute({
        principal: owner,
        input: { workflowId: id, requestId: generateId(), expectedDraftFingerprint: current },
      })
      expect((await deployState(id)).versions).toBe(2)
    }
  )

  check(
    "live: 'draft' does not publish a draft edited outside source, and says which workflow",
    async () => {
      const { workspaceId, id, files, base } = await deployedWorkspace()
      await editDraftOutOfBand(id, 'Edited in the editor: ')

      const result = await apply(workspaceId, asSent(files, workspaceId), { base })
      expect(result.failed).toBeUndefined()
      expect(actions(result.plan)).toEqual(['noop workflow:nightly', 'noop deployment:nightly'])
      expect(result.applied).toEqual([])
      const warning = result.diagnostics.find(
        (finding) => finding.code === 'W_DEPLOY_DRAFT_NOT_SOURCE'
      )
      expect(warning).toMatchObject({ severity: 'warning', kind: 'deployment', key: 'nightly' })
      expect(warning?.message).toContain('workflows/nightly')
      expect((await deployState(id)).versions).toBe(1)

      // Writing the chat would publish that draft too, so it is refused before anything is written.
      const chat = await refusal(
        apply(
          workspaceId,
          { ...asSent(files, workspaceId), [DEPLOYMENT]: answerChat('not-source-chat') },
          { base }
        )
      )
      expect(codes(chat.diagnostics)).toEqual(['E_DEPLOY_DRAFT_NOT_SOURCE_CHAT'])
      expect((await deployState(id)).versions).toBe(1)
    }
  )

  check(
    "live: 'draft' deploys a draft that still is the directory's workflow, applied before without its deploy",
    async () => {
      const { workspaceId, id, files, base } = await deployedWorkspace(PINNED)
      const written = await apply(workspaceId, edited(files), { base })
      expect(actions(written.applied)).toEqual(['update workflow:nightly'])
      expect((await deployState(id)).versions).toBe(1)

      const now = { ...edited(files), ...written.files, [DEPLOYMENT]: DRAFT }
      const result = await apply(workspaceId, asSent(now, workspaceId), { base: written.base })
      expect(result.failed).toBeUndefined()
      expect(actions(result.applied)).toEqual(['update deployment:nightly'])
      expect(codes(result.diagnostics, 'warning')).not.toContain('W_DEPLOY_DRAFT_NOT_SOURCE')
      expect((await deployState(id)).versions).toBe(2)
    }
  )

  check(
    'a deploy refuses a draft edited between the plan and the deploy, publishing nothing',
    async () => {
      const { workspaceId, id, files, base } = await deployedWorkspace()
      const check = deploymentAdapter.storedFingerprintNow
      if (!check) throw new Error('The deployment adapter checks fingerprints before writing')
      // A teammate edits the draft after the workflow write, just before the deploy.
      const racing = vi
        .spyOn(deploymentAdapter, 'storedFingerprintNow')
        .mockImplementation(async (change, ctx) => {
          await editDraftOutOfBand(id, 'Edited meanwhile: ')
          return check.call(deploymentAdapter, change, ctx)
        })
      try {
        const result = await apply(workspaceId, edited(files), { base })
        expect(racing).toHaveBeenCalledOnce()
        expect(actions(result.applied)).toEqual(['update workflow:nightly'])
        expect([result.failed?.key, result.failed?.code]).toEqual(['nightly', 'E_APPLY_STALE'])
        expect((await deployState(id)).versions).toBe(1)
      } finally {
        racing.mockRestore()
      }
    }
  )

  check(
    'a chat write refuses a draft edited between the plan and the write, publishing nothing',
    async () => {
      const { workspaceId, id, files, base } = await deployedWorkspace()
      const check = deploymentAdapter.storedFingerprintNow
      if (!check) throw new Error('The deployment adapter checks fingerprints before writing')
      // A teammate edits the draft just before the chat write, which would redeploy it.
      const racing = vi
        .spyOn(deploymentAdapter, 'storedFingerprintNow')
        .mockImplementation(async (change, ctx) => {
          await editDraftOutOfBand(id, 'Edited meanwhile: ')
          return check.call(deploymentAdapter, change, ctx)
        })
      try {
        const result = await apply(
          workspaceId,
          { ...asSent(files, workspaceId), [DEPLOYMENT]: answerChat('racing-chat') },
          { base }
        )
        expect(racing).toHaveBeenCalledOnce()
        expect([result.failed?.key, result.failed?.code]).toEqual(['nightly', 'E_APPLY_STALE'])
        const after = await deployState(id)
        expect(after.versions).toBe(1)
        expect(after.chat).toBeUndefined()
      } finally {
        racing.mockRestore()
      }
    }
  )
})
