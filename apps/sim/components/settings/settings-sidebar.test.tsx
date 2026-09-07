/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { Users } from '@sim/emcn/icons'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPush, mockReplace, mockNavigate } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/o/org-a/settings/members',
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))
vi.mock('@/app/(landing)/components/navbar/components', () => ({ SimWordmark: () => null }))
vi.mock('@/components/settings/settings-intent-link', () => ({
  SettingsIntentLink: ({
    onNavigate,
    replace: _replace,
    scroll: _scroll,
    ...props
  }: ComponentProps<'a'> & {
    replace?: boolean
    scroll?: boolean
    onNavigate?: (event: { preventDefault: () => void }) => void
  }) => (
    <a
      {...props}
      href={props.href}
      onClick={(event) => {
        event.preventDefault()
        let prevented = false
        onNavigate?.({
          preventDefault: () => {
            prevented = true
          },
        })
        if (!prevented) mockNavigate(props.href)
      }}
    />
  ),
}))

import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  useSettingsDirtyStore.getState().reset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useSettingsDirtyStore.getState().reset()
})

function renderSidebar(isCollapsed = false) {
  act(() =>
    root.render(
      <SettingsSidebar
        plane='organization'
        activeSection='members'
        groups={[{ key: 'organization', title: 'Organization' }]}
        items={[
          { id: 'members', label: 'Members', group: 'organization', icon: Users },
          { id: 'search-mcp', label: 'Search MCP', group: 'organization', icon: Users },
        ]}
        hrefForSection={(section) => `/o/org-a/settings/${section}`}
        backHref='/o/org-a/home'
        isCollapsed={isCollapsed}
      />
    )
  )
}

function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!element) throw new Error(`Missing button: ${label}`)
  return element
}

describe('SettingsSidebar interactions', () => {
  it('keeps destinations available in the icon rail after collapsing a section', () => {
    renderSidebar()
    act(() => button('Organization').click())
    expect(container.querySelector('a')).toBeNull()

    renderSidebar(true)
    expect(container.querySelectorAll('a')).toHaveLength(2)

    renderSidebar()
    expect(button('Organization')).toHaveAttribute('aria-expanded', 'false')
    act(() => button('Organization').click())
    expect(container.querySelectorAll('a')).toHaveLength(2)
  })

  it('preserves dirty settings when Back is cancelled, then leaves only after confirmation', () => {
    renderSidebar()
    act(() => useSettingsDirtyStore.getState().setDirty(true))
    act(() => button('Back').click())
    expect(mockPush).not.toHaveBeenCalled()
    act(() => button('Keep editing').click())
    expect(useSettingsDirtyStore.getState().isDirty).toBe(true)
    expect(mockPush).not.toHaveBeenCalled()

    act(() => button('Back').click())
    act(() => button('Discard changes').click())
    expect(mockPush).toHaveBeenCalledWith('/o/org-a/home')
  })

  it('blocks section navigation during a save even when the draft is already clean', () => {
    renderSidebar()
    act(() => useSettingsDirtyStore.getState().setNavigationBlocked(true))
    act(() => container.querySelector<HTMLAnchorElement>('a[href$="search-mcp"]')?.click())
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()

    act(() => useSettingsDirtyStore.getState().setNavigationBlocked(false))
    act(() => container.querySelector<HTMLAnchorElement>('a[href$="search-mcp"]')?.click())
    expect(mockNavigate).toHaveBeenCalledWith('/o/org-a/settings/search-mcp')
  })
})
