/**
 * @vitest-environment jsdom
 *
 * A workspace row offers Leave to a viewer who neither owns the workspace nor holds it as an
 * organization admin. Failure modes: Leave missing for a plain member, offered to the owner, run
 * without confirmation, and leaving the open workspace stranding the viewer on a page they lost.
 */
import { act } from 'react'
import { stubDialog, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

import { SidebarLayout } from '@/app/(product)/_components/sidebar/sidebar-layout'
import { WorkspacesSection } from '@/app/(product)/_components/sidebar/workspaces-section'
import type { ShellActions, ShellData, ShellWorkspace } from '@/platform/lib/data/models/shell'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  stubDialog()
  container = document.createElement('div')
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const member: ShellWorkspace = {
  id: 'ws-member',
  name: 'Shared',
  permissions: 'write',
  canLeave: true,
}
const owned: ShellWorkspace = {
  id: 'ws-owned',
  name: 'Mine',
  permissions: 'admin',
  canLeave: false,
}

function render(leave: (id: string) => Promise<void>, navigate: (href: string) => void) {
  const data = { workspaces: [member, owned], organization: { id: 'org' } } as unknown as ShellData
  const actions = {
    workspaces: { leave, setPinned: () => undefined },
    requestLeave: (run: () => void) => run(),
  } as unknown as ShellActions
  act(() =>
    root.render(
      <SidebarLayout>
        <WorkspacesSection
          data={data}
          actions={actions}
          activeWorkspace={member.id}
          navigate={navigate}
        />
      </SidebarLayout>
    )
  )
}

async function openMenu(name: string) {
  const trigger = container.querySelector<HTMLButtonElement>(
    `button[aria-label="Actions for ${name}"]`
  )
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      trigger?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
  })
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

function button(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(
    (candidate) => candidate.textContent === text
  )
}

it('offers Leave only where the viewer can leave, and confirms before leaving', async () => {
  const leave = vi.fn(async () => undefined)
  const navigate = vi.fn()
  render(leave, navigate)

  expect((await openMenu(owned.name)).map((item) => item.textContent)).not.toContain('Leave')
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  )

  const items = await openMenu(member.name)
  const leaveItem = items.find((item) => item.textContent === 'Leave')
  expect(leaveItem).toBeDefined()
  await act(async () => leaveItem?.click())
  expect(leave).not.toHaveBeenCalled()

  await act(async () => button('Leave')?.click())
  expect(leave).toHaveBeenCalledWith(member.id)
  expect(navigate).toHaveBeenCalledWith('/workspace')
})
