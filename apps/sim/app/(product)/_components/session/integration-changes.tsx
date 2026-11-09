'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import type {
  IntegrationsData,
  OrganizationIntegration,
} from '@/platform/lib/integrations/fixture-model'

function useEdits() {
  return useState<Record<string, IntegrationCredential | null>>({})
}

const Changes = createContext<ReturnType<typeof useEdits> | null>(null)

interface IntegrationChangesProps {
  children: ReactNode
}

export function IntegrationChanges({ children }: IntegrationChangesProps) {
  const edits = useEdits()
  return <Changes.Provider value={edits}>{children}</Changes.Provider>
}

function metadata(credential: IntegrationCredential): IntegrationCredential {
  const {
    id,
    appId,
    providerId,
    type,
    displayName,
    description,
    accountLabel,
    instanceUrl,
    instanceLabel,
    role,
    status,
    canReconnect,
    scope,
    members,
    permissions,
  } = credential
  return {
    id,
    appId,
    providerId,
    type,
    displayName,
    description,
    accountLabel,
    instanceUrl,
    instanceLabel,
    role,
    status,
    canReconnect,
    scope,
    permissions,
    members: members.map(
      ({ id, userId, name, email, src, role, roleSource, explicitAdmin, status }) => ({
        id,
        userId,
        name,
        email,
        src,
        role,
        roleSource,
        explicitAdmin,
        status,
      })
    ),
  }
}

/** A family credential is edited by its canonical ID across every app that displays it. */
export function useOrganizationIntegrations(data: IntegrationsData | null) {
  const edits = useContext(Changes)
  if (!edits) throw new Error('Integration controls must be inside the product layout')
  const [credentials, setCredentials] = edits
  const roster = new Map<string, IntegrationCredential | null>(
    data?.integrations.flatMap((item) =>
      item.credentials.map((credential) => [credential.id, credential] as const)
    )
  )
  for (const [id, credential] of Object.entries(credentials)) roster.set(id, credential)
  const visible = [...roster.values()].filter((credential): credential is IntegrationCredential =>
    Boolean(credential)
  )
  const integrations = (data?.integrations ?? []).map((item) => ({
    ...item,
    credentials: visible.filter(
      (credential) =>
        credential.appId === item.providerId ||
        item.credentialProviders.includes(credential.providerId)
    ),
  }))
  return {
    integrations,
    save(item: OrganizationIntegration) {
      const previous = integrations.find(({ providerId }) => providerId === item.providerId)
      if (!data || !previous) return
      setCredentials((current) => {
        const next = { ...current }
        const retained = new Set(item.credentials.map(({ id }) => id))
        for (const credential of previous.credentials) {
          if (!retained.has(credential.id)) next[credential.id] = null
        }
        for (const credential of item.credentials) next[credential.id] = metadata(credential)
        return next
      })
    },
  }
}
