// Shared types for the integrations section of the landing site.
// Mirrors the shape written by scripts/generate-docs.ts → writeIntegrationsJson().

export type AuthType = 'oauth' | 'api-key' | 'none'

interface TriggerInfo {
  id: string
  name: string
  description: string
}

interface OperationInfo {
  name: string
  description: string
}

export interface FAQItem {
  question: string
  answer: string
}

export interface IntegrationInstallStep {
  title: string
  body: string
}

export interface IntegrationLandingContent {
  /**
   * Install walkthrough for OAuth apps whose connection lives behind sign-in.
   * Provides the "Add to {app}" instructions that app marketplaces require
   * when the install button sits behind a login.
   */
  install?: {
    heading: string
    intro: string
    steps: IntegrationInstallStep[]
  }
  /** Short data-handling summary shown next to a privacy-policy link. */
  privacy?: {
    body: string
    href: string
  }
  /**
   * Disclaimer about AI-generated content, required by some marketplaces for
   * apps with an AI component (e.g. Slack's AI-components guideline).
   */
  aiDisclaimer?: string
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
  landingContent?: IntegrationLandingContent
}
