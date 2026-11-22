/**
 * Secrets and credentials as workspace source, against real Postgres: `secrets.ts` and
 * `credentials.ts` declare what workflows reference, never a value, and an apply holds back
 * exactly the workflows that use a reference the workspace cannot satisfy while the rest apply.
 */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { auditLog, credential, user, workflow, workspaceResourceKey } from '@sim/db/schema'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import {
  bindCredentialKey,
  releaseCredentialKey,
} from '@/lib/credentials/application/credential-keys'
import { setSecretUseCase } from '@/lib/secrets/application/use-cases'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import type { ApplyWorkspaceSourceInput } from '@/lib/workspace-source/application/apply-workspace-source'
import {
  codes,
  refusal,
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

/** Credential ids the editing gate refuses as unreachable, as if the caller lost access mid-plan. */
const revokedCredentials = new Set<string>()
vi.mock('@/lib/workflows/editing/selector-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workflows/editing/selector-validator')>()
  return {
    ...actual,
    validateSelectorIds: async (...args: Parameters<typeof actual.validateSelectorIds>) => {
      const result = await actual.validateSelectorIds(...args)
      const revoked = result.valid.filter((id) => revokedCredentials.has(id))
      return {
        ...result,
        valid: result.valid.filter((id) => !revokedCredentials.has(id)),
        invalid: [...result.invalid, ...revoked],
      }
    },
  }
})

const ownerId = generateId()
const readerId = generateId()
const writerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const reader = createSessionPrincipal({ userId: readerId, sessionId: generateId() })
const writer = createSessionPrincipal({ userId: writerId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_REFERENCES_REPORT_PATH',
  'workspace-source-references.json'
)
const workspaces = sourceWorkspaces()
const runner = sourceRunner(['secret', 'credential', 'workflow'], owner)

/** The secret value every check sets: no response or printed file may ever hold it. */
const SECRET_VALUE = `sk-live-${generateId()}`

const SECRETS = (description = 'Model access') => `// @sim-sdk 1
import { defineSecrets } from '@sim/workflow-sdk/workspace'

export default defineSecrets({
  OPENAI_API_KEY: { description: '${description}' },
})
`

const CREDENTIALS = (entry = "{ provider: 'slack' }") => `// @sim-sdk 1
import { defineCredentials } from '@sim/workflow-sdk/workspace'

export default defineCredentials({
  slack: ${entry},
})
`

const ASK = `// @sim-sdk 1
import { agent, env, t, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Ask', {}, () => {
  const start = trigger.start('Start', { inputFormat: { question: 'string' } })
  const answer = agent('Answer', {
    model: 'claude-sonnet-4-6',
    apiKey: env.OPENAI_API_KEY,
    messages: [{ role: 'user', content: t\`\${start.question}\` }],
  })

  start.to(answer)
})
`

const NOTIFY = `// @sim-sdk 1
import { credential, slack, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Notify', {}, () => {
  const start = trigger.start('Start', { inputFormat: { text: 'string' } })
  const post = slack.sendMessage('Post', {
    credential: credential('slack'),
    destinationType: 'channel',
    channel: 'ops',
    messageFormat: 'text',
    text: start.text,
  })

  start.to(post)
})
`

const PLAIN = `// @sim-sdk 1
import { agent, t, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Plain', {}, () => {
  const start = trigger.start('Start', { inputFormat: { question: 'string' } })
  const answer = agent('Answer', {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: t\`\${start.question}\` }],
  })

  start.to(answer)
})
`

const CHILD = `// @sim-sdk 1
import { trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Child', {}, () => {
  trigger.start('Start', { inputFormat: {} })
})
`

const RUNS_CHILD = `// @sim-sdk 1
import { childWorkflow, runWorkflow, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Parent', {}, () => {
  const start = trigger.start('Start', { inputFormat: {} })
  const run = runWorkflow('Run', { workflowId: childWorkflow('child') })
  start.to(run)
})
`

type ApplyOptions = Partial<Omit<ApplyWorkspaceSourceInput, 'workspaceId' | 'files'>> & {
  principal?: Principal
}

/** Every response a check reads, to assert no secret value ever left the server. */
const responses: unknown[] = []

async function apply(
  workspaceId: string,
  files: Record<string, string>,
  options: ApplyOptions = {}
) {
  try {
    const result = await runner.apply(workspaceId, { files, ...options })
    responses.push(result)
    return result
  } catch (error) {
    responses.push(error)
    throw error
  }
}

async function get(workspaceId: string, principal: Principal = owner) {
  const result = await runner.get(workspaceId, principal)
  responses.push(result)
  return result
}

async function newWorkspace(): Promise<string> {
  return workspaces.create({
    name: 'Workspace source references',
    ownerId,
    members: [{ userId: readerId, permission: 'read' }],
  })
}

async function setSecret(workspaceId: string, description = 'Model access'): Promise<void> {
  await setSecretUseCase.execute({
    principal: owner,
    input: {
      workspaceId,
      name: 'OPENAI_API_KEY',
      scope: 'workspace',
      value: SECRET_VALUE,
      description,
      // A visible secret is the one the listing returns a value for: source must still drop it.
      unredacted: true,
    },
  })
}

async function addSlackCredential(workspaceId: string, displayName: string): Promise<string> {
  const id = generateId()
  await db.insert(credential).values({
    id,
    workspaceId,
    type: 'service_account',
    displayName,
    providerId: 'slack',
    createdBy: ownerId,
  })
  return id
}

function actions(plan: ReadonlyArray<{ kind: string; key: string; action: string }>) {
  return plan
    .filter((change) => change.action !== 'noop')
    .map(({ kind, key, action }) => `${action} ${kind}:${key}`)
}

function held(plan: ReadonlyArray<{ kind: string; key: string; held?: true }>) {
  return plan.filter((change) => change.held).map(({ kind, key }) => `${kind}:${key}`)
}

/** `code kind:key` of every finding of one severity. */
function findings(
  diagnostics: ReadonlyArray<{ code: string; severity: string; kind?: string; key?: string }>,
  severity = 'error'
) {
  return diagnostics
    .filter((finding) => finding.severity === severity)
    .map((finding) => `${finding.code} ${finding.kind}:${finding.key}`)
}

async function liveWorkflowNames(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ name: workflow.name })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
  return rows.map((row) => row.name).sort()
}

/** The credential id every slack block of a workflow stores. */
async function slackCredentialOf(workflowId: string): Promise<string[]> {
  const state = await loadWorkflowFromNormalizedTables(workflowId)
  return Object.values(state?.blocks ?? {}).flatMap((block) => {
    const value = block.subBlocks?.credential?.value
    return block.type.startsWith('slack') && typeof value === 'string' ? [value] : []
  })
}

async function boundKey(workspaceId: string, key: string): Promise<string | undefined> {
  const [row] = await db
    .select({ resourceId: workspaceResourceKey.resourceId })
    .from(workspaceResourceKey)
    .where(
      and(
        eq(workspaceResourceKey.workspaceId, workspaceId),
        eq(workspaceResourceKey.kind, 'credential'),
        eq(workspaceResourceKey.key, key)
      )
    )
  return row?.resourceId
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values(
    [ownerId, readerId, writerId].map((id) => ({
      id,
      name: 'Workspace source references fixture',
      email: `${id}@workspace-source-references.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
})

afterAll(async () => {
  await writeReport()
  await workspaces.cleanup()
  await db.delete(user).where(inArray(user.id, [ownerId, readerId, writerId]))
})

describe('workspace source: secrets and credentials', () => {
  check('a declared secret the workspace holds applies clean', async () => {
    const workspaceId = await newWorkspace()
    await setSecret(workspaceId)
    const files = { 'secrets.ts': SECRETS(), 'workflows/ask/workflow.ts': ASK }

    const dryRun = await apply(workspaceId, files, { dryRun: true })
    expect(findings(dryRun.diagnostics)).toEqual([])
    expect(findings(dryRun.diagnostics, 'warning')).toEqual([])
    const result = await apply(workspaceId, files)

    expect(result.failed).toBeUndefined()
    expect(actions(result.applied)).toEqual(['create workflow:ask'])
    expect(result.files['secrets.ts']).toBe(SECRETS())
    expect(result.base.resources['secret:OPENAI_API_KEY']?.fingerprint).toMatch(/^rf1:/)
    const again = await apply(workspaceId, { ...files, ...result.files }, { base: result.base })
    expect(actions(again.plan)).toEqual([])
  })

  check(
    'a declared secret the workspace lacks holds back only the workflow reading it',
    async () => {
      const workspaceId = await newWorkspace()
      const files = {
        'secrets.ts': SECRETS(),
        'workflows/ask/workflow.ts': ASK,
        'workflows/plain/workflow.ts': PLAIN,
      }

      const dryRun = await apply(workspaceId, files, { dryRun: true })
      expect(findings(dryRun.diagnostics)).toEqual(['E_SECRET_MISSING workflow:ask'])
      expect(findings(dryRun.diagnostics, 'warning')).toContain(
        'W_SECRET_MISSING secret:OPENAI_API_KEY'
      )
      const missing = dryRun.diagnostics.find((finding) => finding.code === 'E_SECRET_MISSING')
      expect(missing?.hint).toContain('sim secrets set OPENAI_API_KEY --scope workspace')
      expect(held(dryRun.plan)).toEqual(['workflow:ask'])
      expect(dryRun.refuses).toBe(false)

      const result = await apply(workspaceId, files)
      expect(result.failed).toBeUndefined()
      expect(actions(result.applied)).toEqual(['create workflow:plain'])
      expect(held(result.plan)).toEqual(['workflow:ask'])
      expect(result.refuses).toBeUndefined()
      expect(await liveWorkflowNames(workspaceId)).toEqual(['Plain'])
      expect(result.base.resources['workflow:ask']).toBeUndefined()

      await setSecret(workspaceId)
      const retried = await apply(workspaceId, { ...files, ...result.files }, { base: result.base })
      expect(actions(retried.applied)).toEqual(['create workflow:ask'])
      expect(await liveWorkflowNames(workspaceId)).toEqual(['Ask', 'Plain'])
    }
  )

  check(
    'refuses deleting a workflow a held-back edit stops running, since the stored one still runs it',
    async () => {
      const workspaceId = await newWorkspace()
      const created = await apply(workspaceId, {
        'workflows/parent/workflow.ts': RUNS_CHILD,
        'workflows/child/workflow.ts': CHILD,
      })
      expect(created.failed).toBeUndefined()
      const withoutChild = Object.fromEntries(
        Object.entries(created.files).filter(([path]) => !path.startsWith('workflows/child/'))
      )

      // The edit drops the child for an agent reading a secret the workspace lacks: it is held.
      const edited = {
        ...withoutChild,
        'secrets.ts': SECRETS(),
        'workflows/parent/workflow.ts': ASK.replace("'Ask'", "'Parent'"),
      }
      // The dry run says the apply refuses, though the finding names the held workflow.
      const preview = await apply(workspaceId, edited, {
        base: created.base,
        allowDelete: true,
        dryRun: true,
      })
      expect(held(preview.plan)).toEqual(['workflow:parent'])
      expect(preview.refuses).toBe(true)
      const refused = await refusal(
        apply(workspaceId, edited, { base: created.base, allowDelete: true })
      )
      expect(findings(refused.diagnostics)).toContain('E_SECRET_MISSING workflow:parent')
      expect(findings(refused.diagnostics)).toContain('E_PLAN_REF_DELETED workflow:parent')
      expect(await liveWorkflowNames(workspaceId)).toEqual(['Child', 'Parent'])
    }
  )

  check(
    'refuses deleting the last workflow when the create replacing it is held back',
    async () => {
      const workspaceId = await newWorkspace()
      const created = await apply(workspaceId, { 'workflows/plain/workflow.ts': PLAIN })
      expect(created.failed).toBeUndefined()

      const refused = await refusal(
        apply(
          workspaceId,
          { 'secrets.ts': SECRETS(), 'workflows/ask/workflow.ts': ASK },
          { base: created.base, allowDelete: true }
        )
      )
      expect(findings(refused.diagnostics).sort()).toEqual([
        'E_APPLY_REFUSED workflow:plain',
        'E_SECRET_MISSING workflow:ask',
      ])
      // The held create's error refuses nothing, so the refusal neither counts nor classes it.
      expect(refused.message).toContain('has 1 error(s)')
      expect(refused.code).toBe('validation')
      expect(await liveWorkflowNames(workspaceId)).toEqual(['Plain'])
    }
  )

  check(
    'a description edit updates the secret; a server edit since the base is stale',
    async () => {
      const workspaceId = await newWorkspace()
      await setSecret(workspaceId)
      const read = await get(workspaceId)
      expect(read.files['secrets.ts']).toBe(SECRETS())

      const edited = await apply(
        workspaceId,
        { 'secrets.ts': SECRETS('Billing') },
        { base: read.base }
      )
      expect(actions(edited.applied)).toEqual(['update secret:OPENAI_API_KEY'])
      expect((await get(workspaceId)).files['secrets.ts']).toBe(SECRETS('Billing'))

      await setSecret(workspaceId, 'Changed in the UI')
      const stale = await refusal(
        apply(workspaceId, { 'secrets.ts': SECRETS('Mine') }, { base: edited.base })
      )
      expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
    }
  )

  check(
    'a secret declared without a description, then with one, is never stale on its own description',
    async () => {
      const workspaceId = await newWorkspace()
      await setSecret(workspaceId, 'prod')
      const bare = SECRETS().replace("{ description: 'Model access' }", '{}')

      const first = await apply(workspaceId, { 'secrets.ts': bare })
      expect(actions(first.applied)).toEqual([])
      const again = await apply(workspaceId, { 'secrets.ts': bare }, { base: first.base })
      expect(codes(again.diagnostics, 'info')).toEqual([])

      const described = await apply(
        workspaceId,
        { 'secrets.ts': SECRETS('new') },
        { base: again.base }
      )
      expect(actions(described.applied)).toEqual(['update secret:OPENAI_API_KEY'])
      expect((await get(workspaceId)).files['secrets.ts']).toBe(SECRETS('new'))
    }
  )

  check('a credential key adopts the provider’s only credential', async () => {
    const workspaceId = await newWorkspace()
    const slackId = await addSlackCredential(workspaceId, 'Acme Slack')
    const files = { 'credentials.ts': CREDENTIALS(), 'workflows/notify/workflow.ts': NOTIFY }

    const dryRun = await apply(workspaceId, files, { dryRun: true })
    expect(findings(dryRun.diagnostics)).toEqual([])
    const result = await apply(workspaceId, files)

    expect(result.failed).toBeUndefined()
    expect(actions(result.applied)).toEqual(['adopt credential:slack', 'create workflow:notify'])
    expect(await boundKey(workspaceId, 'slack')).toBe(slackId)
    const workflowId = result.base.resources['workflow:notify']?.id ?? ''
    expect(await slackCredentialOf(workflowId)).toEqual([slackId])

    const again = await apply(workspaceId, { ...files, ...result.files }, { base: result.base })
    expect(actions(again.plan)).toEqual([])
    expect(findings(again.diagnostics, 'warning')).toEqual([])
  })

  check(
    'several credentials of the provider hold back the workflow until a name picks one',
    async () => {
      const workspaceId = await newWorkspace()
      await addSlackCredential(workspaceId, 'Acme Slack')
      const opsId = await addSlackCredential(workspaceId, 'Ops Slack')
      const files = {
        'credentials.ts': CREDENTIALS(),
        'workflows/notify/workflow.ts': NOTIFY,
        'workflows/plain/workflow.ts': PLAIN,
      }

      const result = await apply(workspaceId, files)
      expect(findings(result.diagnostics)).toEqual(['E_CREDENTIAL_AMBIGUOUS workflow:notify'])
      expect(findings(result.diagnostics, 'warning')).toContain(
        'W_CREDENTIAL_AMBIGUOUS credential:slack'
      )
      const ambiguous = result.diagnostics.find(
        (finding) => finding.code === 'E_CREDENTIAL_AMBIGUOUS'
      )
      expect(ambiguous?.message).toContain('"Acme Slack", "Ops Slack"')
      expect(actions(result.applied)).toEqual(['create workflow:plain'])
      expect(await boundKey(workspaceId, 'slack')).toBeUndefined()

      const picked = await apply(
        workspaceId,
        {
          ...files,
          ...result.files,
          'credentials.ts': CREDENTIALS("{ provider: 'slack', name: 'Ops Slack' }"),
        },
        { base: result.base }
      )
      expect(findings(picked.diagnostics)).toEqual([])
      expect(actions(picked.applied)).toEqual(['adopt credential:slack', 'create workflow:notify'])
      expect(await boundKey(workspaceId, 'slack')).toBe(opsId)
    }
  )

  check(
    'no credential of the provider holds back the workflow with the connect command',
    async () => {
      const workspaceId = await newWorkspace()
      const files = { 'credentials.ts': CREDENTIALS(), 'workflows/notify/workflow.ts': NOTIFY }

      const result = await apply(workspaceId, files)

      expect(findings(result.diagnostics)).toEqual(['E_CREDENTIAL_MISSING workflow:notify'])
      const missing = result.diagnostics.find((finding) => finding.code === 'E_CREDENTIAL_MISSING')
      expect(missing?.hint).toContain('sim credentials connect slack')
      expect(result.applied).toEqual([])
      expect(await liveWorkflowNames(workspaceId)).toEqual([])
    }
  )

  check(
    'the same directory applied to a second workspace binds that workspace’s own credential',
    async () => {
      const first = await newWorkspace()
      const second = await newWorkspace()
      await addSlackCredential(first, 'First Slack')
      const secondId = await addSlackCredential(second, 'Second Slack')
      const files = { 'credentials.ts': CREDENTIALS(), 'workflows/notify/workflow.ts': NOTIFY }
      await apply(first, files)
      const directory = await get(first)

      const promoted = await apply(second, directory.files, { base: directory.base })

      expect(findings(promoted.diagnostics)).toEqual([])
      expect(codes(promoted.diagnostics, 'warning')).toContain('W_BASE_OTHER_WORKSPACE')
      expect(actions(promoted.applied)).toEqual([
        'adopt credential:slack',
        'create workflow:notify',
      ])
      expect(await boundKey(second, 'slack')).toBe(secondId)
      const workflowId = promoted.base.resources['workflow:notify']?.id ?? ''
      expect(await slackCredentialOf(workflowId)).toEqual([secondId])
    }
  )

  check('removing a credential key unbinds it only with --allow-delete', async () => {
    const workspaceId = await newWorkspace()
    const slackId = await addSlackCredential(workspaceId, 'Acme Slack')
    const created = await apply(workspaceId, { 'credentials.ts': CREDENTIALS() })
    const emptied = `// @sim-sdk 1
import { defineCredentials } from '@sim/workflow-sdk/workspace'

export default defineCredentials({})
`

    const refused = await refusal(
      apply(workspaceId, { 'credentials.ts': emptied }, { base: created.base })
    )
    expect(codes(refused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
    expect(await boundKey(workspaceId, 'slack')).toBe(slackId)

    const removed = await apply(
      workspaceId,
      { 'credentials.ts': emptied },
      { base: created.base, allowDelete: true }
    )
    expect(actions(removed.applied)).toEqual(['delete credential:slack'])
    expect(await boundKey(workspaceId, 'slack')).toBeUndefined()
    const [kept] = await db.select().from(credential).where(eq(credential.id, slackId))
    expect(kept?.displayName).toBe('Acme Slack')
  })

  check('a credential bound to a key outside source is never taken from that key', async () => {
    const workspaceId = await newWorkspace()
    const slackId = await addSlackCredential(workspaceId, 'Acme Slack')
    await bindCredentialKey.execute({
      principal: owner,
      input: { workspaceId, key: 'legacy', credentialId: slackId },
    })
    const files = { 'credentials.ts': CREDENTIALS(), 'workflows/notify/workflow.ts': NOTIFY }

    const result = await apply(workspaceId, files)

    expect(findings(result.diagnostics)).toEqual(['E_CREDENTIAL_MISSING workflow:notify'])
    const missing = result.diagnostics.find((finding) => finding.code === 'W_CREDENTIAL_MISSING')
    expect(missing?.message).toContain('"Acme Slack" (key "legacy")')
    expect(await boundKey(workspaceId, 'legacy')).toBe(slackId)
    expect(await boundKey(workspaceId, 'slack')).toBeUndefined()
  })

  check('a key renamed in source moves its credential to the new key', async () => {
    const workspaceId = await newWorkspace()
    const slackId = await addSlackCredential(workspaceId, 'Acme Slack')
    const legacy = await apply(workspaceId, {
      'credentials.ts': CREDENTIALS().replace('slack: {', 'legacy: {'),
    })
    expect(await boundKey(workspaceId, 'legacy')).toBe(slackId)

    const renamed = await apply(
      workspaceId,
      { 'credentials.ts': CREDENTIALS(), 'workflows/notify/workflow.ts': NOTIFY },
      { base: legacy.base }
    )

    expect(findings(renamed.diagnostics)).toEqual([])
    expect(actions(renamed.applied)).toEqual(['adopt credential:slack', 'create workflow:notify'])
    expect(await boundKey(workspaceId, 'slack')).toBe(slackId)
    expect(await boundKey(workspaceId, 'legacy')).toBeUndefined()
  })

  check(
    'binding, rebinding and releasing a credential key each record who moved it where',
    async () => {
      const workspaceId = await newWorkspace()
      const acmeId = await addSlackCredential(workspaceId, 'Acme Slack')
      const opsId = await addSlackCredential(workspaceId, 'Ops Slack')
      const picking = (name: string) => ({
        'credentials.ts': CREDENTIALS(`{ provider: 'slack', name: '${name}' }`),
      })
      const bound = await apply(workspaceId, picking('Acme Slack'))
      const rebound = await apply(workspaceId, picking('Ops Slack'), { base: bound.base })
      expect(actions(rebound.applied)).toEqual(['update credential:slack'])
      const released = await apply(
        workspaceId,
        {
          'credentials.ts': `// @sim-sdk 1
import { defineCredentials } from '@sim/workflow-sdk/workspace'

export default defineCredentials({})
`,
        },
        { base: rebound.base, allowDelete: true }
      )
      expect(actions(released.applied)).toEqual(['delete credential:slack'])

      await vi.waitFor(async () => {
        const rows = await db
          .select({
            action: auditLog.action,
            actorId: auditLog.actorId,
            resourceId: auditLog.resourceId,
            metadata: auditLog.metadata,
          })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.workspaceId, workspaceId),
              inArray(auditLog.action, ['credential_key.bound', 'credential_key.released'])
            )
          )
          .orderBy(auditLog.createdAt)
        expect(rows).toMatchObject([
          {
            action: 'credential_key.bound',
            actorId: ownerId,
            resourceId: acmeId,
            metadata: { key: 'slack', credentialId: acmeId, previousCredentialId: null },
          },
          {
            action: 'credential_key.bound',
            actorId: ownerId,
            resourceId: opsId,
            metadata: { key: 'slack', credentialId: opsId, previousCredentialId: acmeId },
          },
          {
            action: 'credential_key.released',
            actorId: ownerId,
            resourceId: opsId,
            metadata: { key: 'slack', credentialId: opsId },
          },
        ])
      })
    }
  )

  check(
    'a workflow held for a missing credential key still reports another key it cannot reach',
    async () => {
      const workspaceId = await newWorkspace()
      const opsId = await addSlackCredential(workspaceId, 'Ops Slack')
      const credentials = `// @sim-sdk 1
import { defineCredentials } from '@sim/workflow-sdk/workspace'

export default defineCredentials({
  ops: { provider: 'slack', name: 'Ops Slack' },
  slack: { provider: 'slack', name: 'Missing Slack' },
})
`
      const both = NOTIFY.replace(
        '  start.to(post)',
        `  const relay = slack.sendMessage('Relay', {
    credential: credential('ops'),
    destinationType: 'channel',
    channel: 'ops',
    messageFormat: 'text',
    text: start.text,
  })

  start.to(post)
  start.to(relay)`
      )
      revokedCredentials.add(opsId)

      const result = await apply(workspaceId, {
        'credentials.ts': credentials,
        'workflows/notify/workflow.ts': both,
      }).finally(() => revokedCredentials.delete(opsId))

      expect(held(result.plan)).toEqual(['workflow:notify'])
      expect(findings(result.diagnostics).sort()).toEqual([
        'E_APPLY_CREDENTIAL_UNREACHABLE workflow:notify',
        'E_CREDENTIAL_MISSING workflow:notify',
      ])
    }
  )

  check(
    'a credential key binds only for a writer, and only to a credential the writer sees',
    async () => {
      const workspaceId = await workspaces.create({
        name: 'Workspace source references',
        ownerId,
        members: [
          { userId: readerId, permission: 'read' },
          { userId: writerId, permission: 'write' },
        ],
      })
      const slackId = await addSlackCredential(workspaceId, 'Acme Slack')
      const input = { workspaceId, key: 'slack', credentialId: slackId }

      await expect(bindCredentialKey.execute({ principal: reader, input })).rejects.toMatchObject({
        code: 'forbidden',
      })
      // A shared credential a writer holds no membership of is not theirs to bind or release.
      await expect(bindCredentialKey.execute({ principal: writer, input })).rejects.toMatchObject({
        code: 'not_found',
      })
      expect(await boundKey(workspaceId, 'slack')).toBeUndefined()

      await bindCredentialKey.execute({ principal: owner, input })
      await expect(
        releaseCredentialKey.execute({ principal: writer, input })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(await boundKey(workspaceId, 'slack')).toBe(slackId)
    }
  )

  check('a get prints both files, and applying them back changes nothing', async () => {
    const workspaceId = await newWorkspace()
    await setSecret(workspaceId)
    await addSlackCredential(workspaceId, 'Acme Slack')
    await apply(workspaceId, { 'credentials.ts': CREDENTIALS(), 'secrets.ts': SECRETS() })

    const read = await get(workspaceId)
    expect(read.kinds).toEqual(['secret', 'credential', 'workflow'])
    expect(read.files['secrets.ts']).toBe(SECRETS())
    expect(read.files['credentials.ts']).toBe(CREDENTIALS())
    const again = await apply(workspaceId, read.files, { base: read.base })

    expect(actions(again.plan)).toEqual([])
    expect(again.files['secrets.ts']).toBe(read.files['secrets.ts'])
    expect(again.files['credentials.ts']).toBe(read.files['credentials.ts'])
  })

  check(
    'a get leaves out a secret secrets.ts cannot declare, and the file still applies',
    async () => {
      const workspaceId = await newWorkspace()
      await setSecret(workspaceId)
      await setSecretUseCase.execute({
        principal: owner,
        input: { workspaceId, name: '__proto__', scope: 'workspace', value: SECRET_VALUE },
      })

      const read = await get(workspaceId)
      expect(read.files['secrets.ts']).toBe(SECRETS())
      expect(read.skipped).toMatchObject([{ kind: 'secret', key: '__proto__' }])
      const again = await apply(workspaceId, read.files, { base: read.base, allowDelete: true })
      expect(codes(again.diagnostics.filter((finding) => finding.severity === 'error'))).toEqual([])
      expect(actions(again.plan)).toEqual([])
    }
  )

  check('a read-only member and a workspace API key are refused', async () => {
    const workspaceId = await newWorkspace()
    await setSecret(workspaceId)
    const files = { 'secrets.ts': SECRETS() }

    await expect(apply(workspaceId, files, { principal: reader })).rejects.toThrow()
    const apiKey = createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() })
    const denied = await refusal(apply(workspaceId, files, { principal: apiKey }))
    expect(codes(denied.diagnostics)).toEqual(['E_APPLY_FORBIDDEN'])
  })

  check('no secret value appears in any response or printed file', async () => {
    expect(responses.length).toBeGreaterThan(10)
    expect(JSON.stringify(responses)).not.toContain(SECRET_VALUE)
  })
})
