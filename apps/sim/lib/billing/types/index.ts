/**
 * Billing System Types
 * Centralized type definitions for the billing system
 */
import { z } from 'zod'
import { MAX_BILLING_CONCURRENCY_LIMIT } from '@/lib/billing/concurrency-defaults'
import {
  MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS,
  parseWorkflowExecutionTimeoutSeconds,
} from '@/lib/billing/execution-timeout-defaults'

export const enterpriseSubscriptionMetadataSchema = z
  .object({
    plan: z
      .string()
      .transform((v) => v.toLowerCase())
      .pipe(z.literal('enterprise')),
    referenceId: z.string().min(1),
    invoiceAmountCents: z.coerce.number().int().positive().optional(),
    /** Legacy monthly Enterprise metadata retained for existing subscriptions. */
    monthlyPrice: z.coerce.number().positive().optional(),
    seats: z.coerce.number().int().positive(),
    reportingPeriodAnchorDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`)
        return (
          Number.isFinite(parsed.getTime()) &&
          parsed.toISOString().slice(0, 10) === value &&
          parsed.getTime() <= Date.now()
        )
      }, 'Reporting-period anchor must be a valid UTC date that is not in the future')
      .optional(),
    concurrencyLimit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_BILLING_CONCURRENCY_LIMIT)
      .optional(),
    workflowExecutionTimeoutSeconds: z.preprocess(
      (value) => parseWorkflowExecutionTimeoutSeconds(value) ?? undefined,
      z.number().int().positive().max(MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS).optional()
    ),
  })
  .refine(
    (metadata) => metadata.invoiceAmountCents !== undefined || metadata.monthlyPrice !== undefined,
    { error: 'Enterprise invoice amount metadata is required' }
  )
  .transform((metadata) => ({
    ...metadata,
    invoiceAmountUsd:
      metadata.invoiceAmountCents !== undefined
        ? metadata.invoiceAmountCents / 100
        : (metadata.monthlyPrice as number),
  }))

export type EnterpriseSubscriptionMetadata = z.infer<typeof enterpriseSubscriptionMetadataSchema>

export function parseEnterpriseSubscriptionMetadata(
  value: unknown
): EnterpriseSubscriptionMetadata | null {
  const result = enterpriseSubscriptionMetadataSchema.safeParse(value)
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
  /**
   * Whether the limit is stored on the user (`'user'`) or the organization
   * (`'organization'`). Callers should route edits to the matching API
   * context. Org-scoped includes any subscription whose `referenceId` is
   * an organization id, regardless of plan name.
   */
  scope: 'user' | 'organization'
  /** Present only when `scope === 'organization'`. */
  organizationId: string | null
}

export interface BillingData {
  currentPeriodCost: number
  projectedCost: number
  limit: number
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  daysRemaining: number
}

interface SubscriptionPlan {
  name: string
  priceId: string
  limits: {
    cost: number
  }
}

interface BillingEntity {
  id: string
  type: 'user' | 'organization'
  referenceId: string
  metadata?: { stripeCustomerId?: string; [key: string]: any } | null
  createdAt: Date
  updatedAt: Date
}

interface BillingConfig {
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

interface UsagePeriod {
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

interface BillingStatus {
  status: 'ok' | 'warning' | 'exceeded'
  usageData: UsageData
}

interface TeamUsageLimit {
  userId: string
  userName: string
  userEmail: string
  currentLimit: number
  currentUsage: number
  limitSetBy: string | null
  limitUpdatedAt: Date | null
}

interface BillingSummary {
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

interface SubscriptionAPIResponse {
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

interface UsageLimitAPIResponse {
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
interface BillingError {
  code: string
  message: string
  details?: any
}

interface UpdateUsageLimitResult {
  success: boolean
  error?: string
}

// Hook Types for React
interface UseSubscriptionStateReturn {
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

interface UseUsageLimitReturn {
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
