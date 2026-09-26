/** @vitest-environment jsdom */

import { act } from 'react'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ConnectorConfigField } from '@/connectors/types'

const mocks = vi.hoisted(() => ({
  combobox: vi.fn((_props: ComboboxCallbacks) => null),
  change: vi.fn(),
  projectContext: vi.fn((_key: string, context: Record<string, string>) => context),
  loadAll: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  ChipCombobox: mocks.combobox,
}))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/selectors/context', () => ({ projectSelectorContext: mocks.projectContext }))
vi.mock('@/lib/selectors/manifest', () => ({
  getSelectorManifestEntry: () => ({ resolvesUnknownIds: false }),
}))
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (value: string) => value }))
vi.mock('@/hooks/queries/selectors', () => ({
  useSelectorOptions: () => ({
    data: [{ id: 'folder-b', label: 'Company docs', secret: 'not display metadata' }],
    error: null,
    truncated: false,
    loadAll: mocks.loadAll,
  }),
  useSelectorOptionDetails: () => ({ data: [{ id: 'folder-a', label: 'Engineering' }] }),
  useSelectorOptionDetail: () => ({}),
}))

import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field/connector-selector-field'

nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'workspace-1' })

interface ComboboxCallbacks {
  options: {
    value: string
    label: string
    hidden?: boolean
    selected?: boolean
    onSelect?: () => void
  }[]
  disabled: boolean
  onChange?: (value: string) => void
  onMultiSelectChange?: (value: string[]) => void
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

it.each([
  ['Admin@Example.com ', 'Admin@Example.com'],
  ['{{DRIVE_ADMIN_EMAIL}}', '{{DRIVE_ADMIN_EMAIL}}'],
])(
  'forwards the declared subject %s without exposing unrelated source configuration',
  async (subject, expectedSubject) => {
    const field: ConnectorConfigField & { selectorKey: 'google.drive' } = {
      id: 'folderSelector',
      title: 'Folders',
      type: 'selector',
      selectorKey: 'google.drive',
      mimeType: 'application/vnd.google-apps.folder',
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () =>
        root.render(
          <ConnectorSelectorField
            field={field}
            value=''
            onChange={mocks.change}
            credentialId='credential-1'
            sourceConfig={{ adminEmail: subject, maxFiles: '20' }}
            serviceAccountSubjectFieldId='adminEmail'
            configFields={[field]}
            canonicalModes={{}}
          />
        )
      )
      expect(mocks.projectContext).toHaveBeenLastCalledWith('google.drive', {
        oauthCredential: 'credential-1',
        mimeType: 'application/vnd.google-apps.folder',
        impersonateUserEmail: expectedSubject,
      })
    } finally {
      await act(async () => root.unmount())
    }
  }
)

it('keeps the prior selection when all personal setup options exceed its source limit', async () => {
  mocks.loadAll.mockResolvedValue({
    status: 'complete',
    options: Array.from({ length: 1001 }, (_, index) => ({
      id: `P${index}`,
      label: `Project ${index}`,
    })),
  })
  const field: ConnectorConfigField & { selectorKey: 'jira.projectKeys' } = {
    id: 'projects',
    title: 'Projects',
    type: 'selector',
    selectorKey: 'jira.projectKeys',
    multi: true,
    allowSelectAll: true,
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <ConnectorSelectorField
          scope={{ kind: 'organization', organizationId: 'org-1' }}
          selectorSurface={{
            kind: 'personal-search-setup',
            organizationId: 'org-1',
            connectorType: 'jira',
          }}
          field={field}
          value={['SAVED']}
          onChange={mocks.change}
          credentialId='credential-1'
          sourceConfig={{ domain: 'example.atlassian.net' }}
          configFields={[field]}
          canonicalModes={{}}
        />
      )
    )
    const all = mocks.combobox.mock.lastCall![0].options.find((item) => item.label === 'All')
    expect(container.textContent).not.toContain('Select all')
    await act(async () => all?.onSelect?.())
    expect(mocks.loadAll).toHaveBeenCalledTimes(1)
    expect(mocks.change).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Select up to 1,000 items'
    )
  } finally {
    await act(async () => root.unmount())
  }
})
