import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'

/**
 * The form AWS Marketplace posts to the fulfillment URL. It is not a route contract: the buyer's
 * browser submits it as `application/x-www-form-urlencoded`, and the route answers with a redirect.
 */
export const awsMarketplaceRegistrationFormSchema = z.object({
  'x-amzn-marketplace-token': z.string().regex(/^\S+$/, 'Registration token is required'),
})

/** AWS requires the registration page to collect the buyer's email; the company is optional. */
const buyerContactSchema = z.object({
  contactEmail: z
    .string()
    .trim()
    .min(1, 'Contact email is required')
    .max(254, 'Contact email must be at most 254 characters')
    .email('Enter a valid contact email'),
  companyName: z
    .string()
    .trim()
    .max(200, 'Company name must be at most 200 characters')
    .regex(/^[^\r\n]*$/, 'Company name must be a single line')
    .optional(),
})

const claimActionBodySchema = buyerContactSchema.extend({
  licenseId: z.string().min(1, 'License ID is required').max(255),
})

const awsMarketplaceLicenseSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'active', 'inactive']),
  dimension: z.string().nullable(),
  quantity: z.number().int().nullable(),
  expiresAt: z.iso.datetime().nullable(),
})

const claimedLicenseSchema = awsMarketplaceLicenseSchema.extend({
  /** The buyer's AWS account, masked: only they should recognize it. */
  awsAccount: z.string(),
  contactEmail: z.string().nullable(),
  companyName: z.string().nullable(),
})

const awsMarketplaceClaimSchema = z.discriminatedUnion('status', [
  /** No open claim: none in this browser, or it was used, expired, or cleared by a lapse. */
  z.object({ status: z.literal('missing') }),
  /** AWS has returned no entitlement yet; the buyer can leave contact details meanwhile. */
  z.object({ status: z.literal('pending'), license: claimedLicenseSchema }),
  z.object({
    status: z.literal('linked'),
    /** Named only when the viewer administers it. */
    organizationId: z.string().nullable(),
  }),
  z.object({
    status: z.literal('ready'),
    license: claimedLicenseSchema,
    /** Organizations the viewer owns or administers, in name order. */
    organizations: z.array(z.object({ id: z.string(), name: z.string() })),
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
  body: claimActionBodySchema.extend({ organizationId: organizationIdSchema }),
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

/** Registers the claimed license to the signed-in account when no organization is chosen. */
export const registerAwsMarketplaceLicenseToAccountContract = defineRouteContract({
  method: 'POST',
  path: '/api/marketplace/aws/claim/register-account',
  body: claimActionBodySchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

/** Saves a pending buyer's contact details and asks AWS again; the claim stays open. */
export const saveAwsMarketplaceClaimContactContract = defineRouteContract({
  method: 'POST',
  path: '/api/marketplace/aws/claim/contact',
  body: claimActionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ status: z.enum(['pending', 'active', 'inactive']) }),
  },
})

const awsMarketplaceLicenseListSchema = z.object({
  licenses: z.array(awsMarketplaceLicenseSchema.extend({ lastVerifiedAt: z.iso.datetime() })),
})

/** The Marketplace licenses linked to an organization, for its billing page. */
export const listOrganizationAwsMarketplaceLicensesContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/aws-marketplace-licenses',
  params: z.object({ id: organizationIdSchema }),
  response: { mode: 'json', schema: awsMarketplaceLicenseListSchema },
})

/** The licenses registered to the viewer's account with no organization, for personal billing. */
export const listAccountAwsMarketplaceLicensesContract = defineRouteContract({
  method: 'GET',
  path: '/api/marketplace/aws/licenses',
  response: { mode: 'json', schema: awsMarketplaceLicenseListSchema },
})
