/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockUseDependsOnGate } = vi.hoisted(() => ({
  mockUseDependsOnGate: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1', workflowId: 'workflow-1' }),
}))

vi.mock('@/hooks/queries/environment', () => ({
  usePersonalEnvironment: () => ({ data: {} }),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (selector: (state: { activeWorkflowId: string }) => unknown) =>
    selector({ activeWorkflowId: 'workflow-1' }),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate',
  () => ({ useDependsOnGate: mockUseDependsOnGate })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({ useSubBlockValue: () => [null, vi.fn()] })
)

import { buildCanonicalIndex, resolveDependencyValue } from '@/lib/workflows/subblocks/visibility'
import { useSelectorSetup } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-selector-setup'
import { PlaidBlock } from '@/blocks/blocks/plaid'
import type { SubBlockConfig } from '@/blocks/types'
import { getSelectorDefinition } from '@/hooks/selectors/registry'

interface HookHarness<T> {
  result: () => T
  unmount: () => void
}

function renderHook<T>(useHook: () => T): HookHarness<T> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest!: T

  function Probe() {
    latest = useHook()
    return null
  }

  act(() => root.render(<Probe />))

  return {
    result: () => latest,
    unmount: () => act(() => root.unmount()),
  }
}

function getPlaidSubBlock(id: string): SubBlockConfig {
  const subBlock = PlaidBlock.subBlocks.find((candidate) => candidate.id === id)
  if (!subBlock) throw new Error(`Missing Plaid subblock: ${id}`)
  return subBlock
}

const canonicalIndex = buildCanonicalIndex(PlaidBlock.subBlocks)

describe('useSelectorSetup with Plaid selectors', () => {
  const mounted: Array<() => void> = []

  afterEach(() => {
    mounted.splice(0).forEach((unmount) => unmount())
    vi.clearAllMocks()
  })

  it.each([
    ['basic', { credential: 'basic-credential' }, undefined, 'basic-credential'],
    [
      'advanced',
      { credential: 'basic-credential', manualCredential: 'advanced-credential' },
      { oauthCredential: 'advanced' as const },
      'advanced-credential',
    ],
  ] as const)(
    'maps the resolved %s Plaid credential to oauthCredential',
    (_mode, values, overrides, expectedCredential) => {
      const credential = resolveDependencyValue('credential', values, canonicalIndex, overrides)
      mockUseDependsOnGate.mockReturnValue({
        finalDisabled: false,
        dependencyValues: { credential },
        canonicalIndex,
      })

      const hook = renderHook(() =>
        useSelectorSetup('plaid-block', getPlaidSubBlock('accountIdsSelector'))
      )
      mounted.push(hook.unmount)

      expect(hook.result().selectorContext).toEqual({
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        mimeType: undefined,
        oauthCredential: expectedCredential,
      })
      expect(hook.result().disabled).toBe(false)
    }
  )

  it('enables every Plaid selector from credential context without operation leakage', () => {
    mockUseDependsOnGate.mockReturnValue({
      finalDisabled: false,
      dependencyValues: { credential: 'credential-1', countryCodes: 'US,CA' },
      canonicalIndex,
    })

    for (const [subBlockId, key] of [
      ['institutionSelector', 'plaid.institutions'],
      ['accountIdsSelector', 'plaid.accounts'],
      ['authAccountIdsSelector', 'plaid.accounts.auth'],
      ['accountIdSelector', 'plaid.accounts.transactions'],
    ] as const) {
      const hook = renderHook(() => useSelectorSetup('plaid-block', getPlaidSubBlock(subBlockId)))
      mounted.push(hook.unmount)
      const { selectorContext, selectorKey } = hook.result()

      expect(selectorKey).toBe(key)
      expect(selectorContext).toMatchObject({
        workspaceId: 'workspace-1',
        oauthCredential: 'credential-1',
        countryCodes: 'US,CA',
      })
      expect((selectorContext as Record<string, unknown>).operation).toBeUndefined()

      const definition = getSelectorDefinition(key)
      expect(
        definition.enabled?.({
          key,
          context: selectorContext,
          search: key === 'plaid.institutions' ? 'bank' : undefined,
        }),
        key
      ).toBe(true)
    }
  })
})
