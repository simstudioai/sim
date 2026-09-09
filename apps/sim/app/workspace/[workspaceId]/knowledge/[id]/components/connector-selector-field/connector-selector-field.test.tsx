/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { ConnectorConfigField } from '@/connectors/types'

const mocks = vi.hoisted(() => ({
  combobox: vi.fn((_props: ComboboxCallbacks) => null),
  change: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({ ChipCombobox: mocks.combobox }))
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('@/lib/selectors/context', () => ({ projectSelectorContext: () => ({}) }))
vi.mock('@/lib/selectors/manifest', () => ({
  getSelectorManifestEntry: () => ({ resolvesUnknownIds: false }),
}))
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (value: string) => value }))
vi.mock('@/hooks/queries/selectors', () => ({
  useSelectorOptions: () => ({
    data: [{ id: 'folder-b', label: 'Company docs', secret: 'not display metadata' }],
    error: null,
    truncated: false,
  }),
  useSelectorOptionDetails: () => ({ data: [{ id: 'folder-a', label: 'Engineering' }] }),
  useSelectorOptionDetail: () => ({}),
}))

import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field/connector-selector-field'

interface ComboboxCallbacks {
  options: { value: string; label: string; hidden?: boolean }[]
  disabled: boolean
  onChange?: (value: string) => void
  onMultiSelectChange?: (value: string[]) => void
}

it.each([true, false])(
  'captures only selected ID/name pairs from existing options (multi: %s)',
  async (multi) => {
    const field: ConnectorConfigField & { selectorKey: 'google.drive' } = {
      id: 'folderSelector',
      title: 'Folders',
      type: 'selector',
      selectorKey: 'google.drive',
      canonicalParamId: 'folderId',
      multi,
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(
          <ConnectorSelectorField
            field={field}
            value={multi ? ['folder-a'] : ''}
            onChange={mocks.change}
            credentialId='credential-1'
            sourceConfig={{}}
            configFields={[field]}
            canonicalModes={{}}
          />
        )
      )
      const callbacks = mocks.combobox.mock.lastCall![0]
      if (multi) {
        await act(async () => callbacks.onMultiSelectChange?.(['folder-a', 'folder-b']))
        expect(mocks.change).toHaveBeenLastCalledWith(
          ['folder-a', 'folder-b'],
          [
            { id: 'folder-a', label: 'Engineering' },
            { id: 'folder-b', label: 'Company docs' },
          ]
        )
      } else {
        await act(async () => callbacks.onChange?.('folder-b'))
        expect(mocks.change).toHaveBeenLastCalledWith('folder-b', [
          { id: 'folder-b', label: 'Company docs' },
        ])
      }
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.clearAllMocks()
    }
  }
)

it('uses saved labels only for selected values and prefers live provider names', async () => {
  const field: ConnectorConfigField & { selectorKey: 'google.drive' } = {
    id: 'folder',
    title: 'Folders',
    type: 'selector',
    selectorKey: 'google.drive',
    multi: true,
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () =>
      root.render(
        <ConnectorSelectorField
          field={field}
          value={['folder-a', 'folder-saved']}
          onChange={mocks.change}
          credentialId={null}
          sourceConfig={{}}
          configFields={[field]}
          canonicalModes={{}}
          selectedLabels={[
            { id: 'folder-a', label: 'Old provider name' },
            { id: 'folder-saved', label: 'Project notes' },
            { id: 'folder-other', label: 'Unselected saved folder' },
          ]}
        />
      )
    )
    const props = mocks.combobox.mock.lastCall![0]
    expect(props.disabled).toBe(true)
    expect(props.options).toEqual([
      { value: 'folder-a', label: 'Engineering' },
      { value: 'folder-saved', label: 'Project notes', hidden: true },
      { value: 'folder-b', label: 'Company docs' },
    ])
  } finally {
    await act(async () => root.unmount())
    vi.clearAllMocks()
  }
})
