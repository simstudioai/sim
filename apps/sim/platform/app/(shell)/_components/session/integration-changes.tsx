'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import {
  type IntegrationsData,
  memberSearchMethod,
  type OrganizationIntegration,
  type WorkspaceAccess,
} from '@/platform/lib/integrations/model'

function useEdits() {
  const [records, setRecords] = useState<Record<string, OrganizationIntegration | null>>({})
  const [grants, setGrants] = useState<Record<string, WorkspaceAccess> | null>(null)
  return { records, setRecords, grants, setGrants }
}

const Changes = createContext<ReturnType<typeof useEdits> | null>(null)

interface IntegrationChangesProps {
  children: ReactNode
}

export function IntegrationChanges({ children }: IntegrationChangesProps) {
  return <Changes.Provider value={useEdits()}>{children}</Changes.Provider>
}

export function useOrganizationIntegrations(data: IntegrationsData | null) {
  const changes = useContext(Changes)
  if (!changes) throw new Error('Integration controls must be inside the product layout')
  const { records, setRecords, grants, setGrants } = changes
  const configured = new Map(data?.integrations.map((item) => [item.providerId, item]))
  for (const [id, edit] of Object.entries(records)) {
    if (edit) configured.set(id, edit)
    else configured.delete(id)
  }
  function save(next: OrganizationIntegration) {
    if (!data) return
    const current = configured.get(next.providerId)
    if (!data.canManage && !current) return
    const provider = data.providers.find((entry) => entry.id === next.providerId)
    if (!provider) return
    const requiredMethod = next.searchApproved && memberSearchMethod(provider)
    const updated =
      requiredMethod && !next.accountMethods.includes(requiredMethod)
        ? { ...next, accountMethods: [...next.accountMethods, requiredMethod] }
        : next
    const previouslyActive = new Set(
      current?.people.filter((person) => person.status !== 'revoked').map((person) => person.id)
    )
    const revoked = new Set(
      next.people
        .filter((person) => person.status === 'revoked' && previouslyActive.has(person.id))
        .map((person) => person.id)
    )
    setRecords((previous) => {
      const updates = { ...previous }
      if (data.canManage && revoked.size) {
        for (const item of configured.values()) {
          if (item.people.some((person) => revoked.has(person.id) && person.status !== 'revoked')) {
            updates[item.providerId] = {
              ...item,
              people: item.people.map((person) =>
                revoked.has(person.id) ? { ...person, status: 'revoked' } : person
              ),
            }
          }
        }
      }
      updates[next.providerId] =
        data.canManage || !current ? updated : { ...current, accounts: next.accounts }
      return updates
    })
  }
  return {
    configured,
    grants: grants ?? data?.workspaceGrants ?? {},
    save,
    remove(id: string) {
      if (data?.canManage) setRecords((previous) => ({ ...previous, [id]: null }))
    },
    setAccess(workspaceId: string, access: WorkspaceAccess | null) {
      if (!data?.canManage) return
      setGrants((previous) => {
        const next = { ...(previous ?? data.workspaceGrants) }
        if (access) next[workspaceId] = access
        else delete next[workspaceId]
        return next
      })
    },
  }
}
