/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  getStatus: vi.fn(),
  getRunFiles: vi.fn(),
  describeRunFiles: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowRunApplicationContext: mocks.resolveContext,
}))
vi.mock('@/lib/workflows/executor/execution-status', () => ({
  getProjectedWorkflowExecutionStatus: mocks.getStatus,
}))
vi.mock('@/lib/workflows/executor/execution-run-files', () => ({
  getWorkflowRunFiles: mocks.getRunFiles,
  describeWorkflowRunFiles: mocks.describeRunFiles,
}))

import { readWorkflowRun } from '@/lib/workflows/application/read-workflow-run'

const context = {
  workflowId: 'workflow-1',
  runId: 'run-1',
  workflow: { id: 'workflow-1', name: 'Daily digest', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const principal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }

const NO_PROJECTION = { hideTraceSpans: false, hideCostInfo: false }

const BLOCK_ID = '2f9c2d4e-1a3b-4c5d-8e7f-0a1b2c3d4e5f'

function input(selectedOutputs: string[]) {
  return { workflowId: 'workflow-1', runId: 'run-1', includeOutput: true, selectedOutputs }
}

/**
 * `logs.cost` and `logs.trace_spans` withhold fields inside a run, and the shared
 * read applies them — but only for the subject this use case names. A workspace
 * API key authorizes as the workspace and represents no user, so it must resolve
 * to none: substituting the key's creator would apply a bystander's group to
 * every caller of a shared credential.
 */
describe('readWorkflowRun projection subject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getRunFiles.mockResolvedValue(null)
    mocks.getStatus.mockResolvedValue({
      status: { status: 'completed', blockOutputs: {} },
      projection: NO_PROJECTION,
    })
  })

  it('names the acting user as the projection subject', async () => {
    await readWorkflowRun.execute({ principal, input: input([]) })

    expect(mocks.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        viewerUserId: 'user-1',
      })
    )
  })

  it('names no subject for a workspace API key', async () => {
    const workspaceKey = {
      kind: 'workspace_api_key' as const,
      workspaceId: 'workspace-1',
      keyId: 'key-1',
    }

    await readWorkflowRun.execute({ principal: workspaceKey, input: input([]) })

    expect(mocks.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({ viewerUserId: undefined })
    )
  })
})

describe('readWorkflowRun selector resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getRunFiles.mockResolvedValue(null)
    mocks.getStatus.mockResolvedValue({
      status: { status: 'completed', blockOutputs: {} },
      projection: NO_PROJECTION,
    })
  })

  it('rejects a block-name selector against a recorded output projection', async () => {
    mocks.getStatus.mockResolvedValue({
      status: { status: 'completed', blockOutputs: { [BLOCK_ID]: { content: 'hi' } } },
      projection: NO_PROJECTION,
    })
    await expect(
      readWorkflowRun.execute({ principal, input: input(['Agent 1']) })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('did not resolve to any block on this run: Agent 1'),
    })
  })

  /**
   * The regression: a queued or resuming run records no output projection yet,
   * so a name-headed selector used to be waved through and answer 200 with
   * nothing selected — the silent empty answer the check exists to remove.
   */
  it('rejects a block-name selector on a run with no recorded output projection', async () => {
    mocks.getStatus.mockResolvedValue({
      status: { status: 'queued', blockOutputs: null },
      projection: NO_PROJECTION,
    })
    await expect(readWorkflowRun.execute({ principal, input: input(['Agent 1']) })).rejects.toThrow(
      /did not resolve to any block on this run: Agent 1/
    )
  })

  it('accepts a well-formed block id on a run with no recorded output projection', async () => {
    mocks.getStatus.mockResolvedValue({
      status: { status: 'queued', blockOutputs: null },
      projection: NO_PROJECTION,
    })
    await expect(
      readWorkflowRun.execute({ principal, input: input([`${BLOCK_ID}.content`]) })
    ).resolves.toMatchObject({ status: 'queued', blockOutputs: null })
  })

  it('accepts a well-formed block id that produced no output', async () => {
    await expect(
      readWorkflowRun.execute({ principal, input: input([BLOCK_ID]) })
    ).resolves.toMatchObject({ status: 'completed', blockOutputs: {} })
  })
})

/**
 * A run's output files are its execution data: the descriptors name what the
 * run produced and `includeFileBase64` returns the bytes. When the viewer's
 * group withholds execution data under `logs.trace_spans`, the file list has to
 * go with `finalOutput` and `blockOutputs` — otherwise the withheld output
 * comes back one field over.
 */
describe('readWorkflowRun file projection', () => {
  const WITHHELD = { hideTraceSpans: true, hideCostInfo: false }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getRunFiles.mockResolvedValue({
      terminal: true,
      workspaceId: 'workspace-1',
      filesById: new Map([['file-1', { key: 'k', name: 'out.csv' }]]),
    })
    mocks.describeRunFiles.mockResolvedValue([{ id: 'file-1', name: 'out.csv' }])
  })

  it('lists the run files when nothing is withheld', async () => {
    mocks.getStatus.mockResolvedValue({
      status: { status: 'completed', blockOutputs: {}, finalOutput: { ok: true } },
      projection: NO_PROJECTION,
    })

    await expect(readWorkflowRun.execute({ principal, input: input([]) })).resolves.toMatchObject({
      files: [{ id: 'file-1' }],
    })
  })

  it('withholds the file list when the group withholds execution data', async () => {
    mocks.getStatus.mockResolvedValue({
      status: { status: 'completed', blockOutputs: null, finalOutput: null },
      projection: WITHHELD,
    })

    await expect(readWorkflowRun.execute({ principal, input: input([]) })).resolves.toMatchObject({
      files: null,
    })
  })

  it('does not read the run files at all when the group withholds execution data', async () => {
    mocks.getStatus.mockResolvedValue({
      status: { status: 'completed', blockOutputs: null, finalOutput: null },
      projection: WITHHELD,
    })

    await readWorkflowRun.execute({
      principal,
      input: { ...input([]), includeFileBase64: true },
    })

    expect(mocks.getRunFiles).not.toHaveBeenCalled()
    expect(mocks.describeRunFiles).not.toHaveBeenCalled()
  })
})
