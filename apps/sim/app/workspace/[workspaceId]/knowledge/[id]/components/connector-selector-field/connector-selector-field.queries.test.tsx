/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import type { SelectorRequest, SelectorResult } from '@/lib/selectors/types'
import type { ConnectorConfigField } from '@/connectors/types'

interface ComboboxProps {
  options: { value: string; label: string }[]
  isLoading: boolean
  onChange: (value: string) => void
  onMultiSelectChange?: (value: string[]) => void
}

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  combobox: vi.fn((_props: ComboboxProps) => null),
}))

vi.mock('@sim/emcn', () => ({ ChipCombobox: mocks.combobox }))
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (value: string) => value }))
vi.mock('@/lib/selectors/client/execute-selector', () => ({
  executeSelectorRequest: mocks.execute,
}))

import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field/connector-selector-field'

const field: ConnectorConfigField & { selectorKey: 'confluence.spaces' } = {
  id: 'spaces',
  title: 'Spaces',
  type: 'selector',
  selectorKey: 'confluence.spaces',
  dependsOn: ['domain'],
}
const domainField: ConnectorConfigField = { id: 'domain', title: 'Domain', type: 'short-input' }
const options = [
  { id: 'ENG', label: 'Engineering (ENG)' },
  { id: 'OPS', label: 'Operations (OPS)' },
]

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  mocks.execute.mockImplementation(async ({ request }: { request: SelectorRequest }) =>
    request.kind === 'list'
      ? { kind: 'list', items: options }
      : { kind: 'detail', item: { id: request.id, label: `Saved ${request.id}` } }
  )
})

it.each([true, false])(
  'selects loaded options without requests or list loading (multi: %s)',
  async (multi) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const root = createRoot(document.createElement('div'))
    function Harness() {
      const [value, setValue] = useState<string | string[]>(multi ? [] : '')
      return (
        <ConnectorSelectorField
          field={{ ...field, multi }}
          value={value}
          onChange={(nextValue) => setValue(nextValue)}
          credentialId='credential-1'
          sourceConfig={{ domain: 'acme.atlassian.net', spaces: value }}
          configFields={[domainField, field]}
          canonicalModes={{}}
        />
      )
    }
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Harness />
          </QueryClientProvider>
        )
      )
      await act(async () =>
        vi.waitFor(() => expect(mocks.combobox.mock.lastCall?.[0].options).toHaveLength(2), {
          interval: 1,
        })
      )
      let current = mocks.combobox.mock.lastCall![0]
      mocks.combobox.mockClear()
      for (const selection of [['ENG'], ['ENG', 'OPS'], ['OPS'], []]) {
        await act(async () => {
          if (multi) current.onMultiSelectChange?.(selection)
          else current.onChange(selection.at(-1) ?? '')
        })
        current = mocks.combobox.mock.lastCall![0]
      }
      expect(mocks.execute).toHaveBeenCalledTimes(1)
      expect(mocks.combobox.mock.calls.length).toBeGreaterThanOrEqual(multi ? 4 : 3)
      for (const [props] of mocks.combobox.mock.calls) {
        expect(props.isLoading).toBe(false)
        expect(props.options).toEqual(options.map(({ id, label }) => ({ value: id, label })))
      }
    } finally {
      await act(async () => root.unmount())
      client.clear()
    }
  }
)

it('keeps the loaded list visible while resolving a saved selection on another page', async () => {
  let resolveDetail!: (result: SelectorResult) => void
  const pendingDetail = new Promise<SelectorResult>((resolve) => {
    resolveDetail = resolve
  })
  mocks.execute.mockImplementation(({ request }: { request: SelectorRequest }) =>
    request.kind === 'list' ? Promise.resolve({ kind: 'list', items: options }) : pendingDetail
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ConnectorSelectorField
            field={{ ...field, multi: true }}
            value={['OLD']}
            onChange={vi.fn()}
            credentialId='credential-1'
            sourceConfig={{ domain: 'acme.atlassian.net' }}
            configFields={[domainField, field]}
            canonicalModes={{}}
          />
        </QueryClientProvider>
      )
    )
    await act(async () =>
      vi.waitFor(
        () => {
          const props = mocks.combobox.mock.lastCall![0]
          expect(props.options).toHaveLength(2)
          expect(props.isLoading).toBe(false)
        },
        { interval: 1 }
      )
    )
    await act(async () =>
      resolveDetail({ kind: 'detail', item: { id: 'OLD', label: 'Saved OLD' } })
    )
    await act(async () =>
      vi.waitFor(
        () =>
          expect(mocks.combobox.mock.lastCall?.[0].options).toContainEqual({
            value: 'OLD',
            label: 'Saved OLD',
          }),
        { interval: 1 }
      )
    )
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ request: { kind: 'detail', id: 'OLD' } })
    )
  } finally {
    await act(async () => root.unmount())
    client.clear()
  }
})
