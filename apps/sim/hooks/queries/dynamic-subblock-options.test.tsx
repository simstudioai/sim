/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockUseSelectorOptionDetails } = vi.hoisted(() => ({
  mockUseSelectorOptionDetails: vi.fn(),
}))

vi.mock('@/hooks/queries/selectors', () => ({
  useSelectorOptionDetails: mockUseSelectorOptionDetails,
}))

import type { SelectorKey } from '@/lib/selectors/manifest'
import type { SubBlockConfig } from '@/blocks/types'
import { useDynamicSubBlockOptionDisplayName } from '@/hooks/queries/dynamic-subblock-options'
import { selectorKeys } from '@/hooks/queries/utils/selector-keys'

/** Any registered key; the hook only uses it to look the definition up. */
const SELECTOR_KEY = 'workspace.credentialGroupProviders' as SelectorKey

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
    mockUseSelectorOptionDetails.mockReturnValue({
      data: [{ id: 'group-uuid', label: 'Customer support accounts' }],
      isLoading: false,
    })
    const subBlock = {
      id: 'credentialGroup',
      title: 'Credential Group',
      type: 'dropdown',
      selectorKey: SELECTOR_KEY,
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

    expect(mockUseSelectorOptionDetails).toHaveBeenCalledWith(
      SELECTOR_KEY,
      expect.objectContaining({
        detailIds: ['group-uuid'],
        scope: { kind: 'workspace', workspaceId: 'workspace-1' },
      })
    )
  })

  it('summarizes every selected dynamic option without dropping ids', async () => {
    mockUseSelectorOptionDetails.mockReturnValue({
      data: [
        { id: 'gmail', label: 'Gmail' },
        { id: 'slack', label: 'Slack' },
      ],
      isLoading: false,
    })
    const subBlock = {
      id: 'providerFilter',
      title: 'Provider',
      type: 'dropdown',
      multiSelect: true,
      selectorKey: SELECTOR_KEY,
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

  it('re-keys a detail query by opaque revision without including dependency values', () => {
    const scope = { kind: 'workspace', workspaceId: 'workspace-1' } as const
    const keyFor = (revision: number) =>
      selectorKeys.request(
        'workspace.credentialGroupProviders',
        scope,
        'canvas:block-1:providerFilter',
        'detail',
        revision
      )

    expect(keyFor(0)).not.toEqual(keyFor(1))
    expect(keyFor(1)).toEqual(keyFor(1))
    expect(JSON.stringify(keyFor(1))).not.toContain('group-1')
  })
})
