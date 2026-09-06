/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  permission: vi.fn(),
  snapshot: vi.fn(),
  report: vi.fn(),
  secrets: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))
vi.mock('@/lib/workflows/queries', () => ({ loadWorkflowReadSnapshot: mocks.snapshot }))
vi.mock('@/lib/workflows/editing/lint-report', () => ({ buildWorkflowLintReport: mocks.report }))
vi.mock('@/lib/secrets/application/use-cases', () => ({
  listSecretsUseCase: { execute: mocks.secrets },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { workflowLintCommand } from '@/lib/mothership/agent-cli/engines/lint'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'
import { readWorkflowLint } from '@/lib/workflows/application/read-workflow-lint'

const graph = {
  blocks: {
    start: {
      id: 'start',
      type: 'starter',
      name: 'Start',
      enabled: true,
      position: { x: 0, y: 0 },
      outputs: {},
      subBlocks: { note: { id: 'note', type: 'long-input', value: '{{WORKFLOW_KEY}}' } },
    },
  },
  edges: [],
  loops: {},
  parallels: {},
  variables: {},
}
const principal = {
  kind: 'personal_api_key' as const,
  userId: 'authenticated-user',
  keyId: 'key-1',
}
const request = vi.fn(
  async <T>(path: string): Promise<T> =>
    (path.endsWith('/state') ? { data: graph } : { data: [], nextCursor: null }) as T
)
const runtime: AgentCliRuntime = {
  workspaceId: 'chat-workspace',
  userId: 'runtime-user',
  principal,
  client: { request },
}

describe('Mothership workflow lint scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue({
      workflowId: 'wf-1',
      workspaceId: 'workflow-workspace',
      workflow: { id: 'wf-1', workspaceId: 'workflow-workspace' },
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    })
    mocks.permission.mockResolvedValue('read')
    mocks.snapshot.mockResolvedValue({ workflowRecord: { id: 'wf-1' }, normalizedData: graph })
    mocks.report.mockResolvedValue({
      sources: [],
      sinks: [],
      orphanBlocks: [],
      emptyOutgoingPorts: [],
      invalidBranchPorts: [],
      invalidConnectionTargets: [],
      fieldIssues: [],
      unresolvedReferences: [],
      tableFieldIssues: [],
      notes: [],
    })
    mocks.secrets.mockResolvedValue({ secrets: [{ envKey: 'WORKFLOW_KEY' }], nextCursorKeys: null })
  })

  it('uses the authorized workflow workspace and authenticated subject for every diagnostic lookup', async () => {
    const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
    expect(result.exitCode).toBe(0)
    expect(mocks.report).toHaveBeenCalledWith(
      expect.objectContaining({ blocks: graph.blocks }),
      {
        workflowId: 'wf-1',
        workspaceId: 'workflow-workspace',
        subjectUserId: 'authenticated-user',
      },
      expect.objectContaining({ requireComplete: true })
    )
    expect(mocks.secrets).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: expect.objectContaining({ workspaceId: 'workflow-workspace' }),
      })
    )
    expect(JSON.parse(result.stdout).undeclaredEnvVars).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })

  it('follows more than ten secret pages and stops once every referenced name is found', async () => {
    mocks.secrets.mockImplementation(async ({ input }: { input: { cursorKeys?: number[] } }) => {
      const page = input.cursorKeys?.[0] ?? 0
      return {
        secrets: [{ envKey: page < 10 ? `OTHER_${page}` : 'WORKFLOW_KEY' }],
        nextCursorKeys: [page + 1],
      }
    })
    const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).undeclaredEnvVars).toEqual([])
    expect(mocks.secrets).toHaveBeenCalledTimes(11)
    for (const [call] of mocks.secrets.mock.calls) {
      expect(call.principal).toBe(principal)
      expect(call.input.workspaceId).toBe('workflow-workspace')
    }
  })

  it('reports missing names and other findings together after exhausting visible inventory', async () => {
    mocks.secrets.mockResolvedValue({ secrets: [], nextCursorKeys: null })
    const base = await mocks.report()
    mocks.report.mockResolvedValue({
      ...base,
      fieldIssues: [
        {
          blockId: 'agent',
          blockName: 'Agent',
          missingRequiredFields: ['model'],
          inactiveModeValues: [],
        },
      ],
    })
    const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.undeclaredEnvVars).toEqual([{ name: 'WORKFLOW_KEY', blocks: ['Start'] }])
    expect(report.summary).toContain('Blocks missing required fields:')
    expect(report.summary).toContain(
      'Referenced secrets are not visible to this caller: WORKFLOW_KEY'
    )
    expect(report.summary).not.toContain('EMPTY STRING')
  })

  it('fails an incomplete diagnostic if the secret cursor repeats', async () => {
    mocks.secrets.mockResolvedValue({ secrets: [], nextCursorKeys: ['same'] })
    const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('could not complete')
    expect(mocks.secrets).toHaveBeenCalledTimes(2)
  })

  it.each(['The graph has no blocks.', 'No entry block: nothing can start this workflow.'])(
    'preserves a graph note in the diagnostic summary: %s',
    async (note) => {
      const base = await mocks.report()
      mocks.report.mockResolvedValue({ ...base, notes: [note] })
      const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).summary).toBe(note)
    }
  )

  it('does not equate a complete static check with a working workflow', async () => {
    const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).summary).toBe(
      'No issues found in supported static checks. Code, external resources and runtime behaviour are not verified.'
    )
  })

  it('skips secret reads when the graph references no secrets', async () => {
    mocks.snapshot.mockResolvedValue({ workflowRecord: { id: 'wf-1' }, normalizedData: null })
    const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
    expect(result.exitCode).toBe(0)
    expect(mocks.secrets).not.toHaveBeenCalled()
    expect(mocks.report).toHaveBeenCalledWith(
      expect.objectContaining({ blocks: {}, edges: [] }),
      expect.anything(),
      expect.objectContaining({ requireComplete: true })
    )
  })

  it.each(['read', 'write', 'admin'])('allows a human API caller with %s access', async (role) => {
    mocks.permission.mockResolvedValue(role)
    await expect(
      readWorkflowLint.execute({ principal, input: { workflowId: 'wf-1' } })
    ).resolves.toMatchObject({ undeclaredEnvVars: [] })
    expect(mocks.permission).toHaveBeenCalledWith(
      principal.userId,
      'workflow-workspace',
      null,
      undefined,
      { forUpdate: undefined }
    )
  })

  it('also accepts a session and uses its subject rather than the billing owner', async () => {
    const session = { kind: 'session' as const, userId: 'session-user', sessionId: 'session-1' }
    await readWorkflowLint.execute({ principal: session, input: { workflowId: 'wf-1' } })
    expect(mocks.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subjectUserId: session.userId,
      }),
      expect.objectContaining({ requireComplete: true })
    )
    expect(mocks.secrets).toHaveBeenCalledWith(expect.objectContaining({ principal: session }))
  })

  it('refuses an actorless workspace key before canonical loading', async () => {
    await expect(
      readWorkflowLint.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workflow-workspace',
          keyId: 'workspace-key',
        },
        input: { workflowId: 'wf-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveContext).not.toHaveBeenCalled()
    expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(mocks.report).not.toHaveBeenCalled()
    expect(mocks.secrets).not.toHaveBeenCalled()
  })

  it('does not substitute a delegated principal for a human secret-list identity', async () => {
    await expect(
      readWorkflowLint.execute({
        principal: {
          kind: 'delegated',
          serviceId: 'copilot',
          workspaceId: 'workflow-workspace',
          subjectUserId: 'authenticated-user',
          delegationId: 'delegation-1',
          audience: 'copilot',
          issuedAt: new Date(0),
          expiresAt: new Date(8640000000000000),
        },
        input: { workflowId: 'wf-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it('honors a workspace policy that disables personal API keys', async () => {
    const context = await mocks.resolveContext()
    mocks.resolveContext.mockResolvedValue({ ...context, allowPersonalApiKeys: false })
    const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
    expect(result.exitCode).toBe(1)
    expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(mocks.report).not.toHaveBeenCalled()
    expect(mocks.secrets).not.toHaveBeenCalled()
  })

  it.each(['canonical lookup', 'graph read'])(
    'conceals workflow absence during %s',
    async (stage) => {
      if (stage === 'canonical lookup')
        mocks.resolveContext.mockRejectedValueOnce(
          new OrchestrationError('not_found', 'Workflow not found')
        )
      else mocks.snapshot.mockResolvedValueOnce({ workflowRecord: null, normalizedData: null })
      const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('Error: Workflow not found or not accessible.')
      expect(mocks.report).not.toHaveBeenCalled()
      expect(mocks.secrets).not.toHaveBeenCalled()
    }
  )

  it('conceals missing access without reading the graph or dependencies', async () => {
    mocks.permission.mockResolvedValue(null)
    const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('Error: Workflow not found or not accessible.')
    expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(mocks.report).not.toHaveBeenCalled()
    expect(mocks.secrets).not.toHaveBeenCalled()
  })

  it('stops if secret access is revoked between inventory pages', async () => {
    mocks.secrets
      .mockResolvedValueOnce({ secrets: [], nextCursorKeys: ['next'] })
      .mockRejectedValueOnce(new OrchestrationError('forbidden', 'Secret access revoked'))
    const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(mocks.secrets).toHaveBeenCalledTimes(2)
  })

  it.each(['context', 'permission', 'snapshot', 'report', 'secrets'])(
    'keeps private %s failures out of model output',
    async (stage) => {
      const lookup = {
        context: mocks.resolveContext,
        permission: mocks.permission,
        snapshot: mocks.snapshot,
        report: mocks.report,
        secrets: mocks.secrets,
      }[stage]
      lookup?.mockRejectedValueOnce(new Error('private database and credential details'))
      const result = await workflowLintCommand.execute(['wf-1'], runtime, {})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('could not complete')
      expect(result.stderr).not.toContain('private')
    }
  )

  it.each(['before', 'graph', 'references', 'inventory'])(
    'cancellation at %s stops further diagnostic work',
    async (stage) => {
      const controller = new AbortController()
      if (stage === 'before') controller.abort()
      if (stage === 'graph')
        mocks.snapshot.mockImplementationOnce(async () => {
          controller.abort()
          return { workflowRecord: { id: 'wf-1' }, normalizedData: graph }
        })
      if (stage === 'references') {
        const base = await mocks.report()
        mocks.report.mockImplementationOnce(async () => {
          controller.abort()
          return base
        })
        mocks.report.mockClear()
      }
      if (stage === 'inventory')
        mocks.secrets.mockImplementationOnce(async () => {
          controller.abort()
          return { secrets: [], nextCursorKeys: ['next'] }
        })
      const result = await workflowLintCommand.execute(
        ['wf-1'],
        { ...runtime, signal: controller.signal },
        {}
      )
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('cancelled')
      if (stage === 'before') expect(mocks.resolveContext).not.toHaveBeenCalled()
      if (stage === 'before' || stage === 'graph') expect(mocks.report).not.toHaveBeenCalled()
      expect(mocks.secrets).toHaveBeenCalledTimes(stage === 'inventory' ? 1 : 0)
    }
  )

  it('does not start an application read without authenticated identity or a workflow target', async () => {
    expect((await workflowLintCommand.execute([], runtime, {})).exitCode).toBe(1)
    expect(
      (await workflowLintCommand.execute(['wf-1'], { ...runtime, principal: undefined }, {}))
        .exitCode
    ).toBe(1)
    expect(mocks.resolveContext).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })
})
