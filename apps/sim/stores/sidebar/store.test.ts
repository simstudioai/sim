/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { getMaxSidebarWidth, readCollapsedCookie, useSidebarStore } from './store'

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
  it('is true only for an exact value of 1', () => {
    setCookie('1')
    expect(readCollapsedCookie()).toBe(true)
  })

  it('is false for 0', () => {
    setCookie('0')
    expect(readCollapsedCookie()).toBe(false)
  })

  it('does not treat a substring value like 10 as collapsed', () => {
    setCookie('10')
    expect(readCollapsedCookie()).toBe(false)
  })

  it('is false when the cookie is absent', () => {
    expect(readCollapsedCookie()).toBe(false)
  })
})

describe('sidebar width CSS variables', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--sidebar-width')
    document.documentElement.style.removeProperty('--sidebar-expanded-width')
    useSidebarStore.setState({ isCollapsed: false, sidebarWidth: SIDEBAR_WIDTH.DEFAULT })
  })

  it('publishes both variables when the width changes while expanded', () => {
    useSidebarStore.getState().setSidebarWidth(300)
    expect(widthVars()).toEqual({ width: '300px', expanded: '300px' })
  })

  it('keeps the expanded variable at the restore width while collapsed', () => {
    useSidebarStore.getState().setSidebarWidth(300)
    useSidebarStore.getState().toggleCollapsed()

    expect(useSidebarStore.getState().isCollapsed).toBe(true)
    expect(widthVars()).toEqual({
      width: `${SIDEBAR_WIDTH.COLLAPSED}px`,
      expanded: '300px',
    })
  })

  it('restores the collapsed width from the expanded variable on expand', () => {
    useSidebarStore.getState().setSidebarWidth(300)
    useSidebarStore.getState().toggleCollapsed()
    useSidebarStore.getState().toggleCollapsed()

    expect(widthVars()).toEqual({ width: '300px', expanded: '300px' })
  })

  it('holds the expanded width across a syncWidth while collapsed', () => {
    useSidebarStore.getState().setSidebarWidth(300)
    useSidebarStore.getState().toggleCollapsed()
    document.documentElement.style.removeProperty('--sidebar-expanded-width')

    useSidebarStore.getState().syncWidth()

    expect(widthVars()).toEqual({
      width: `${SIDEBAR_WIDTH.COLLAPSED}px`,
      expanded: '300px',
    })
  })

  it('clamps a below-minimum persisted width into the expanded variable', () => {
    useSidebarStore.setState({ isCollapsed: true, sidebarWidth: 10 })

    useSidebarStore.getState().syncWidth()

    expect(widthVars().expanded).toBe(`${SIDEBAR_WIDTH.MIN}px`)
  })
})

describe('getMaxSidebarWidth', () => {
  it('scales with the viewport below the cap', () => {
    expect(getMaxSidebarWidth(1000)).toBe(1000 * SIDEBAR_WIDTH.MAX_PERCENTAGE)
  })

  it('caps a wide viewport at the absolute maximum', () => {
    expect(getMaxSidebarWidth(4000)).toBe(SIDEBAR_WIDTH.MAX)
  })

  it('never drops below the minimum on a narrow viewport', () => {
    expect(getMaxSidebarWidth(400)).toBe(SIDEBAR_WIDTH.MIN)
  })
})
