export type IntegrationTab = 'apps' | 'skills' | 'mcps' | 'credentials'
type IntegrationScope = 'shared' | 'personal'

export interface IntegrationPerson {
  id: string
  name: string
  src?: string
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
  status?: string
  searchable?: string
  people?: readonly IntegrationPerson[]
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
    | { kind: 'skill'; instructions: string }
    | { kind: 'mcp'; url: string; auth: 'none' | 'bearer' | 'oauth' }
    | { kind: 'credential'; key: string; credentialType: 'secret' | 'api-key' }
  )

export interface IntegrationCenterData {
  viewer: IntegrationPerson
  people: IntegrationPerson[]
  appPeople: Record<string, IntegrationPerson[]>
  resources: IntegrationResource[]
}

import type { ComponentType } from 'react'
