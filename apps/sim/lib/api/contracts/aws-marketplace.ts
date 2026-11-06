import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'

/**
 * The form AWS Marketplace posts to the fulfillment URL. It is not a route contract: the buyer's
 * browser submits it as `application/x-www-form-urlencoded`, and the route answers with a redirect.
 */
export const awsMarketplaceRegistrationFormSchema = z.object({
  'x-amzn-marketplace-token': z.string().min(1, 'Registration token is required').max(4096),
})

/** AWS requires the registration page to collect the buyer's email; the company is optional. */
const buyerContactSchema = z.object({
  contactEmail: z
    .string()
    .trim()
    .min(1, 'Contact email is required')
    .max(254, 'Contact email must be at most 254 characters')
    .email('Enter a valid contact email'),
  companyName: z.string().trim().max(200, 'Company name must be at most 200 characters').optional(),
})

const awsMarketplaceLicenseSummarySchema = z.object({
  id: z.string(),
  status: z.enum(['active', 'inactive']),
  dimension: z.string().nullable(),
  quantity: z.number().int().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  /** The organization this license is already linked to, if any. */
  organizationId: z.string().nullable(),
})

const awsMarketplaceClaimOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['owner', 'admin']),
})

const awsMarketplaceClaimSchema = z.discriminatedUnion('status', [
  /** This browser holds no claim, or one already used. */
  z.object({ status: z.literal('missing') }),
  z.object({ status: z.literal('expired') }),
  z.object({
    status: z.literal('ready'),
    license: awsMarketplaceLicenseSummarySchema,
    /** Organizations the viewer owns or administers, in name order. */
    organizations: z.array(awsMarketplaceClaimOrganizationSchema),
  }),
])
export type AwsMarketplaceClaim = z.output<typeof awsMarketplaceClaimSchema>

/** The claim this browser holds, read from its httpOnly claim cookie. */
export const getAwsMarketplaceClaimContract = defineRouteContract({
  method: 'GET',
  path: '/api/marketplace/aws/claim',
  response: { mode: 'json', schema: awsMarketplaceClaimSchema },
})

export const linkAwsMarketplaceLicenseContract = defineRouteContract({
  method: 'POST',
  path: '/api/marketplace/aws/claim/link',
  body: buyerContactSchema.extend({
    licenseId: z.string().min(1, 'License ID is required').max(255),
    organizationId: organizationIdSchema,
  }),
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), organizationId: z.string() }),
  },
})

/** Registers the claimed license to the signed-in account when no organization is chosen. */
export const registerAwsMarketplaceLicenseToAccountContract = defineRouteContract({
  method: 'POST',
  path: '/api/marketplace/aws/claim/register-account',
  body: buyerContactSchema.extend({
    licenseId: z.string().min(1, 'License ID is required').max(255),
  }),
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

const organizationAwsMarketplaceLicenseSchema = z.object({
  id: z.string(),
  status: z.enum(['active', 'inactive']),
  dimension: z.string().nullable(),
  quantity: z.number().int().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  lastVerifiedAt: z.iso.datetime(),
})

/** The Marketplace licenses linked to an organization, for its billing page. */
export const listOrganizationAwsMarketplaceLicensesContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/aws-marketplace-licenses',
  params: z.object({ id: organizationIdSchema }),
  response: {
    mode: 'json',
    schema: z.object({ licenses: z.array(organizationAwsMarketplaceLicenseSchema) }),
  },
})
