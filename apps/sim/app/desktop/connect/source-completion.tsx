'use client'

import { useEffect } from 'react'
import {
  type DesktopSourceCompletion,
  finishDesktopSourceBrowser,
} from '@/lib/desktop/source-browser'

interface SourceCompletionProps extends DesktopSourceCompletion {}

/** Mounted by terminal pages after their existing server-side authorization checks. */
export function SourceCompletion({ kind, id, error }: SourceCompletionProps) {
  useEffect(() => {
    void finishDesktopSourceBrowser({ kind, id, error })
  }, [kind, id, error])
  return null
}
