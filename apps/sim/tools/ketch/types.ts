import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Ketch API responses.
 * Based on Ketch Web API: https://github.com/ketch-sdk/ketch-web-api
 * Types reference: https://github.com/ketch-sdk/ketch-types
 */

export const CONSENT_PURPOSE_OUTPUT_PROPERTIES = {
  allowed: {
    type: 'string',
    description: 'Consent status for the purpose: "granted" or "denied"',
  },
  legalBasisCode: {
    type: 'string',
    description:
      'Legal basis code (e.g., "consent_optin", "consent_optout", "disclosure", "other")',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface KetchGetConsentParams {
  organizationCode: string
  propertyCode: string
  environmentCode: string
  jurisdictionCode?: string
  identities: Record<string, string>
  purposes?: Record<string, Record<string, unknown>>
}

export interface KetchGetConsentResponse extends ToolResponse {
  output: {
    purposes: Record<string, { allowed: string; legalBasisCode?: string }>
    vendors: Record<string, string> | null
  }
}

export interface KetchSetConsentParams {
  organizationCode: string
  propertyCode: string
  environmentCode: string
  jurisdictionCode?: string
  identities: Record<string, string>
  purposes: Record<string, { allowed: string; legalBasisCode?: string }>
  collectedAt?: number
}

export interface KetchSetConsentResponse extends ToolResponse {
  output: {
    purposes: Record<string, { allowed: string; legalBasisCode?: string }>
  }
}

export interface KetchInvokeRightParams {
  organizationCode: string
  propertyCode: string
  environmentCode: string
  jurisdictionCode: string
  rightCode: string
  identities: Record<string, string>
  userData?: {
    email?: string
    firstName?: string
    lastName?: string
  }
}

export interface KetchInvokeRightResponse extends ToolResponse {
  output: {
    success: boolean
    message: string | null
  }
}

export interface SubscriptionControlSetting {
  status: string
}

export interface SubscriptionTopicContactMethodSetting {
  status: string
}

export interface KetchGetSubscriptionsParams {
  organizationCode: string
  propertyCode: string
  environmentCode: string
  identities: Record<string, string>
}

export interface KetchGetSubscriptionsResponse extends ToolResponse {
  output: {
    topics: Record<string, Record<string, SubscriptionTopicContactMethodSetting>>
    controls: Record<string, SubscriptionControlSetting>
  }
}

export interface KetchSetSubscriptionsParams {
  organizationCode: string
  propertyCode: string
  environmentCode: string
  identities: Record<string, string>
  topics?: Record<string, Record<string, SubscriptionTopicContactMethodSetting>>
  controls?: Record<string, SubscriptionControlSetting>
}

export interface KetchSetSubscriptionsResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export type KetchResponse =
  | KetchGetConsentResponse
  | KetchSetConsentResponse
  | KetchInvokeRightResponse
  | KetchGetSubscriptionsResponse
  | KetchSetSubscriptionsResponse
