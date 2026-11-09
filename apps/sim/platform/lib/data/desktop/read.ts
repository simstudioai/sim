'use client'

import { type Dispatch, type SetStateAction, useEffect, useEffectEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getDesktopBridge } from '@/lib/desktop'
import type { BrowserCredential, DesktopApi } from '@/platform/lib/data/desktop/model'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

interface DesktopRead<T> {
  data: T | null
  setData: Dispatch<SetStateAction<T | null>>
  failed: boolean
  retry: () => void
}

/**
 * What a device settings page shows, read from the desktop shell when it opens. Outside a shell that
 * offers the page it sends the viewer to General, as the legacy pages did. A failed read stays apart
 * from a pending one, and `retry` reads again.
 */
export function useDesktopRead<T>(
  read: (bridge: DesktopApi) => Promise<T>,
  offers: (bridge: DesktopApi) => boolean = () => true
): DesktopRead<T> {
  const router = useRouter()
  const generalHref = surfaceHref(useSurfaceScope(), '/settings/general')
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const readFrom = useEffectEvent(read)
  const isOffered = useEffectEvent(offers)
  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge || !isOffered(bridge)) {
      router.replace(generalHref)
      return
    }
    let current = true
    readFrom(bridge).then(
      (next) => {
        if (current) setData(next)
      },
      () => {
        if (current) setFailed(true)
      }
    )
    return () => {
      current = false
    }
  }, [router, attempt, generalHref])
  return {
    data,
    setData,
    failed,
    retry: () => {
      setFailed(false)
      setAttempt((value) => value + 1)
    },
  }
}

/** Saved browser logins, without passwords; none when this device cannot store them securely. */
export async function readBrowserCredentials(): Promise<BrowserCredential[]> {
  const credentials = getDesktopBridge()?.browserCredentials
  if (!credentials) return []
  const available = await credentials.isAvailable().catch(() => false)
  return available ? await credentials.list().catch(() => []) : []
}
