/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'
import { useDynamicSubBlockOptionDisplayName } from '@/hooks/queries/dynamic-subblock-options'

interface HookHarness<T> {
  result: () => T
  unmount: () => void
}

function renderHookWithClient<T>(useHook: () => T): HookHarness<T> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest!: T

  function Probe() {
    latest = useHook()
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  })

  return {
    result: () => latest,
    unmount: () => act(() => root.unmount()),
  }
}

async function waitForResult(assertion: () => void) {
  await act(async () => {
    await vi.waitFor(assertion, { interval: 1 })
  })
}

describe('useDynamicSubBlockOptionDisplayName', () => {
  const mounted: Array<() => void> = []

  afterEach(() => {
    mounted.splice(0).forEach((unmount) => unmount())
    vi.clearAllMocks()
  })

  it('hydrates a stored dynamic dropdown id to its label', async () => {
    const fetchOptionById = vi.fn(async (_blockId: string, optionId: string) => ({
      id: optionId,
      label: 'Customer support accounts',
    }))
    const subBlock = {
      id: 'credentialGroup',
      title: 'Credential Group',
      type: 'dropdown',
      options: [],
      fetchOptionById,
    } satisfies SubBlockConfig

    const hook = renderHookWithClient(() =>
      useDynamicSubBlockOptionDisplayName({
        workspaceId: 'workspace-1',
        blockId: 'block-1',
        subBlock,
        value: 'group-uuid',
      })
    )
    mounted.push(hook.unmount)

    await waitForResult(() => expect(hook.result()).toBe('Customer support accounts'))

    expect(fetchOptionById).toHaveBeenCalledWith('block-1', 'group-uuid', expect.any(AbortSignal))
  })

  it('summarizes every selected dynamic option without dropping ids', async () => {
    const fetchOptionById = vi.fn(async (_blockId: string, optionId: string) => ({
      id: optionId,
      label: optionId === 'gmail' ? 'Gmail' : 'Slack',
    }))
    const subBlock = {
      id: 'providerFilter',
      title: 'Provider',
      type: 'dropdown',
      options: [],
      multiSelect: true,
      fetchOptionById,
    } satisfies SubBlockConfig

    const hook = renderHookWithClient(() =>
      useDynamicSubBlockOptionDisplayName({
        workspaceId: 'workspace-1',
        blockId: 'block-1',
        subBlock,
        value: ['gmail', 'slack'],
      })
    )
    mounted.push(hook.unmount)

    await waitForResult(() => expect(hook.result()).toBe('Gmail, Slack'))
  })
})
