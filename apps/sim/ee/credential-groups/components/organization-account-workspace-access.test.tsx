/**
 * @vitest-environment jsdom
 */

import { act, type ComponentProps, type ReactNode } from 'react'
import { emcnIconsMock } from '@sim/testing/mocks/emcn-icons.mock'
import {
  organizationAccountsQueriesMock,
  organizationAccountsQueriesMockFns,
} from '@sim/testing/mocks/organization-accounts-queries.mock'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type {
  UpdateOrganizationAccountWorkspaceAccessBody,
  OrganizationAccountWorkspaceAccess as WorkspaceAccess,
} from '@/lib/api/contracts/organization-accounts'
import type { OrganizationWorkspaceGrantModal } from '@/ee/credential-groups/components/organization-workspace-grant-modal'

const hoisted = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  mutationError: null as Error | null,
  isPending: false,
  grantModal: null as ComponentProps<typeof OrganizationWorkspaceGrantModal> | null,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  Chip: ({ children, onClick, disabled }: ComponentProps<'button'>) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ChipTag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  toast: { error: hoisted.toastError, success: hoisted.toastSuccess },
}))
vi.mock('@sim/emcn/icons', () => emcnIconsMock)
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/hooks/queries/organization-accounts', () => organizationAccountsQueriesMock)
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-resource-row', () => ({
  RESOURCE_LIST_STACK: '',
  SettingsResourceRow: ({
    title,
    trailing,
    description,
  }: {
    title: string
    trailing: ReactNode
    description: ReactNode
  }) => (
    <div data-workspace={title}>
      {title}
      {description}
      {trailing}
    </div>
  ),
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingsQueryErrorState: ({ error }: { error: Error }) => <div>{error.message}</div>,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({
      label,
      action,
      children,
    }: {
      label: string
      action: ReactNode
      children: ReactNode
    }) => (
      <section>
        <h2>{label}</h2>
        {action}
        {children}
      </section>
    ),
  })
)
vi.mock('@/app/workspace/[workspaceId]/settings/components/row-actions-menu', () => ({
  RowActionsMenu: ({ actions }: { actions: Array<{ label: string; onSelect: () => void }> }) => (
    <div>
      {actions.map((action) => (
        <button key={action.label} type='button' onClick={action.onSelect}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}))
vi.mock('@/ee/credential-groups/components/organization-workspace-grant-modal', () => ({
  OrganizationWorkspaceGrantModal: (
    props: ComponentProps<typeof OrganizationWorkspaceGrantModal>
  ) => {
    hoisted.grantModal = props
    return <div>Manage workspace access modal</div>
  },
}))

import { OrganizationAccountWorkspaceAccess } from '@/ee/credential-groups/components/organization-account-workspace-access'

const mocks = Object.assign(hoisted, {
  useAccess: organizationAccountsQueriesMockFns.mockUseOrganizationAccountWorkspaceAccess,
})

const WORKSPACES = [
  { id: 'workspace-1', name: 'Finance' },
  { id: 'workspace-2', name: 'Support' },
  { id: 'workspace-3', name: 'Sales' },
]
const mountedRoots: Root[] = []

function gmailGrants(workspaceIds: string[]): WorkspaceAccess['grants'] {
  return workspaceIds.map((workspaceId) => ({
    workspaceId,
    access: { mode: 'selected', credentialTypes: ['oauth:gmail'] },
  }))
}

function setAccess(grants = gmailGrants(['workspace-1']), revision = 3) {
  mocks.useAccess.mockReturnValue({
    data: {
      grants,
      revision,
      workspaces: WORKSPACES,
      credentialTypes: [
        { id: 'oauth:gmail', label: 'Gmail' },
        { id: 'oauth:google-calendar', label: 'Google Calendar' },
      ],
    } satisfies WorkspaceAccess,
    error: null,
  })
}

function renderAccess(searchParams = '') {
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  const rerender = () =>
    act(() =>
      root.render(
        <NuqsTestingAdapter searchParams={searchParams} hasMemory>
          <OrganizationAccountWorkspaceAccess organizationId='org-1' />
        </NuqsTestingAdapter>
      )
    )
  const button = (label: string, scope: ParentNode = container) => {
    const match = [...scope.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label
    )
    if (!match) throw new Error(`Button ${label} not found`)
    return match
  }
  const add = async (grant: WorkspaceAccess['grants'][number]) => {
    act(() => button('Add workspace').click())
    await act(async () => mocks.grantModal?.onSave(grant))
  }
  const rows = () =>
    [...container.querySelectorAll('[data-workspace]')].map((row) =>
      row.getAttribute('data-workspace')
    )
  rerender()
  return { container, rerender, button, add, rows }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.mutationError = null
  mocks.isPending = false
  mocks.grantModal = null
  organizationAccountsQueriesMockFns.mockUseUpdateOrganizationAccountWorkspaceAccess.mockImplementation(
    () => ({
      mutateAsync: mocks.mutateAsync,
      reset: mocks.reset,
      error: mocks.mutationError,
      isPending: mocks.isPending,
    })
  )
  setAccess()
  mocks.mutateAsync.mockImplementation(
    async (input: UpdateOrganizationAccountWorkspaceAccessBody) => {
      setAccess(input.grants, input.revision + 1)
      return { grants: input.grants, revision: input.revision + 1 }
    }
  )
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

it('edits one workspace without changing other workspace grants', async () => {
  setAccess(gmailGrants(['workspace-1', 'workspace-2']))
  const editor = renderAccess('?credential-group-workspace=+FINANCE+')
  expect(editor.rows()).toEqual(['Finance'])
  const finance = editor.container.querySelector('[data-workspace="Finance"]')
  if (!finance) throw new Error('Finance row not found')
  act(() => editor.button('Edit access', finance).click())
  if (mocks.grantModal?.mode !== 'edit') throw new Error('Edit modal not found')
  expect(mocks.grantModal.grant).toEqual(gmailGrants(['workspace-1'])[0])
  const changed = {
    workspaceId: 'workspace-1',
    access: { mode: 'selected', credentialTypes: ['oauth:google-calendar'] },
  } satisfies WorkspaceAccess['grants'][number]
  await act(async () => mocks.grantModal?.onSave(changed))
  expect(mocks.mutateAsync).toHaveBeenCalledExactlyOnceWith({
    organizationId: 'org-1',
    revision: 3,
    grants: [changed, ...gmailGrants(['workspace-2'])],
  })
})

it.each(['create', 'edit'] as const)(
  'keeps the revision captured when the %s editor opened',
  async (mode) => {
    const editor = renderAccess()
    act(() => editor.button(mode === 'create' ? 'Add workspace' : 'Edit access').click())
    setAccess(gmailGrants(['workspace-1']), 4)
    editor.rerender()
    await act(async () =>
      mocks.grantModal?.onSave(gmailGrants([mode === 'create' ? 'workspace-2' : 'workspace-1'])[0])
    )
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }))
  }
)
