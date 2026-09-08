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
