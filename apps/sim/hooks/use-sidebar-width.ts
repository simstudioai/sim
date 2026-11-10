'use client'

import { useEffect, useLayoutEffect } from 'react'
import { useSidebarStore } from '@/stores/sidebar/store'

/** Restores the mounted rail's width before paint and keeps it within the viewport. */
export function useSidebarWidth() {
  const syncWidth = useSidebarStore((state) => state.syncWidth)

  useLayoutEffect(() => {
    // Rehydrate first: any store write persists, and would overwrite the saved width with the default.
    void useSidebarStore.persist.rehydrate()
    syncWidth()
  }, [syncWidth])

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
