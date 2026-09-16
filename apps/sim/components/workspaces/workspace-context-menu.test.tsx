/**
 * @vitest-environment jsdom
 */
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceContextMenu } from '@/components/workspaces/workspace-context-menu'
import type { Workspace } from '@/lib/api/contracts/workspaces'

const workspace: Workspace = {
  id: 'workspace',
  name: 'Workspace',
  organizationId: 'org',
  workspaceMode: 'organization',
  ownerId: 'owner',
  permissions: 'admin',
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function menuItem(name: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent === name
  )
}

function showMenu(
  overrides: Partial<Workspace> = {},
  sessionUserId = 'member',
  workspaceCount = 2
) {
  act(() =>
    root.render(
      <WorkspaceContextMenu
        workspace={{ ...workspace, ...overrides }}
        workspaceCount={workspaceCount}
        sessionUserId={sessionUserId}
        isOpen
        position={{ x: 0, y: 0 }}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        onTogglePin={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onLeave={vi.fn()}
        onUploadLogo={vi.fn()}
      />
    )
  )
}

describe('WorkspaceContextMenu', () => {
  it.each(['read', 'write'] as const)(
    'keeps personal pinning available for %s access but disables admin actions',
    (permissions) => {
      showMenu({ permissions })
      expect(menuItem('Pin')).not.toHaveAttribute('aria-disabled', 'true')
      expect(menuItem('Rename')).toHaveAttribute('aria-disabled', 'true')
      expect(menuItem('Delete')).toHaveAttribute('aria-disabled', 'true')
      expect(menuItem('Upload logo')).toHaveAttribute('aria-disabled', 'true')
    }
  )

  it('allows an explicit admin to rename and leave', () => {
    showMenu()
    expect(menuItem('Rename')).not.toHaveAttribute('aria-disabled', 'true')
    expect(menuItem('Leave')).toBeDefined()
  })

  it('does not offer leaving access inherited from the organization role', () => {
    showMenu({ isOrgAdmin: true })
    expect(menuItem('Leave')).toBeUndefined()
    expect(menuItem('Rename')).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('does not offer leaving the owned workspace or deleting the final workspace', () => {
    showMenu({}, 'owner', 1)
    expect(menuItem('Leave')).toBeUndefined()
    expect(menuItem('Delete')).toHaveAttribute('aria-disabled', 'true')
  })

  it('omits unavailable actions even when the viewer has admin permissions', () => {
    act(() =>
      root.render(
        <WorkspaceContextMenu
          workspace={workspace}
          workspaceCount={2}
          sessionUserId='member'
          isOpen
          position={{ x: 0, y: 0 }}
          menuRef={createRef<HTMLDivElement>()}
          onClose={vi.fn()}
          onRename={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    )
    expect(menuItem('Upload logo')).toBeUndefined()
    expect(menuItem('Leave')).toBeUndefined()
    expect(menuItem('Delete')).toBeUndefined()
    expect(menuItem('Rename')).toBeDefined()
  })
})
