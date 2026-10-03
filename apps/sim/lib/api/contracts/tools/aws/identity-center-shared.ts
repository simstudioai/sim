import { z } from 'zod'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

/**
 * Shared boundary schemas for the AWS IAM Identity Center tool family.
 *
 * Every pattern and bound below is the one AWS publishes for the shape, so a
 * malformed identifier is rejected at the boundary with a readable message
 * instead of surfacing as an opaque AWS `ValidationException`.
 */

export const identityCenterRegionSchema = z
  .string()
  .min(1, 'AWS region is required')
  .refine((value) => validateAwsRegion(value).isValid, {
    message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2, us-gov-west-1)',
  })

/** Region plus static credentials, present on every tool in the family. */
export const identityCenterConnectionShape = {
  region: identityCenterRegionSchema,
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
}

/** @see https://docs.aws.amazon.com/singlesignon/latest/APIReference/API_ListAccountAssignments.html */
export const identityCenterInstanceArnSchema = z
  .string()
  .min(10, 'Instance ARN is required')
  .max(1224, 'Instance ARN must be at most 1224 characters')
  .regex(
    /^arn:aws(-[a-z]{1,5}){0,3}:sso:::instance\/(sso)?ins-[a-zA-Z0-9-.]{16}$/,
    'Instance ARN must look like arn:aws:sso:::instance/ssoins-0123456789abcdef'
  )

/** @see https://docs.aws.amazon.com/singlesignon/latest/APIReference/API_AccountAssignment.html */
export const identityCenterPermissionSetArnSchema = z
  .string()
  .min(10, 'Permission set ARN is required')
  .max(1224, 'Permission set ARN must be at most 1224 characters')
  .regex(
    /^arn:aws(-[a-z]{1,5}){0,3}:sso:::permissionSet\/(sso)?ins-[a-zA-Z0-9-.]{16}\/ps-[a-zA-Z0-9-./]{16}$/,
    'Permission set ARN must look like arn:aws:sso:::permissionSet/ssoins-0123456789abcdef/ps-0123456789abcdef'
  )

/**
 * Identity Store user or group id, as accepted by SSO Admin `PrincipalId` and
 * by Identity Store `UserId` / `GroupId`.
 *
 * @see https://docs.aws.amazon.com/singlesignon/latest/APIReference/API_AccountAssignment.html
 */
const identityStoreObjectIdPattern =
  /^([0-9a-f]{10}-)?[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/

export const identityCenterPrincipalIdSchema = z
  .string()
  .min(1, 'Principal ID is required')
  .max(47, 'Principal ID must be at most 47 characters')
  .regex(
    identityStoreObjectIdPattern,
    'Principal ID must be an Identity Store user or group ID (e.g., 9067b2d8-8021-70f8-1234-5c6d7e8f9012)'
  )

export const identityCenterUserIdSchema = z
  .string()
  .min(1, 'User ID is required')
  .max(47, 'User ID must be at most 47 characters')
  .regex(identityStoreObjectIdPattern, 'User ID must be an Identity Store user ID')

export const identityCenterGroupIdSchema = z
  .string()
  .min(1, 'Group ID is required')
  .max(47, 'Group ID must be at most 47 characters')
  .regex(identityStoreObjectIdPattern, 'Group ID must be an Identity Store group ID')

/**
 * Identity Store service id. Narrower than the SSO Admin `IdentityStoreId`
 * shape — every tool in this family calls the Identity Store API with it.
 *
 * @see https://docs.aws.amazon.com/singlesignon/latest/IdentityStoreAPIReference/API_DescribeUser.html
 */
export const identityCenterIdentityStoreIdSchema = z
  .string()
  .min(1, 'Identity Store ID is required')
  .max(36, 'Identity Store ID must be at most 36 characters')
  .regex(
    /^(d-[0-9a-f]{10}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
    'Identity Store ID must look like d-1234567890'
  )

/** @see https://docs.aws.amazon.com/singlesignon/latest/APIReference/API_DescribeAccountAssignmentCreationStatus.html */
export const identityCenterRequestIdSchema = z
  .string()
  .length(36, 'Request ID must be a 36-character UUID')
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'Request ID must be a UUID returned by a create or delete assignment call'
  )

/** @see https://docs.aws.amazon.com/organizations/latest/APIReference/API_Account.html */
export const identityCenterAccountIdSchema = z
  .string()
  .regex(/^\d{12}$/, 'AWS account ID must be exactly 12 digits')

export const identityCenterPrincipalTypeSchema = z.enum(['USER', 'GROUP'])

export const identityCenterNextTokenSchema = z
  .string()
  .min(1, 'Pagination token cannot be empty')
  .max(65535, 'Pagination token is too long')

/**
 * Organizations pagination tokens are documented far longer than the Identity
 * Store bound above, so `ListAccounts` gets its own ceiling rather than sharing
 * one that would reject a valid continuation token before AWS sees it.
 *
 * @see https://docs.aws.amazon.com/organizations/latest/APIReference/API_ListAccounts.html
 */
export const identityCenterOrganizationsNextTokenSchema = z
  .string()
  .min(1, 'Pagination token cannot be empty')
  .max(100000, 'Pagination token is too long')

/** Every list operation in the family except Organizations `ListAccounts`. */
export const identityCenterMaxResultsSchema = z
  .number()
  .int('Max results must be a whole number')
  .min(1, 'Max results must be at least 1')
  .max(100, 'Max results must be at most 100')

/** @see https://docs.aws.amazon.com/organizations/latest/APIReference/API_ListAccounts.html */
export const identityCenterAccountsMaxResultsSchema = z
  .number()
  .int('Max results must be a whole number')
  .min(1, 'Max results must be at least 1')
  .max(20, 'AWS Organizations ListAccounts allows at most 20 results per page')

export const identityCenterAssignmentStatusResponseSchema = z.object({
  message: z.string(),
  status: z.string(),
  requestId: z.string(),
  accountId: z.string().nullable(),
  permissionSetArn: z.string().nullable(),
  principalType: z.string().nullable(),
  principalId: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdDate: z.string().nullable(),
})
