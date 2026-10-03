/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { readCollapsedCookie, useSidebarStore } from '@/stores/sidebar/store'

function setCookie(value: string) {
  document.cookie = `sidebar_collapsed=${value}; path=/`
}

function widthVars() {
  const style = document.documentElement.style
  return {
    width: style.getPropertyValue('--sidebar-width'),
    expanded: style.getPropertyValue('--sidebar-expanded-width'),
  }
}

afterEach(() => {
  document.cookie = 'sidebar_collapsed=; path=/; max-age=0'
})

describe('readCollapsedCookie', () => {
  it('does not treat a substring value like 10 as collapsed', () => {
    setCookie('10')
    expect(readCollapsedCookie()).toBe(false)
  })
})

describe('sidebar width CSS variables', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--sidebar-width')
    document.documentElement.style.removeProperty('--sidebar-expanded-width')
    useSidebarStore.setState({ isCollapsed: false, sidebarWidth: SIDEBAR_WIDTH.DEFAULT })
  })

  it('preserves the restore width when the viewport narrows while collapsed', () => {
    const innerWidth = window.innerWidth
    try {
      window.innerWidth = 1200
      useSidebarStore.getState().setSidebarWidth(300)
      useSidebarStore.getState().toggleCollapsed()
      window.innerWidth = 600
      useSidebarStore.getState().syncWidth()

      expect(widthVars().expanded).toBe(`${SIDEBAR_WIDTH.MIN}px`)
      expect(useSidebarStore.getState().sidebarWidth).toBe(300)

      window.innerWidth = 1200
      useSidebarStore.getState().syncWidth()
      useSidebarStore.getState().toggleCollapsed()
      expect(widthVars()).toEqual({ width: '300px', expanded: '300px' })
    } finally {
      window.innerWidth = innerWidth
    }
  })
})
