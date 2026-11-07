'use client'

import { createContext, type ReactNode, useContext } from 'react'

const PortalContainerContext = createContext<HTMLElement | null>(null)

interface PortalContainerProviderProps {
  container: HTMLElement | null
  children: ReactNode
}

/** Keeps embedded legacy overlays within their host's scoped theme. */
export function PortalContainerProvider({ container, children }: PortalContainerProviderProps) {
  return <PortalContainerContext value={container}>{children}</PortalContainerContext>
}

export function usePortalContainer() {
  return useContext(PortalContainerContext)
}
