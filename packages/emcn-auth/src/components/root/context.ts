'use client'

import { createContext, useContext } from 'react'

export const PortalContext = createContext<HTMLDivElement | null>(null)

export function useAuthPortal() {
  return useContext(PortalContext)
}
