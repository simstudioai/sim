/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { toast } from '@sim/emcn'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredentialGroup } from '@/lib/api/contracts/credential-groups'

const mocks = vi.hoisted(() => ({
  groups: [] as CredentialGroup[],
  ensure: vi.fn(),
  ensured: undefined as { credentialGroup: CredentialGroup } | undefined,
  setupError: null as Error | null,
  setupIdle: true,
  update: vi.fn(),
  panel: null as {
    title?: string
    back?: { onSelect: () => void }
    actions?: Array<{ text: string; onSelect: () => void }>
  } | null,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/settings/credential-groups',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/hooks/queries/credential-groups', () => ({
  useWorkspaceAccounts: (workspaceId: string) => ({
    data: {
      credentialGroup: mocks.groups.find((group) => group.workspaceId === workspaceId) ?? null,
      availableProviders: [],
    },
    isSuccess: true,
    isPending: false,
  }),
  useEnsureWorkspaceAccounts: () => ({
    mutate: mocks.ensure,
    data: mocks.ensured,
    error: mocks.setupError,
    isIdle: mocks.setupIdle,
    isPending: false,
  }),
  useCredentialGroupDetail: (_workspaceId: string, groupId: string) => ({
    data: {
      pages: [
        {
          credentialGroup:
            mocks.groups.find((group) => group.id === groupId) ?? mocks.ensured?.credentialGroup,
          enrollments: [],
        },
      ],
    },
    isPending: false,
    hasNextPage: false,
  }),
  useResendCredentialGroupEnrollment: () => ({ isPending: false }),
  useDeleteCredentialGroupEnrollment: () => ({ isPending: false }),
  useUpdateCredentialGroup: () => ({ isPending: false, mutateAsync: mocks.update }),
}))
vi.mock('@/hooks/queries/credentials', () => ({ useWorkspaceCredentials: () => ({ data: [] }) }))
vi.mock('@/hooks/use-debounced-search-setter', () => ({
  useDebouncedSearchSetter: (setter: unknown) => setter,
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    children,
    ...props
  }: {
    children: ReactNode
    title?: string
    actions?: Array<{ text: string; onSelect: () => void }>
  }) => {
    mocks.panel = props
    return <>{children}</>
  },
}))
vi.mock('@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard', () => ({
  useSettingsUnsavedGuard: () => ({
    guardBack: (action: () => void) => action(),
    showUnsavedModal: false,
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/components/credential-detail', () => ({
  UnsavedChangesModal: () => null,
}))
vi.mock('@/ee/credential-groups/components/credential-group-details', () => ({
  CredentialGroupDetails: ({ credentialGroup }: { credentialGroup: CredentialGroup }) => (
    <div data-accounts-id={credentialGroup.id}>Accounts people can connect</div>
  ),
}))
vi.mock('@/ee/credential-groups/components/credential-group-access', () => ({
  useCredentialGroupAccessEditor: () => ({ dirty: false, saving: false, discard: vi.fn() }),
  CredentialGroupAccess: () => null,
}))
vi.mock('@/ee/credential-groups/components/credential-group-invite-modal', () => ({
  CredentialGroupInviteModal: () => null,
}))

import { CredentialGroupsSettings } from '@/ee/credential-groups/components/credential-groups-settings'

const canonical: CredentialGroup = {
  id: 'canonical-group',
  workspaceId: 'workspace-1',
  name: 'Workspace accounts',
  description: null,
  options: [],
  mcpServers: [],
  status: 'active',
  createdAt: '2026-09-04T00:00:00Z',
  updatedAt: '2026-09-04T00:00:00Z',
}

describe('Connected accounts settings', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(toast, 'success').mockImplementation(() => '')
    mocks.groups = [canonical]
    mocks.ensured = undefined
    mocks.setupError = null
    mocks.setupIdle = true
    mocks.panel = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  async function render(searchParams = '', workspaceId = 'workspace-1') {
    await act(async () =>
      root.render(
        <NuqsTestingAdapter hasMemory searchParams={searchParams}>
          <CredentialGroupsSettings workspaceId={workspaceId} />
        </NuqsTestingAdapter>
      )
    )
  }

  it('opens the canonical accounts directly without create, group search, name, or delete controls', async () => {
    await render()
    expect(container.querySelector('[data-accounts-id]')?.getAttribute('data-accounts-id')).toBe(
      canonical.id
    )
    expect(container.textContent).toContain('Accounts')
    expect(container.textContent).toContain('People')
    expect(container.textContent).toContain('Workflow access')
    expect(container.textContent).not.toContain('Existing connections')
    expect(container.textContent).not.toContain('Create group')
    expect(container.querySelector('input')).toBeNull()
    expect(mocks.panel?.back).toBeUndefined()
    expect(mocks.panel?.actions).toEqual([])
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it('prepares a missing workspace container automatically and opens the returned accounts', async () => {
    mocks.groups = []
    await render()
    expect(mocks.ensure).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    mocks.setupIdle = false
    mocks.ensured = { credentialGroup: canonical }
    await render()
    expect(container.querySelector('[data-accounts-id]')?.getAttribute('data-accounts-id')).toBe(
      canonical.id
    )
    expect(mocks.ensure).toHaveBeenCalledTimes(1)
  })

  it('opens the People tab on the workspace account record', async () => {
    await render('?credential-group-tab=people')
    expect(container.textContent).toContain('No people invited yet')
    expect(mocks.panel?.title).toBeUndefined()
    expect(mocks.panel?.back).toBeUndefined()
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it('does not show a previous workspace response after switching workspaces', async () => {
    mocks.groups = []
    mocks.ensured = { credentialGroup: canonical }
    mocks.setupIdle = false
    await render()
    expect(container.querySelector('[data-accounts-id]')).not.toBeNull()
    mocks.setupIdle = true
    await render('', 'workspace-2')
    expect(container.querySelector('[data-accounts-id]')).toBeNull()
    expect(mocks.ensure).toHaveBeenCalledWith({ workspaceId: 'workspace-2' })
  })

  it('shows retry after failed setup instead of repeatedly creating a group', async () => {
    mocks.groups = []
    mocks.setupIdle = false
    mocks.setupError = new Error('Temporary setup failure')
    await render()
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Temporary setup failure')
    const retry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Try again'
    )
    await act(async () => retry?.click())
    expect(mocks.ensure).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
  })

  it('offers to enable a disabled canonical container without replacing it', async () => {
    mocks.groups = [{ ...canonical, status: 'disabled' }]
    await render()
    const enable = mocks.panel?.actions?.find((action) => action.text === 'Enable accounts')
    expect(enable).toBeDefined()
    await act(async () => enable?.onSelect())
    expect(mocks.update).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      groupId: canonical.id,
      body: { status: 'active' },
    })
    expect(mocks.ensure).not.toHaveBeenCalled()
  })
})
