import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  chat,
  user,
  workflow,
  workflowDeploymentVersion,
  workflowSchedule,
  workspaceEnvironment,
} from '@sim/db/schema'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import type { WorkspaceBaseV1 } from '@sim/workspace-code'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { encryptSecret } from '@/lib/core/security/encryption'
import { updateWorkflowPublicApi } from '@/lib/workflows/application/update-workflow-deployment-settings'
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
    expect((await deployState(id)).chat).toBeUndefined()
    expect((await deployState(id)).isDeployed).toBe(true)
  })

  check('undeploying needs --allow-delete, and the plan says what stops', async () => {
    const { workspaceId, id, files, base } = await deployedWorkspace()
    const { [DEPLOYMENT]: _removed, ...withoutDeployment } = files

    const gated = await refusal(apply(workspaceId, withoutDeployment, { base }))
    expect(codes(gated.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
    expect(
      gated.diagnostics.find((finding) => finding.code === 'E_APPLY_DELETE_NOT_ALLOWED')?.message
    ).toContain('1 schedules')
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
    expect(codes(unchanged.diagnostics, 'info')).toContain('I_SERVER_CHANGED')
  })

  check('warns when an apply edits a deployed workflow no deployment file covers', async () => {
    const { workspaceId, id, files, base } = await deployedWorkspace()
    const { [DEPLOYMENT]: _deployment, ...workflowOnly } = files

    const result = await apply(workspaceId, edited(workflowOnly), { base, kinds: ['workflow'] })
    expect(result.failed).toBeUndefined()
    expect(deploymentCodes(result.diagnostics, 'warning')).toEqual(['W_DEPLOYED_DRAFT_CHANGED'])
    expect((await deployState(id)).versions).toBe(1)
  })

  check('refuses a deployment of a workflow the workspace does not hold', async () => {
    const workspaceId = await workspaces.create({ name: 'Deploy nothing', ownerId })
    const refused = await refusal(apply(workspaceId, { 'deployments/missing.ts': DRAFT }))
    expect(codes(refused.diagnostics)).toEqual(['E_DEPLOY_WORKFLOW'])
  })
})
