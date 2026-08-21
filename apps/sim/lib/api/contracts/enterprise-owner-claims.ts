import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const enterpriseOwnerClaimParamsSchema = z.object({ id: z.string().min(1) })
export const enterpriseOwnerClaimQuerySchema = z.object({ token: z.string().min(1) })

export const enterpriseOwnerClaimViewSchema = z.object({
  id: z.string(),
  ownerEmail: z.string().email(),
  organizationName: z.string(),
  organizationId: z.string().nullable(),
  provisioningOperationId: z.string().nullable(),
  stage: z.enum([
    'owner_email',
    'owner_acceptance',
    'activation',
    'stripe_provisioning',
    'complete',
  ]),
  status: z.enum([
    'sending',
    'awaiting_owner',
    'activating',
    'provisioning',
    'applied',
    'failed',
    'expired',
    'revoked',
  ]),
  error: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const enterpriseOwnerClaimDetailsSchema = enterpriseOwnerClaimViewSchema.extend({
  invoiceAmountUsd: z.number().positive(),
  billingInterval: z.enum(['month', 'year']),
  seats: z.number().int().positive(),
  invitations: z.number().int().nonnegative(),
  workspacePreview: z
    .object({
      workspacesToMove: z.array(
        z.object({ id: z.string(), name: z.string(), archived: z.boolean() })
      ),
      createsDefaultWorkspace: z.boolean(),
    })
    .nullable(),
  acceptanceReview: z
    .object({
      canAccept: z.boolean(),
      reason: z.string().nullable(),
      requiredSeats: z.number().int().positive().nullable(),
    })
    .nullable(),
})

export const acceptEnterpriseOwnerClaimBodySchema = z.object({
  token: z.string().min(1),
  disclosedWorkspaceIds: z.array(z.string().min(1)).max(1_000),
  disclosedCreatesDefaultWorkspace: z.boolean(),
})

export const getEnterpriseOwnerClaimContract = defineRouteContract({
  method: 'GET',
  path: '/api/enterprise-owner-claims/[id]',
  params: enterpriseOwnerClaimParamsSchema,
  query: enterpriseOwnerClaimQuerySchema,
  response: { mode: 'json', schema: enterpriseOwnerClaimDetailsSchema },
})

export const acceptEnterpriseOwnerClaimContract = defineRouteContract({
  method: 'POST',
  path: '/api/enterprise-owner-claims/[id]/accept',
  params: enterpriseOwnerClaimParamsSchema,
  body: acceptEnterpriseOwnerClaimBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      claim: enterpriseOwnerClaimViewSchema,
      redirectPath: z.string().min(1),
    }),
  },
})

export type EnterpriseOwnerClaimDetails = z.output<typeof enterpriseOwnerClaimDetailsSchema>
