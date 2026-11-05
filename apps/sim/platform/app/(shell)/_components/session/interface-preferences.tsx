'use client'

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import type { HomeMode, HomeWidget } from '@/platform/app/(shell)/_components/model'

function usePreferenceState() {
  const [cookieChoices, setCookieChoices] = useState<Record<string, boolean>>({})
  const [profileName, setProfileName] = useState<string>()
  const [picture, setPicture] = useState<string>()
  useEffect(
    () => () => {
      if (picture) URL.revokeObjectURL(picture)
    },
    [picture]
  )
  function updatePicture(file?: File) {
    if (file?.type.startsWith('image/')) setPicture(URL.createObjectURL(file))
  }
  const [homeMode, setHomeMode] = useState<HomeMode>('Build')
  const [hiddenWidgets, setHiddenWidgets] = useState<HomeWidget[]>([])
  const [removedRecents, setRemovedRecents] = useState<string[]>([])
  const [connections, setConnections] = useState<Partial<Record<'Email' | 'Calendar', boolean>>>({})

  return {
    cookieChoices,
    setCookieChoices,
    profileName,
    setProfileName,
    picture,
    updatePicture,
    homeMode,
    setHomeMode,
    hiddenWidgets,
    setHiddenWidgets,
    removedRecents,
    setRemovedRecents,
    connections,
    setConnections,
  }
}

const Preferences = createContext<ReturnType<typeof usePreferenceState> | null>(null)

interface InterfacePreferencesProps {
  children: ReactNode
}

export function InterfacePreferences({ children }: InterfacePreferencesProps) {
  const preferences = usePreferenceState()
  return <Preferences.Provider value={preferences}>{children}</Preferences.Provider>
}

export function useInterfacePreferences() {
  return useContext(Preferences)
}

/** A dismissal applies to both Home and the chat panel for this interface session. */
export function useRecentHistory<T extends { id: string }>(history: readonly T[]) {
  const session = useInterfacePreferences()
  if (!session) throw new Error('Recents need an interface session')
  const { removedRecents, setRemovedRecents } = session
  return {
    recents: history.filter((item) => !removedRecents.includes(item.id)),
    removeRecent: (id: string) => setRemovedRecents((items) => [...items, id]),
  }
}
