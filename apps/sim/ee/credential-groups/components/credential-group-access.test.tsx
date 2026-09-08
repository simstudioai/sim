/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const mocks = vi.hoisted(() => ({
  addResourceModalProps: null as {
    resources: Array<{ id: string; name: string }>
    onAdd: (workflowId: string) => void
    onClose: () => void
  } | null,
  mutationError: null as Error | null,
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  useAccess: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  Chip: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))

vi.mock('@sim/emcn/icons', () => ({ Plus: () => null, Workflow: () => null }))

vi.mock('@/hooks/queries/credential-groups', () => ({
  useCredentialGroupAccess: mocks.useAccess,
  useUpdateCredentialGroupAccess: () => ({
    error: mocks.mutationError,
    isPending: false,
    mutateAsync: mocks.mutateAsync,
    reset: mocks.reset,
  }),
}))

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

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-resource-row', () => ({
  RESOURCE_LIST_STACK: '',
  SettingsResourceRow: ({
    title,
    description,
    trailing,
  }: {
    title: ReactNode
    description?: ReactNode
    trailing?: ReactNode
  }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
      {trailing}
    </div>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({
      label,
      action,
      children,
    }: {
      label: ReactNode
      action?: ReactNode
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

vi.mock('@/ee/credential-groups/components/credential-group-add-resource-modal', () => ({
  CredentialGroupAddResourceModal: (props: {
    resources: Array<{ id: string; name: string }>
    onAdd: (workflowId: string) => void
    onClose: () => void
  }) => {
    mocks.addResourceModalProps = props
    return <div>Add workflow modal</div>
  },
}))

import {
  CredentialGroupAccess,
  useCredentialGroupAccessEditor,
} from '@/ee/credential-groups/components/credential-group-access'

const GROUP_ID = 'group-1'
const WORKFLOWS = [
  { id: 'workflow-1', name: 'Finance workflow' },
  { id: 'workflow-2', name: 'Support workflow' },
]
const mountedRoots: Root[] = []

function renderHook() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  let result: ReturnType<typeof useCredentialGroupAccessEditor> | undefined

  function Probe() {
    result = useCredentialGroupAccessEditor({
      workspaceId: 'workspace-1',
      groupId: GROUP_ID,
      enabled: true,
    })
    return null
  }

  const rerender = () => {
    act(() => root.render(<Probe />))
  }
  rerender()

  return {
    getResult: () => {
      if (!result) throw new Error('Access editor hook did not render')
      return result
    },
    rerender,
  }
}

function renderAccess(overrides: Partial<React.ComponentProps<typeof CredentialGroupAccess>> = {}) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  const onAllowedWorkflowIdsChange = vi.fn()
  act(() =>
    root.render(
      <CredentialGroupAccess
        allowedWorkflowIds={['workflow-1']}
        revision={7}
        workflows={WORKFLOWS}
        onAllowedWorkflowIdsChange={onAllowedWorkflowIdsChange}
        error={null}
        isPending={false}
        loadError={null}
        saving={false}
        {...overrides}
      />
    )
  )
  const button = (label: string) => {
    const match = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label
    )
    if (!(match instanceof HTMLButtonElement)) throw new Error(`Button ${label} not found`)
    return match
  }
  return { button, container, onAllowedWorkflowIdsChange }
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsDirtyStore.getState().reset()
  mocks.addResourceModalProps = null
  mocks.mutationError = null
  mocks.useAccess.mockReturnValue({
    data: {
      revision: 3,
      allowedWorkflowIds: ['workflow-1'],
      workflows: WORKFLOWS,
    },
    error: null,
    isPending: false,
  })
  mocks.mutateAsync.mockResolvedValue({ revision: 4, allowedWorkflowIds: ['workflow-2'] })
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

describe('Credential Group access editor', () => {
  it('stages normalized workflow access against the loaded revision', () => {
    const editor = renderHook()

    expect(editor.getResult().allowedWorkflowIds).toEqual(['workflow-1'])
    expect(editor.getResult().revision).toBe(3)
    expect(editor.getResult().dirty).toBe(false)

    act(() => editor.getResult().setAllowedWorkflowIds(['workflow-2', 'workflow-1'], 3))

    expect(editor.getResult().allowedWorkflowIds).toEqual(['workflow-1', 'workflow-2'])
    expect(editor.getResult().revision).toBe(3)
    expect(editor.getResult().dirty).toBe(true)
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('saves the staged workflow IDs and clears the draft', async () => {
    const editor = renderHook()
    act(() => editor.getResult().setAllowedWorkflowIds(['workflow-2'], 3))

    await act(async () => editor.getResult().save())

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      groupId: GROUP_ID,
      body: { expectedRevision: 3, allowedWorkflowIds: ['workflow-2'] },
    })
    expect(editor.getResult().dirty).toBe(false)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Workflow access saved')
  })

  it('blocks settings navigation until the save request settles', async () => {
    let resolveSave: ((value: { revision: number; allowedWorkflowIds: string[] }) => void) | null =
      null
    mocks.mutateAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve
      })
    )
    const editor = renderHook()
    act(() => editor.getResult().setAllowedWorkflowIds(['workflow-2'], 3))

    let savePromise: Promise<void> | undefined
    act(() => {
      savePromise = editor.getResult().save()
    })
    expect(useSettingsDirtyStore.getState().navigationBlocked).toBe(true)

    await act(async () => {
      if (!resolveSave) throw new Error('Save resolver is unavailable')
      resolveSave({ revision: 4, allowedWorkflowIds: ['workflow-2'] })
      await savePromise
    })
    expect(useSettingsDirtyStore.getState().navigationBlocked).toBe(false)
  })

  it('preserves the pinned draft when a concurrent update conflicts', async () => {
    const editor = renderHook()
    act(() => editor.getResult().setAllowedWorkflowIds(['workflow-2'], 3))
    mocks.useAccess.mockReturnValue({
      data: { revision: 4, allowedWorkflowIds: [], workflows: WORKFLOWS },
      error: null,
      isPending: false,
    })
    const conflict = new Error('Credential Group workflow access changed while it was edited')
    mocks.mutateAsync.mockImplementation(async () => {
      mocks.mutationError = conflict
      throw conflict
    })
    editor.rerender()

    await act(async () => editor.getResult().save())
    editor.rerender()

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      groupId: GROUP_ID,
      body: { expectedRevision: 3, allowedWorkflowIds: ['workflow-2'] },
    })
    expect(editor.getResult().allowedWorkflowIds).toEqual(['workflow-2'])
    expect(editor.getResult().revision).toBe(3)
    expect(editor.getResult().dirty).toBe(true)
    expect(editor.getResult().error).toBe(conflict.message)
  })

  it('discards staged workflow access back to the query value', () => {
    const editor = renderHook()
    act(() => editor.getResult().setAllowedWorkflowIds(['workflow-2'], 3))

    act(() => editor.getResult().discard())

    expect(editor.getResult().allowedWorkflowIds).toEqual(['workflow-1'])
    expect(editor.getResult().dirty).toBe(false)
  })

  it('fails fast on duplicate workflow access', () => {
    const editor = renderHook()

    expect(() =>
      act(() => editor.getResult().setAllowedWorkflowIds(['workflow-1', 'workflow-1'], 3))
    ).toThrow('contains duplicate workflows')
  })

  it('fails fast instead of normalizing a non-canonical workflow ID', () => {
    const editor = renderHook()

    expect(() => act(() => editor.getResult().setAllowedWorkflowIds([' workflow-1'], 3))).toThrow(
      'requires canonical non-empty workflow IDs'
    )
  })
})

describe('CredentialGroupAccess', () => {
  it('renders named workflow rows and stages removal', () => {
    const access = renderAccess()

    expect(access.container.textContent).toContain('Workflow access')
    expect(access.container.textContent).toContain('Finance workflow')
    expect(access.container.textContent).toContain(
      'Deployed runs can use every credential in this group'
    )

    act(() => access.button('Remove').click())

    expect(access.onAllowedWorkflowIdsChange).toHaveBeenCalledWith([], 7)
  })

  it('opens the picker with only workflows that do not have access', () => {
    const access = renderAccess()

    act(() => access.button('Add workflow').click())

    expect(mocks.addResourceModalProps?.resources).toEqual([
      { id: 'workflow-2', name: 'Support workflow' },
    ])
    act(() => mocks.addResourceModalProps?.onAdd('workflow-2'))
    expect(access.onAllowedWorkflowIdsChange).toHaveBeenCalledWith(['workflow-1', 'workflow-2'], 7)
  })

  it('renders allowed workflows in canonical catalog order', () => {
    const access = renderAccess({ allowedWorkflowIds: ['workflow-2', 'workflow-1'] })
    const text = access.container.textContent ?? ''

    expect(text.indexOf('Finance workflow')).toBeLessThan(text.indexOf('Support workflow'))
  })

  it('fails fast when selected access references an unavailable workflow', () => {
    expect(() => renderAccess({ allowedWorkflowIds: ['deleted-workflow-id'] })).toThrow(
      'references unavailable workflow deleted-workflow-id'
    )
  })

  it('renders the empty and error states without the generic policy editor', () => {
    const empty = renderAccess({ allowedWorkflowIds: [] })
    expect(empty.container.textContent).toContain('No workflows have access')
    expect(empty.container.textContent).not.toContain('Access policy')

    const failed = renderAccess({ loadError: new Error('Access request failed') })
    expect(failed.container.textContent).toContain('Access request failed')
  })
})
