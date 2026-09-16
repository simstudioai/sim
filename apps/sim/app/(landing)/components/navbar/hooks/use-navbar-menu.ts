'use client'

import { useCallback, useEffect, useState } from 'react'
import { useNavbarFrost } from '@/app/(landing)/components/navbar/components/navbar-shell'

/** Matches the navbar's `xl` visibility boundary. */
const DESKTOP_QUERY = '(min-width: 1280px)'

/** Releases the shared scroll lock whenever a navigation surface becomes hidden. */
export function useNavbarMenu(source: 'desktop' | 'mobile') {
  const frost = useNavbarFrost()
  const [open, setOpen] = useState(false)
  const updateOpen = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      frost?.setMenuOpen(source, nextOpen)
    },
    [frost, source]
  )

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY)
    const onBreakpointChange = () => {
      if (media.matches !== (source === 'desktop')) updateOpen(false)
    }
    media.addEventListener('change', onBreakpointChange)
    return () => {
      media.removeEventListener('change', onBreakpointChange)
      frost?.setMenuOpen(source, false)
    }
  }, [frost, source, updateOpen])

  return { open, updateOpen }
}
