'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import type { HomeWidget } from '@/platform/design-system/models/conversation'

function usePreferenceState() {
  const [hiddenWidgets, setHiddenWidgets] = useState<HomeWidget[]>([])
  const [connections, setConnections] = useState<Partial<Record<'Email' | 'Calendar', boolean>>>({})

  const [inApp, setInApp] = useState(true)
  const [sound, setSound] = useState(false)
  const [systemFont, setSystemFont] = useState(false)
  const [systemMono, setSystemMono] = useState(false)
  return {
    hiddenWidgets,
    setHiddenWidgets,
    connections,
    setConnections,
    inApp,
    setInApp,
    sound,
    setSound,
    systemFont,
    setSystemFont,
    systemMono,
    setSystemMono,
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
