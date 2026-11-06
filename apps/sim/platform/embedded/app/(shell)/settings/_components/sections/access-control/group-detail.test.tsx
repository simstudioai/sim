/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionGroup } from '@/ee/access-control/hooks/permission-groups'

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  removeMember: vi.fn(),
  members: { data: [] as unknown[], isPending: false, error: null as unknown },
}))

vi.mock('@sim/emcn', () => emcnMock)
vi.mock('@/platform/embedded/lib/data/access-control', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/embedded/lib/data/access-control')>()),
  useUpdatePermissionGroup: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  useDeletePermissionGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemovePermissionGroupMember: () => ({ mutateAsync: mocks.removeMember, isPending: false }),
  useBulkAddPermissionGroupMembers: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGroupDetailParams: () => ({
    tab: 'general',
    search: '',
    status: 'all',
    selectTab: vi.fn(),
    setSearch: vi.fn(),
    setStatus: vi.fn(),
  }),
  usePermissionEditorModel: () => ({ model: null, retryCatalog: vi.fn() }),
  usePermissionGroupMembers: () => mocks.members,
}))
vi.mock(
  '@/platform/embedded/app/(shell)/settings/_components/sections/access-control/permission-rows',
  () => ({})
)
vi.mock(
  '@/platform/embedded/app/(shell)/settings/_components/sections/access-control/project-issue-restrictions',
  () => ({ ProjectIssueRestrictions: () => null })
)
vi.mock(
  '@/platform/embedded/app/(shell)/settings/_components/sections/access-control/add-members-modal',
  () => ({ AddMembersModal: () => null })
)
vi.mock('@/platform/embedded/app/(shell)/_components/provider-mark/provider-mark', () => ({
  ProviderMark: () => null,
}))
vi.mock('@/platform/design-system/components', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/design-system/components')>()),
  MultiSelect: ({
    value,
    onValueChange,
  }: {
    value: string[]
    onValueChange: (next: string[]) => void
  }): ReactNode => (
    <div>
      <output>{value.join(',')}</output>
      <button type='button' onClick={() => onValueChange(['ws-1'])}>
        choose one
      </button>
      <button type='button' onClick={() => onValueChange(['ws-1', 'ws-2'])}>
        choose two
      </button>
    </div>
  ),
}))

import { GroupDetail } from '@/platform/embedded/app/(shell)/settings/_components/sections/access-control/group-detail'

const WORKSPACES = [
  { id: 'ws-1', name: 'One' },
  { id: 'ws-2', name: 'Two' },
]

function groupOf(overrides: Partial<PermissionGroup> = {}) {
  return {
    id: 'group-1',
    name: 'Research',
    description: null,
    config: {},
    isDefault: false,
    workspaces: [],
    workspaceIds: [],
    membershipMode: 'inherit',
    ...overrides,
  } as unknown as PermissionGroup
}

describe('GroupDetail', () => {
  let container: HTMLDivElement
  let root: Root

  const shown = () => container.querySelector('output')?.textContent
  const button = (name: string) =>
    Array.from(container.querySelectorAll('button')).find((node) => node.textContent === name)
  const click = (name: string) =>
    act(async () => {
      const target = button(name)
      if (!target) throw new Error(`No button named ${name}`)
      target.click()
    })
  const render = (group = groupOf()) =>
    act(async () => {
      root.render(
        <GroupDetail
          group={group}
          organizationId='org-1'
          hosted={false}
          workspaceOptions={WORKSPACES.map(({ id, name }) => ({ value: id, label: name }))}
          organizationWorkspaces={WORKSPACES as never}
          workspacesLoading={false}
          onBack={vi.fn()}
        />
      )
    })

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    stubResizeObserver()
    mocks.mutateAsync.mockReset()
    mocks.removeMember.mockReset().mockResolvedValue({})
    mocks.members = { data: [], isPending: false, error: null }
    container = window.document.createElement('div')
    window.document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('writes nothing until Save, then sends every edit in one request', async () => {
    mocks.mutateAsync.mockResolvedValue({
      permissionGroup: { ...groupOf(), workspaceIds: ['ws-1', 'ws-2'] },
    })
    await render()
    await click('choose one')
    await click('choose two')
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
    await click('Save')

    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mocks.mutateAsync.mock.calls[0][0]).toMatchObject({ workspaceIds: ['ws-1', 'ws-2'] })
    expect(shown()).toBe('ws-1,ws-2')
    expect(button('Discard')).toBeUndefined()
  })

  it('keeps the edit and stays dirty when the save fails', async () => {
    mocks.mutateAsync.mockRejectedValue(new Error('nope'))
    await render()
    await click('choose two')
    await click('Save')

    expect(shown()).toBe('ws-1,ws-2')
    expect(button('Discard')).toBeDefined()
  })

  it('returns to the confirmed workspaces on Discard, never an unsaved choice', async () => {
    await render(groupOf({ workspaces: [WORKSPACES[1]] as never }))
    await click('choose one')
    await click('choose two')
    await click('Discard')

    expect(shown()).toBe('ws-2')
  })

  it('adopts a newer group while clean and flags it while dirty', async () => {
    await render()
    await render(groupOf({ name: 'Renamed' }))
    expect(container.textContent).toContain('Renamed')

    await click('choose two')
    await render(groupOf({ name: 'Renamed again' }))
    expect(container.textContent).toContain('changed while you were editing')
    expect(shown()).toBe('ws-1,ws-2')
  })
})
