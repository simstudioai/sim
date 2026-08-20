/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'
import { credentialGroupKeys } from '@/hooks/queries/utils/credential-group-queries'
import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorKey } from '@/hooks/selectors/types'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

const { requestJsonMock, capturedSignals, pending, getTestQueryClient, setTestQueryClient } =
  vi.hoisted(() => {
    const capturedSignals: Array<AbortSignal | undefined> = []
    const pending: PendingRequest[] = []
    let client: unknown = null
    return {
      capturedSignals,
      pending,
      getTestQueryClient: () => client,
      setTestQueryClient: (next: unknown) => {
        client = next
      },
      requestJsonMock: vi.fn((_contract: unknown, input: { signal?: AbortSignal }) => {
        capturedSignals.push(input.signal)
        return new Promise((resolve, reject) => {
          pending.push({ resolve, reject })
          input.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
      }),
    }
  })

vi.mock('@/lib/api/client/request', () => ({ requestJson: requestJsonMock }))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: () => getTestQueryClient(),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({ hydration: { workspaceId: 'workspace-1' }, activeWorkflowId: null }),
  },
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: { getState: () => ({ workflowValues: {} }) },
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: { getState: () => ({ blocks: {} }) },
}))

import { CredentialGroupBlock } from '@/blocks/blocks/credential-group'

const WORKSPACE_ID = 'workspace-1'
const WORKSPACE_LIST_KEY = credentialGroupKeys.list(WORKSPACE_ID)

const GROUPS = [
  {
    id: 'group-1',
    name: 'Support accounts',
    status: 'active',
    options: [],
  },
]

function getCredentialGroupSubBlock(): SubBlockConfig {
  const subBlock = CredentialGroupBlock.subBlocks.find((entry) => entry.id === 'credentialGroup')
  if (!subBlock) throw new Error('credentialGroup subBlock is missing')
  return subBlock
}

async function waitForRequestCount(count: number) {
  await vi.waitFor(() => expect(capturedSignals.length).toBe(count), { interval: 1, timeout: 1000 })
}

describe('credential group dynamic option resolution', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    capturedSignals.length = 0
    pending.length = 0
    requestJsonMock.mockClear()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    setTestQueryClient(queryClient)
  })

  afterEach(() => {
    queryClient.clear()
  })

  it('keeps the shared workspace credential-group list alive when one option resolution is cancelled', async () => {
    const definition = getSelectorDefinition(
      getCredentialGroupSubBlock().selectorKey as SelectorKey
    )
    const context = { workspaceId: WORKSPACE_ID }
    const fetchOptionById = (_b: string, id: string, signal?: AbortSignal) =>
      definition.fetchById?.({ key: definition.key, context, detailId: id, signal })
    const fetchOptions = () => definition.fetchList?.({ key: definition.key, context })

    const controller = new AbortController()
    const optionResolution = Promise.resolve(
      fetchOptionById('block-1', 'group-1', controller.signal)
    ).catch(() => null)

    await waitForRequestCount(1)

    const sharedListConsumer = fetchOptions()

    controller.abort()
    await Promise.resolve()

    pending[0].resolve({ credentialGroups: GROUPS })

    await expect(sharedListConsumer).resolves.toEqual([
      { label: 'Support accounts', id: 'group-1' },
    ])
    expect(queryClient.getQueryState(WORKSPACE_LIST_KEY)?.status).not.toBe('error')

    await optionResolution
  })

  it('still cancels the underlying request when React Query cancels the shared list query', async () => {
    const definition = getSelectorDefinition(
      getCredentialGroupSubBlock().selectorKey as SelectorKey
    )
    const fetchOptionById = (_b: string, id: string, signal?: AbortSignal) =>
      definition.fetchById?.({
        key: definition.key,
        context: { workspaceId: WORKSPACE_ID },
        detailId: id,
        signal,
      })

    const controller = new AbortController()
    const optionResolution = Promise.resolve(
      fetchOptionById('block-1', 'group-1', controller.signal)
    ).catch(() => null)

    await waitForRequestCount(1)

    await queryClient.cancelQueries({ queryKey: WORKSPACE_LIST_KEY })

    expect(capturedSignals[0]?.aborted).toBe(true)

    await optionResolution
  })
})
