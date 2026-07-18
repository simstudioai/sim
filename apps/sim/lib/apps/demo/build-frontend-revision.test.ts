import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateRevision, mockBuildProject, mockBuildFallback, mockRestoreDraft } = vi.hoisted(
  () => ({
    mockCreateRevision: vi.fn(),
    mockBuildProject: vi.fn(),
    mockBuildFallback: vi.fn(),
    mockRestoreDraft: vi.fn(),
  })
)

vi.mock('@/lib/apps/revisions', () => ({
  createRevisionWithActions: (...args: unknown[]) => mockCreateRevision(...args),
  restoreDraftRevisionPointer: (...args: unknown[]) => mockRestoreDraft(...args),
}))

vi.mock('@/lib/apps/build/project-build', () => ({
  buildProjectRevision: (...args: unknown[]) => mockBuildProject(...args),
}))

vi.mock('@/lib/apps/demo/frontend-generator', () => ({
  buildFallbackFrontend: (...args: unknown[]) => mockBuildFallback(...args),
}))

import type { BackendHandoff } from '@/lib/apps/demo/backend-handoff'
import { buildDemoFrontendRevision } from '@/lib/apps/demo/build-frontend-revision'

const handoff = {
  actions: [
    {
      actionId: 'profile',
      workflowId: 'wf-1',
      workflowName: 'Profile',
      description: 'Load profile',
      inputSchema: { type: 'object' },
      outputAllowlist: [],
      schemaHash: 'hash',
      action: {
        actionId: 'profile',
        workflowId: 'wf-1',
        deploymentVersionId: '__sim_draft_binding__',
        inputSchema: { type: 'object' },
        outputAllowlist: [],
        executionPolicy: 'sync',
        schemaHash: 'hash',
      },
    },
  ],
} satisfies BackendHandoff

describe('buildDemoFrontendRevision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRestoreDraft.mockResolvedValue(true)
  })

  it('creates and builds a fallback child revision when hosted source does not compile', async () => {
    mockCreateRevision
      .mockResolvedValueOnce({ revisionId: 'hosted-revision' })
      .mockResolvedValueOnce({ revisionId: 'fallback-revision' })
    mockBuildProject
      .mockResolvedValueOnce({ ok: false, error: 'Vite build failed' })
      .mockResolvedValueOnce({ ok: true, buildId: 'fallback-build' })
    mockBuildFallback.mockReturnValue({
      source: 'fallback',
      files: { 'src/App.tsx': 'export function App() { return null }' },
    })
    const onFallback = vi.fn()

    const result = await buildDemoFrontendRevision({
      projectId: 'project-1',
      userId: 'user-1',
      prompt: 'Build an app',
      handoff,
      frontend: {
        source: 'hosted',
        files: { 'src/App.tsx': 'export default function App() { return null }' },
      },
      onFallback,
    })

    expect(result).toEqual({
      ok: true,
      revisionId: 'fallback-revision',
      frontendSource: 'fallback',
    })
    expect(onFallback).toHaveBeenCalledWith('Vite build failed')
    expect(mockCreateRevision).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parentRevisionId: 'hosted-revision',
        files: expect.objectContaining({
          'src/App.tsx': 'export function App() { return null }',
        }),
      })
    )
    expect(mockBuildProject).toHaveBeenCalledTimes(2)
  })

  it('rejects stale expectedRevisionId without writing a child revision', async () => {
    mockCreateRevision.mockRejectedValueOnce(
      new Error('Draft revision changed; reload before writing files')
    )
    const result = await buildDemoFrontendRevision({
      projectId: 'project-1',
      userId: 'user-1',
      prompt: 'make the button blue',
      handoff,
      frontend: {
        source: 'hosted',
        files: { 'src/App.tsx': 'export function App() { return null }' },
      },
      parentRevisionId: 'rev-current',
      expectedRevisionId: 'rev-stale',
      skipFallback: true,
    })

    expect(result).toEqual({
      ok: false,
      revisionId: 'rev-current',
      error: 'Draft revision changed; reload before writing files',
    })
    expect(mockCreateRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevisionId: 'rev-stale',
        parentRevisionId: 'rev-current',
      })
    )
  })

  it('skips fallback rebuild when skipFallback is set', async () => {
    mockCreateRevision.mockResolvedValueOnce({ revisionId: 'hosted-revision' })
    mockBuildProject.mockResolvedValueOnce({ ok: false, error: 'Vite build failed' })

    const result = await buildDemoFrontendRevision({
      projectId: 'project-1',
      userId: 'user-1',
      prompt: 'make the button blue',
      handoff,
      frontend: {
        source: 'hosted',
        files: { 'src/App.tsx': 'export function App() { return null }' },
      },
      parentRevisionId: 'rev-current',
      expectedRevisionId: 'rev-current',
      skipFallback: true,
    })

    expect(result).toEqual({
      ok: false,
      revisionId: 'hosted-revision',
      error: 'Vite build failed',
    })
    expect(mockBuildFallback).not.toHaveBeenCalled()
    expect(mockCreateRevision).toHaveBeenCalledTimes(1)
    expect(mockRestoreDraft).toHaveBeenCalledWith({
      projectId: 'project-1',
      failedRevisionId: 'hosted-revision',
      parentRevisionId: 'rev-current',
    })
  })
})
