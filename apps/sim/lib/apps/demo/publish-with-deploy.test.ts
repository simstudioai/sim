import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockStopPreview = vi.fn()
const mockPerformFullDeploy = vi.fn()
const mockBuildBound = vi.fn()
const mockCreateRevision = vi.fn()
const mockBuildProject = vi.fn()
const mockPrepare = vi.fn()
const mockPublish = vi.fn()
const mockAssertPermission = vi.fn()

vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}))

vi.mock('@sim/db/schema', () => ({
  appBuild: {},
  appPreviewSession: { id: 'id', projectId: 'projectId', stoppedAt: 'stoppedAt' },
  appProject: {},
  appRevisionAction: {},
  appSourceBlob: { content: 'content', hash: 'hash' },
  appSourceFile: { path: 'path', contentHash: 'contentHash', revisionId: 'revisionId' },
  appSourceRevision: {},
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  desc: (v: unknown) => v,
  eq: (...args: unknown[]) => args,
  isNull: (v: unknown) => v,
}))

vi.mock('@/lib/apps/pins', () => ({
  stopActivePreviewSessionsForProject: (...args: unknown[]) => mockStopPreview(...args),
}))

vi.mock('@/lib/apps/permissions', () => ({
  assertAppPermission: (...args: unknown[]) => mockAssertPermission(...args),
}))

vi.mock('@/lib/workflows/orchestration/deploy', () => ({
  performFullDeploy: (...args: unknown[]) => mockPerformFullDeploy(...args),
}))

vi.mock('@/lib/apps/bind-actions', () => ({
  buildBoundActionEntry: (...args: unknown[]) => mockBuildBound(...args),
}))

vi.mock('@/lib/apps/revisions', () => ({
  createRevisionWithActions: (...args: unknown[]) => mockCreateRevision(...args),
}))

vi.mock('@/lib/apps/build/project-build', () => ({
  buildProjectRevision: (...args: unknown[]) => mockBuildProject(...args),
}))

vi.mock('@/lib/apps/prepare-release', () => ({
  prepareProjectRelease: (...args: unknown[]) => mockPrepare(...args),
}))

vi.mock('@/lib/apps/publish', () => ({
  publishPreparedRelease: (...args: unknown[]) => mockPublish(...args),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: () => 'req-1',
}))

import { DRAFT_DEPLOYMENT_VERSION_SENTINEL } from '@/lib/apps/draft-binding'
import { publishProjectWithDeploy } from '@/lib/apps/demo/publish-with-deploy'

function chain(result: unknown[]) {
  const api: Record<string, unknown> = {}
  api.from = vi.fn(() => api)
  api.where = vi.fn(() => api)
  api.innerJoin = vi.fn(() => api)
  api.orderBy = vi.fn(() => api)
  api.limit = vi.fn(async () => result)
  api.then = undefined
  // Allow awaiting the builder when no limit is used
  Object.defineProperty(api, Symbol.toStringTag, { value: 'Chain' })
  ;(api as { [Symbol.asyncIterator]?: unknown })
  // Make thenable for `await db.select()...where()`
  ;(api as { then: typeof Promise.prototype.then }).then = (resolve, reject) =>
    Promise.resolve(result).then(resolve, reject)
  return api
}

describe('publishProjectWithDeploy order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertPermission.mockResolvedValue({ ok: true })
    mockStopPreview.mockResolvedValue(undefined)
  })

  it('deploys → rebinds → rebuilds → prepares → publishes, and leaves pointer unchanged on prepare failure', async () => {
    const project = {
      id: 'project-1',
      workspaceId: 'ws-1',
      draftRevisionId: 'rev-1',
      version: 3,
      name: 'Demo',
    }
    const actions = [
      {
        actionId: 'a',
        workflowId: 'wf-1',
        deploymentVersionId: DRAFT_DEPLOYMENT_VERSION_SENTINEL,
        outputAllowlist: [],
      },
      {
        actionId: 'b',
        workflowId: 'wf-2',
        deploymentVersionId: DRAFT_DEPLOYMENT_VERSION_SENTINEL,
        outputAllowlist: [],
      },
    ]

    mockSelect
      .mockReturnValueOnce(chain([project])) // project
      .mockReturnValueOnce(chain(actions)) // actions
      .mockReturnValueOnce(chain([{ id: 'rev-1' }])) // revision exists
      .mockReturnValueOnce(
        chain([
          { path: 'src/App.tsx', content: 'export function App(){return null}' },
        ])
      ) // files
      .mockReturnValueOnce(chain([{ version: 4 }])) // fresh project version (unused on prepare fail)

    mockPerformFullDeploy
      .mockResolvedValueOnce({ success: true, deploymentVersionId: 'dv-1' })
      .mockResolvedValueOnce({ success: true, deploymentVersionId: 'dv-2' })

    mockBuildBound.mockImplementation(async ({ request }: { request: { actionId: string } }) => ({
      ok: true,
      action: {
        actionId: request.actionId,
        workflowId: request.actionId === 'a' ? 'wf-1' : 'wf-2',
        deploymentVersionId: request.actionId === 'a' ? 'dv-1' : 'dv-2',
        inputSchema: { type: 'object' },
        outputAllowlist: [],
        executionPolicy: 'sync',
        schemaHash: 'h',
      },
    }))

    mockCreateRevision.mockResolvedValue({ revisionId: 'rev-2' })
    mockBuildProject.mockResolvedValue({ ok: true, buildId: 'build-2' })
    mockPrepare.mockResolvedValue({
      ok: false,
      error: 'prepare failed',
      code: 'PREPARE_FAILED',
      status: 400,
    })

    const result = await publishProjectWithDeploy({
      projectId: 'project-1',
      userId: 'user-1',
      expectedVersion: 3,
    })

    expect(mockPerformFullDeploy).toHaveBeenCalledTimes(2)
    expect(mockCreateRevision).toHaveBeenCalled()
    expect(mockBuildProject).toHaveBeenCalled()
    expect(mockPrepare).toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.partialDeployments).toEqual([
      { workflowId: 'wf-1', deploymentVersionId: 'dv-1' },
      { workflowId: 'wf-2', deploymentVersionId: 'dv-2' },
    ])
  })
})
