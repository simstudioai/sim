'use client'

import { type ReactNode, useState } from 'react'
import { PortalContext } from '#auth/components/root/context'
import '#auth/styles/auth.css'

interface AuthRootProps {
  children: ReactNode
  className?: string
}
/** Provides the Auth styling and portal boundary without owning authentication state. */
export function AuthRoot({ children, className }: AuthRootProps) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  return (
    <div data-emcn='' data-auth-root='' className={className}>
      <PortalContext.Provider value={portal}>
        {children}
        <div ref={setPortal} data-auth-portals='' />
      </PortalContext.Provider>
    </div>
  )
}
