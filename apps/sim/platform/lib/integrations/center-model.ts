import type { ComponentType } from 'react'

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
    | { kind: 'credential'; key: string; credentialType: 'secret' | 'api-key' }
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
