// Shared types for the integrations section of the landing site.
// Mirrors the shape written by scripts/generate-docs.ts → writeIntegrationsJson().

export type AuthType = 'oauth' | 'api-key' | 'none'

export interface TriggerInfo {
  id: string
  name: string
  description: string
}

export interface OperationInfo {
  name: string
  description: string
}

export interface FAQItem {
  question: string
  answer: string
}

export interface Integration {
  type: string
  slug: string
  name: string
  description: string
  longDescription: string
  bgColor: string
  iconName: string
  docsUrl: string
  operations: OperationInfo[]
  operationCount: number
  triggers: TriggerInfo[]
  triggerCount: number
  authType: AuthType
  category: string
  integrationTypes?: string[]
  tags?: string[]
}
