'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import type {
  IntegrationsData,
  OrganizationIntegration,
} from '@/platform/lib/integrations/fixture-model'

type AccountEdits = Pick<
  OrganizationIntegration,
  'account' | 'connectableMethod' | 'connectionCandidate'
>

function useEdits() {
  return useState<Record<string, AccountEdits>>({})
}

const Changes = createContext<ReturnType<typeof useEdits> | null>(null)

interface IntegrationChangesProps {
  children: ReactNode
}

export function IntegrationChanges({ children }: IntegrationChangesProps) {
  const edits = useEdits()
  return <Changes.Provider value={edits}>{children}</Changes.Provider>
}

export function useOrganizationIntegrations(data: IntegrationsData | null) {
  const edits = useContext(Changes)
  if (!edits) throw new Error('Integration controls must be inside the product layout')
  const [accounts, setAccounts] = edits
  return {
    integrations: (data?.integrations ?? []).map((item) => ({
      ...item,
      ...accounts[item.providerId],
    })),
    save(item: OrganizationIntegration) {
      if (!data?.integrations.some(({ providerId }) => providerId === item.providerId)) return
      setAccounts((current) => ({
        ...current,
        [item.providerId]: {
          account: item.account,
          connectableMethod: item.connectableMethod,
          connectionCandidate: item.connectionCandidate,
        },
      }))
    },
  }
}
