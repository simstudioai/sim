'use client'

import { useEffect, useLayoutEffect } from 'react'
import { useSidebarStore } from '@/stores/sidebar/store'
import type { SidebarSurface } from '@/stores/sidebar/types'

/**
 * Restores the mounted rail's width before paint and keeps it within the viewport. A navigation
 * between surfaces mounts a new chrome, so this repoints the shared variables in that same commit.
 */
export function useSidebarWidth(surface: SidebarSurface = 'workspace') {
  const syncWidth = useSidebarStore((state) => state.syncWidth)

  useLayoutEffect(() => {
    // Rehydrate first: any store write persists, and would overwrite saved widths with the defaults.
    void useSidebarStore.persist.rehydrate()
    useSidebarStore.getState().setSurface(surface)
  }, [surface])

  useEffect(() => {
    let rafId: number | null = null
    const onResize = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        syncWidth()
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
    }
  }, [syncWidth])
}
