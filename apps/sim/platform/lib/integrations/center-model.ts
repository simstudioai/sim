import type { ComponentType } from 'react'
import type { CredentialMember } from '@/platform/lib/integrations/credential-model'
import type { ManualSecretType } from '@/platform/lib/integrations/manual-secret'

export type IntegrationTab = 'apps' | 'skills' | 'mcps' | 'credentials'
type IntegrationScope = 'shared' | 'personal'

export interface IntegrationPerson {
  id: string
  name: string
  src?: string
  email?: string
}

export interface AppSummary {
  id: string
  providerId?: string
  icon?: ComponentType<{ className?: string }>
  name: string
  description: string
  category: string
  href: string
  connected: boolean
  credentialCount?: number
  searchable?: string
  people?: readonly IntegrationPerson[]
  peopleTotal?: number
  scope?: IntegrationScope
  /**
   * Set for an app the viewer's permission group withholds but lets them ask for: the row reads
   * Restricted and opens the access request instead of the app.
   */
  requestAccess?: () => void
}

interface ResourceIdentity {
  id: string
  name: string
  description: string
  scope: IntegrationScope
  owner: IntegrationPerson
  people: readonly IntegrationPerson[]
  canEdit: boolean
}

export type IntegrationResource = ResourceIdentity &
  (
    | { kind: 'skill'; instructions: string; source?: { providerId: string; name: string } }
    | { kind: 'mcp'; url: string; auth: 'none' | 'bearer' | 'oauth' }
    | {
        kind: 'credential'
        key: string
        credentialType: ManualSecretType
        appId?: string
        members?: readonly CredentialMember[]
      }
  )

export interface IntegrationCenterData {
  organization: { id: string; name: string }
  viewer: IntegrationPerson
  workspaces: readonly { id: string; name: string; memberIds: readonly string[] }[]
  people: IntegrationPerson[]
  appPeople: Record<string, IntegrationPerson[]>
  appUsageTotal: Record<string, number>
  resources: IntegrationResource[]
}
