/**
 * @vitest-environment jsdom
 */

import { act, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SettingsAction } from '@/components/settings/settings-header'
import type {
  UpdateOrganizationAccountWorkspaceAccessBody,
  OrganizationAccountWorkspaceAccess as WorkspaceAccess,
} from '@/lib/api/contracts/organization-accounts'
import type { CredentialGroupAddResourceModal } from '@/ee/credential-groups/components/credential-group-add-resource-modal'

const mocks = vi.hoisted(() => ({
  useAccess: vi.fn(),
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  mutationError: null as Error | null,
  isPending: false,
  modal: null as ComponentProps<typeof CredentialGroupAddResourceModal> | null,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  Chip: ({ children, onClick, disabled }: ComponentProps<'button'>) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))
vi.mock('@sim/emcn/icons', () => ({ Workspaces: () => null }))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useOrganizationAccountWorkspaceAccess: mocks.useAccess,
  useUpdateOrganizationAccountWorkspaceAccess: () => ({
    mutateAsync: mocks.mutateAsync,
    reset: mocks.reset,
    error: mocks.mutationError,
    isPending: mocks.isPending,
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    actions = [],
    children,
  }: {
    actions?: SettingsAction[]
    children: ReactNode
  }) => (
    <div>
      {actions.map((action) => (
        <button key={action.id} type='button' disabled={action.disabled} onClick={action.onSelect}>
          {action.text}
        </button>
      ))}
      {children}
    </div>
  ),
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-resource-row', () => ({
  RESOURCE_LIST_STACK: '',
  SettingsResourceRow: ({ title, trailing }: { title: string; trailing: ReactNode }) => (
    <div data-workspace={title}>
      {title}
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
vi.mock('@/ee/credential-groups/components/credential-group-add-resource-modal', () => ({
  CredentialGroupAddResourceModal: (
    props: ComponentProps<typeof CredentialGroupAddResourceModal>
  ) => {
    mocks.modal = props
    return <div>Add workspaces modal</div>
  },
}))

import { OrganizationAccountWorkspaceAccess } from '@/ee/credential-groups/components/organization-account-workspace-access'

const WORKSPACES = [
  { id: 'workspace-1', name: 'Finance' },
  { id: 'workspace-2', name: 'Support' },
  { id: 'workspace-3', name: 'Sales' },
]
const mountedRoots: Root[] = []

function setAccess(workspaceIds = ['workspace-1'], revision = 3) {
  mocks.useAccess.mockReturnValue({
    data: { workspaceIds, revision, workspaces: WORKSPACES } satisfies WorkspaceAccess,
    error: null,
  })
}

function renderAccess() {
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  const rerender = () =>
    act(() => root.render(<OrganizationAccountWorkspaceAccess organizationId='org-1' />))
  const button = (label: string, scope: ParentNode = container) => {
    const match = [...scope.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label
    )
    if (!match) throw new Error(`Button ${label} not found`)
    return match
  }
  const add = async (ids: string[]) => {
    act(() => button('Add workspaces').click())
    await act(async () => {
      if (mocks.modal?.resourceType !== 'workspace')
        throw new Error('Workspace picker is unavailable')
      mocks.modal.onAdd(ids)
    })
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
  vi.clearAllMocks()
  mocks.mutationError = null
  mocks.isPending = false
  mocks.modal = null
  setAccess()
  mocks.mutateAsync.mockImplementation(
    async (input: UpdateOrganizationAccountWorkspaceAccessBody) => {
      setAccess(input.workspaceIds, input.revision + 1)
      return { workspaceIds: input.workspaceIds, revision: input.revision + 1 }
    }
  )
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

it('adds multiple workspaces immediately without Save or Discard actions', async () => {
  const editor = renderAccess()
  expect(editor.rows()).toEqual(['Finance'])
  expect(editor.container.textContent).not.toMatch(/Save|Discard/)

  await editor.add(['workspace-3', 'workspace-2'])
  editor.rerender()

  expect(mocks.modal?.resources).toEqual(WORKSPACES.slice(1))
  expect(mocks.mutateAsync).toHaveBeenCalledExactlyOnceWith({
    organizationId: 'org-1',
    revision: 3,
    workspaceIds: ['workspace-1', 'workspace-3', 'workspace-2'],
  })
  expect(editor.rows()).toEqual(['Finance', 'Support', 'Sales'])
  expect(editor.container.textContent).not.toContain('Add workspaces modal')
  expect(editor.container.textContent).not.toMatch(/Save|Discard/)
})

it('removes workspace access directly from the row action', async () => {
  setAccess(['workspace-1', 'workspace-2'])
  const editor = renderAccess()
  const finance = editor.container.querySelector('[data-workspace="Finance"]')
  if (!finance) throw new Error('Finance row not found')
  await act(async () => editor.button('Remove', finance).click())
  editor.rerender()

  expect(mocks.mutateAsync).toHaveBeenCalledExactlyOnceWith({
    organizationId: 'org-1',
    revision: 3,
    workspaceIds: ['workspace-2'],
  })
  expect(editor.rows()).toEqual(['Support'])
})

it('does not change access when the add picker is cancelled', () => {
  const editor = renderAccess()
  act(() => editor.button('Add workspaces').click())
  act(() => mocks.modal?.onClose())

  expect(mocks.mutateAsync).not.toHaveBeenCalled()
  expect(editor.rows()).toEqual(['Finance'])
  expect(editor.container.textContent).not.toContain('Add workspaces modal')
})

it('keeps the picker open and reports failed additions without changing the list', async () => {
  const conflict = new Error('Workspace access changed while it was edited')
  mocks.mutateAsync.mockImplementation(async () => {
    mocks.mutationError = conflict
    throw conflict
  })
  const editor = renderAccess()
  await editor.add(['workspace-2', 'workspace-3'])
  editor.rerender()

  expect(mocks.mutateAsync).toHaveBeenCalledOnce()
  expect(editor.rows()).toEqual(['Finance'])
  expect(editor.container.textContent).toContain('Add workspaces modal')
  expect(mocks.modal?.error).toBe(conflict.message)
  expect(mocks.toastError).toHaveBeenCalledWith(conflict.message)
  expect(mocks.toastSuccess).not.toHaveBeenCalled()
})

it('disables access changes while a removal is in flight and preserves the row on failure', async () => {
  let fail: ((error: Error) => void) | undefined
  mocks.mutateAsync.mockImplementation(() => {
    mocks.isPending = true
    return new Promise<void>((_, reject) => {
      fail = reject
    })
  })
  const editor = renderAccess()
  act(() => editor.button('Remove').click())
  editor.rerender()

  expect(editor.button('Add workspaces').disabled).toBe(true)
  expect(editor.rows()).toEqual(['Finance'])
  expect(editor.container.textContent).not.toContain('Remove')

  const error = new Error('Could not remove workspace access')
  await act(async () => {
    if (!fail) throw new Error('Request rejection is unavailable')
    mocks.isPending = false
    mocks.mutationError = error
    fail(error)
  })
  editor.rerender()
  expect(editor.rows()).toEqual(['Finance'])
  expect(editor.button('Remove').disabled).toBe(false)
  expect(editor.container.textContent).toContain(error.message)
})
