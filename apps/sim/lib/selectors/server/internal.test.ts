/**
 * @vitest-environment node
 */
import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockListWorkflows = vi.hoisted(() => vi.fn())
const mockFetchOpenRouterEmbeddingModelCatalog = vi.hoisted(() => vi.fn())

vi.mock('@/lib/workflows/application/list-workflows', () => ({
  listWorkflows: { execute: mockListWorkflows },
}))

vi.mock('@/lib/embeddings/openrouter-model-catalog.server', () => ({
  fetchOpenRouterEmbeddingModelCatalog: mockFetchOpenRouterEmbeddingModelCatalog,
}))

import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'
import { internalSelectorAttachments } from '@/lib/selectors/server/internal'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function workflowArgs(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'sim.workflows',
    context: {},
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('workspace.secretNames selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEnvironmentUtilsMock()
  })

  it('returns the ACL-filtered names without loading the decrypted environment snapshot', async () => {
    environmentUtilsMockFns.mockGetEffectiveEnvironmentVariableNames.mockResolvedValue([
      'PERSONAL_KEY',
      'SHARED_KEY',
    ])

    await expect(
      internalSelectorAttachments['workspace.secretNames'].execute({
        selectorKey: 'workspace.secretNames',
        context: {},
        request: { kind: 'list' },
        scope: { kind: 'workspace', workspaceId: 'workspace-1' },
        workspaceId: 'workspace-1',
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        requesterUserId: 'user-1',
        references: new Map(),
        protectedValues: createSelectorProtectedValues(),
      })
    ).resolves.toEqual({
      kind: 'list',
      items: [
        { id: 'PERSONAL_KEY', label: 'PERSONAL_KEY' },
        { id: 'SHARED_KEY', label: 'SHARED_KEY' },
      ],
    })

    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentVariableNames).toHaveBeenCalledWith(
      'user-1',
      'workspace-1'
    )
    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
  })
})

describe('sim.workflows selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('continues beyond the former 5,000-workflow limit', async () => {
    for (let page = 0; page < 20; page += 1) {
      mockListWorkflows.mockResolvedValueOnce({
        workflows: [],
        nextCursorKeys: [`page-${page + 1}`],
      })
    }
    mockListWorkflows.mockResolvedValueOnce({
      workflows: [{ id: 'workflow-late', name: 'Late workflow', folderPath: '/' }],
      nextCursorKeys: null,
    })

    await expect(
      internalSelectorAttachments['sim.workflows'].execute(workflowArgs())
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'workflow-late', label: 'Late workflow' }],
    })
    expect(mockListWorkflows).toHaveBeenCalledTimes(21)
  })

  it('fails rather than returning a partial list after 10,000 workflows', async () => {
    const workflowPage = Array.from({ length: 250 }, (_, index) => ({
      id: `workflow-${index}`,
      name: `Workflow ${index}`,
      folderPath: '/',
    }))
    mockListWorkflows.mockResolvedValue({
      workflows: workflowPage,
      nextCursorKeys: ['more'],
    })

    await expect(
      internalSelectorAttachments['sim.workflows'].execute(workflowArgs())
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
    expect(mockListWorkflows).toHaveBeenCalledTimes(40)
  })
})

describe('providers.openrouterEmbeddingModels selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEnvironmentUtilsMock()
  })

  it('passes the selector signal to the OpenRouter catalog fetch', async () => {
    const controller = new AbortController()
    mockFetchOpenRouterEmbeddingModelCatalog.mockResolvedValue([
      { id: 'openai/text-embedding-3-small', maxInputTokens: 8_191 },
    ])

    await expect(
      internalSelectorAttachments['providers.openrouterEmbeddingModels'].execute({
        ...workflowArgs(),
        selectorKey: 'providers.openrouterEmbeddingModels',
        signal: controller.signal,
      })
    ).resolves.toEqual({
      kind: 'list',
      items: [
        {
          id: 'openai/text-embedding-3-small',
          label: 'openai/text-embedding-3-small',
        },
      ],
    })

    expect(mockFetchOpenRouterEmbeddingModelCatalog).toHaveBeenCalledOnce()
    expect(mockFetchOpenRouterEmbeddingModelCatalog).toHaveBeenCalledWith(controller.signal)
  })
})
