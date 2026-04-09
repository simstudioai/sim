/**
 * Billing System Types
 * Centralized type definitions for the billing system
 */
import { z } from 'zod'

export const enterpriseSubscriptionMetadataSchema = z.object({
  plan: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.literal('enterprise')),
  // The referenceId must be provided in Stripe metadata to link to the organization
  // This gets stored in the subscription.referenceId column
  referenceId: z.string().min(1),
  // The fixed monthly price for this enterprise customer (as string from Stripe metadata)
  // This will be used to set the organization's usage limit
  monthlyPrice: z.coerce.number().positive(),
  // Number of seats for invitation limits (not for billing)
  seats: z.coerce.number().int().positive(),
  // Optional custom workspace concurrency limit for enterprise workspaces
  workspaceConcurrencyLimit: z.coerce.number().int().positive().optional(),
})

export type EnterpriseSubscriptionMetadata = z.infer<typeof enterpriseSubscriptionMetadataSchema>

const enterpriseWorkspaceConcurrencyMetadataSchema = z.object({
  workspaceConcurrencyLimit: z.coerce.number().int().positive().optional(),
})

export type EnterpriseWorkspaceConcurrencyMetadata = z.infer<
  typeof enterpriseWorkspaceConcurrencyMetadataSchema
>

export function parseEnterpriseSubscriptionMetadata(
  value: unknown
): EnterpriseSubscriptionMetadata | null {
  const result = enterpriseSubscriptionMetadataSchema.safeParse(value)
  return result.success ? result.data : null
}

export function parseEnterpriseWorkspaceConcurrencyMetadata(
  value: unknown
): EnterpriseWorkspaceConcurrencyMetadata | null {
  const result = enterpriseWorkspaceConcurrencyMetadataSchema.safeParse(value)
  return result.success ? result.data : null
}

export interface UsageData {
  currentUsage: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  lastPeriodCost: number
}

export interface UsageLimitInfo {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  plan: string
  updatedAt: Date | null
}

export interface BillingData {
  currentPeriodCost: number
  projectedCost: number
  limit: number
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  daysRemaining: number
}

export interface SubscriptionPlan {
  name: string
  priceId: string
  limits: {
    cost: number
  }
}

export interface BillingEntity {
  id: string
  type: 'user' | 'organization'
  referenceId: string
  metadata?: { stripeCustomerId?: string; [key: string]: any } | null
  createdAt: Date
  updatedAt: Date
}

export interface BillingConfig {
  id: string
  entityType: 'user' | 'organization'
  entityId: string
  usageLimit: number
  limitSetBy?: string
  limitUpdatedAt?: Date
  billingPeriodType: 'monthly' | 'annual'
  autoResetEnabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface UsagePeriod {
  id: string
  entityType: 'user' | 'organization'
  entityId: string
  periodStart: Date
  periodEnd: Date
  totalCost: number
  finalCost?: number
  isCurrent: boolean
  status: 'active' | 'finalized' | 'billed'
  createdAt: Date
  finalizedAt?: Date
}

export interface BillingStatus {
  status: 'ok' | 'warning' | 'exceeded'
  usageData: UsageData
}

export interface TeamUsageLimit {
  userId: string
  userName: string
  userEmail: string
  currentLimit: number
  currentUsage: number
  totalCost: number
  lastActive: Date | null
  limitSetBy: string | null
  limitUpdatedAt: Date | null
}

export interface BillingSummary {
  userId: string
  email: string
  name: string
  currentPeriodCost: number
  currentUsageLimit: number
  currentUsagePercentage: number
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  plan: string
  subscriptionStatus: string | null
  seats: number | null
  billingStatus: 'ok' | 'warning' | 'exceeded'
}

export interface SubscriptionAPIResponse {
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  plan: string
  status: string | null
  seats: number | null
  metadata: any | null
  usage: UsageData
}

export interface UsageLimitAPIResponse {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  plan: string
  setBy?: string
  updatedAt?: Date
}

// Utility Types
export type PlanType = 'free' | 'pro' | 'team' | 'enterprise'
export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'unpaid'
  | 'trialing'
  | 'incomplete'
  | 'incomplete_expired'
export type BillingEntityType = 'user' | 'organization'
export type BillingPeriodType = 'monthly' | 'annual'
export type UsagePeriodStatus = 'active' | 'finalized' | 'billed'
export type BillingStatusType = 'ok' | 'warning' | 'exceeded'

// Error Types
export interface BillingError {
  code: string
  message: string
  details?: any
}

export interface UpdateUsageLimitResult {
  success: boolean
  error?: string
}

// Hook Types for React
export interface UseSubscriptionStateReturn {
  subscription: {
    isPaid: boolean
    isPro: boolean
    isTeam: boolean
    isEnterprise: boolean
    isFree: boolean
    plan: string
    status?: string
    seats?: number
    metadata?: any
  }
  usage: UsageData
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<any>
  isAtLeastPro: () => boolean
  isAtLeastTeam: () => boolean
  canUpgrade: () => boolean
  getBillingStatus: () => BillingStatusType
  getRemainingBudget: () => number
  getDaysRemainingInPeriod: () => number | null
}

export interface UseUsageLimitReturn {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  plan: string
  setBy?: string
  updatedAt?: Date
  updateLimit: (newLimit: number) => Promise<{ success: boolean }>
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<any>
}
