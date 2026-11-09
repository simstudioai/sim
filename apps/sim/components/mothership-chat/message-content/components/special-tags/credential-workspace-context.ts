'use client'

import { createContext, useContext } from 'react'
import { useParams } from 'next/navigation'

export const CredentialWorkspaceContext = createContext<string | undefined>(undefined)

/** Only an authorized card host may override the workspace route. */
export function useCredentialWorkspaceId(): string {
  const explicit = useContext(CredentialWorkspaceContext)
  const params = useParams<{ workspaceId?: string; organizationId?: string }>()
  return explicit ?? (params.organizationId ? '' : (params.workspaceId ?? ''))
}
