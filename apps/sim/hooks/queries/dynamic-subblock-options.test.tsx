/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockGetSelectorDefinition } = vi.hoisted(() => ({
  mockGetSelectorDefinition: vi.fn(),
}))

vi.mock('@/hooks/selectors/registry', () => ({
  getSelectorDefinition: mockGetSelectorDefinition,
}))

import type { SubBlockConfig } from '@/blocks/types'
import {
  dynamicSubBlockOptionKeys,
  useDynamicSubBlockOptionDisplayName,
} from '@/hooks/queries/dynamic-subblock-options'
import type { SelectorDefinition, SelectorKey } from '@/hooks/selectors/types'

/** Any registered key; the hook only uses it to look the definition up. */
const SELECTOR_KEY = 'workspace.credentialGroups' as SelectorKey

function mockDefinition(definition: Partial<SelectorDefinition>) {
  mockGetSelectorDefinition.mockReturnValue(definition as SelectorDefinition)
}

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
    const fetchById = vi.fn(async ({ detailId }: { detailId?: string }) => ({
      id: detailId as string,
      label: 'Customer support accounts',
    }))
    mockDefinition({ key: SELECTOR_KEY, getQueryKey: () => [SELECTOR_KEY], fetchById })
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

    expect(fetchById).toHaveBeenCalledWith(
      expect.objectContaining({ detailId: 'group-uuid', context: { workspaceId: 'workspace-1' } })
    )
  })

  it('summarizes every selected dynamic option without dropping ids', async () => {
    const fetchById = vi.fn(async ({ detailId }: { detailId?: string }) => ({
      id: detailId as string,
      label: detailId === 'gmail' ? 'Gmail' : 'Slack',
    }))
    mockDefinition({ key: SELECTOR_KEY, getQueryKey: () => [SELECTOR_KEY], fetchById })
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

  it('re-resolves a label when the sibling its selector depends on changes', () => {
    // The bug: `fetchById` reads sibling context, but the cache key did not, so a label
    // resolved before a credential group was picked (null) stayed cached after it was, and the
    // card kept showing the raw id. The key now carries the selector's OWN query key, which
    // names every context field its result depends on.
    const keyFor = (credentialGroupId?: string) =>
      dynamicSubBlockOptionKeys.detail('workspace-1', 'block-1', 'providerFilter', 'gmail', [
        'selectors',
        'workspace.credentialGroupProviders',
        'workspace-1',
        credentialGroupId ?? 'none',
      ])

    expect(keyFor(undefined)).not.toEqual(keyFor('group-1'))
    expect(keyFor('group-1')).not.toEqual(keyFor('group-2'))
    expect(keyFor('group-1')).toEqual(keyFor('group-1'))
  })
})
