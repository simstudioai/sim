import { z } from 'zod'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

/**
 * Boundary primitives for the AWS IAM tool contracts.
 *
 * Every bound and pattern here is transcribed from the IAM API Reference. AWS documents
 * different bounds for the same-named parameter across actions — `UserName` is 1-64 on
 * CreateUser/AttachUserPolicy/ListAttachedUserPolicies but 1-128 on GetUser, DeleteUser,
 * and the access-key and group-membership actions — so each contract picks the builder
 * that matches its own action rather than sharing one bound.
 */

/** IAM friendly-name character class, shared by user, role, and group names. */
const IAM_NAME_PATTERN = /^[\w+=,.@-]+$/

/** `PathPrefix` on the entity list actions: ListUsers, ListRoles, ListGroups. */
const ENTITY_LIST_PATH_PREFIX_PATTERN = /^\u002F[\u0021-\u007F]*$/

/** `Path` on the create actions: CreateUser, CreateRole. Requires a trailing slash. */
const CREATE_PATH_PATTERN = /^(?:\u002F|\u002F[\u0021-\u007E]+\u002F)$/

/** `PathPrefix` on the policy family: ListPolicies and the ListAttached*Policies actions. */
const POLICY_PATH_PREFIX_PATTERN = /^(?:\u002F[A-Za-z0-9.,+@=_-]+)*\u002F$/

const MARKER_PATTERN = /^[\u0020-\u00FF]+$/

const ACCESS_KEY_ID_PATTERN = /^[\w]+$/

const POLICY_DOCUMENT_PATTERN = /^[\u0009\u000A\u000D\u0020-\u00FF]+$/

const ROLE_DESCRIPTION_PATTERN = /^[\u0009\u000A\u000D\u0020-\u007E\u00A1-\u00FF]*$/

export const iamRegionSchema = z
  .string()
  .min(1, 'AWS region is required')
  .refine((v) => validateAwsRegion(v).isValid, {
    message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
  })

export const iamAccessKeyIdSchema = z.string().min(1, 'AWS access key ID is required')

export const iamSecretAccessKeySchema = z.string().min(1, 'AWS secret access key is required')

/** The credential slice every IAM tool contract carries. */
export const iamConnectionShape = {
  region: iamRegionSchema,
  accessKeyId: iamAccessKeyIdSchema,
  secretAccessKey: iamSecretAccessKeySchema,
}

/** `UserName` where AWS documents 1-64: CreateUser, AttachUserPolicy, DetachUserPolicy, ListAttachedUserPolicies. */
export const iamUserName64Schema = z
  .string()
  .min(1, 'User name cannot be empty')
  .max(64, 'User name cannot exceed 64 characters')
  .regex(IAM_NAME_PATTERN, 'User name may contain only letters, digits, and _+=,.@-')

/** `UserName` where AWS documents 1-128: GetUser, DeleteUser, the access-key actions, group membership. */
export const iamUserName128Schema = z
  .string()
  .min(1, 'User name cannot be empty')
  .max(128, 'User name cannot exceed 128 characters')
  .regex(IAM_NAME_PATTERN, 'User name may contain only letters, digits, and _+=,.@-')

/** `RoleName` is 1-64 on every IAM action that accepts it. */
export const iamRoleNameSchema = z
  .string()
  .min(1, 'Role name cannot be empty')
  .max(64, 'Role name cannot exceed 64 characters')
  .regex(IAM_NAME_PATTERN, 'Role name may contain only letters, digits, and _+=,.@-')

/** `GroupName` is 1-128 on AddUserToGroup and RemoveUserFromGroup. */
export const iamGroupNameSchema = z
  .string()
  .min(1, 'Group name cannot be empty')
  .max(128, 'Group name cannot exceed 128 characters')
  .regex(IAM_NAME_PATTERN, 'Group name may contain only letters, digits, and _+=,.@-')

/** `PolicyArn` on the attach/detach and GetPolicy actions: 20-2048, no documented pattern. */
export const iamPolicyArnSchema = z
  .string()
  .min(20, 'Policy ARN must be at least 20 characters')
  .max(2048, 'Policy ARN cannot exceed 2048 characters')

/** `PolicySourceArn` on SimulatePrincipalPolicy: 20-2048, no documented pattern. */
export const iamPolicySourceArnSchema = z
  .string()
  .min(20, 'Principal ARN must be at least 20 characters')
  .max(2048, 'Principal ARN cannot exceed 2048 characters')

export const iamAssumeRolePolicyDocumentSchema = z
  .string()
  .min(1, 'Trust policy document cannot be empty')
  .max(131072, 'Trust policy document cannot exceed 131072 characters')
  .regex(POLICY_DOCUMENT_PATTERN, 'Trust policy document contains unsupported characters')

/** CreateRole `Description` has no documented minimum and a max of 1000. */
export const iamRoleDescriptionSchema = z
  .string()
  .max(1000, 'Role description cannot exceed 1000 characters')
  .regex(ROLE_DESCRIPTION_PATTERN, 'Role description contains unsupported characters')

/** `Path` on CreateUser and CreateRole: 1-512, must begin and end with a slash. */
export const iamCreatePathSchema = z
  .string()
  .min(1, 'Path cannot be empty')
  .max(512, 'Path cannot exceed 512 characters')
  .regex(CREATE_PATH_PATTERN, 'Path must be "/" or begin and end with "/" (e.g., "/division_abc/")')

/** `PathPrefix` on ListUsers, ListRoles, and ListGroups: 1-512, must begin with a slash. */
export const iamEntityListPathPrefixSchema = z
  .string()
  .min(1, 'Path prefix cannot be empty')
  .max(512, 'Path prefix cannot exceed 512 characters')
  .regex(ENTITY_LIST_PATH_PREFIX_PATTERN, 'Path prefix must begin with "/"')

/** `PathPrefix` on the policy family, whose documented regex is narrower than the entity list one. */
export const iamPolicyPathPrefixSchema = z
  .string()
  .min(1, 'Path prefix cannot be empty')
  .max(512, 'Path prefix cannot exceed 512 characters')
  .regex(
    POLICY_PATH_PREFIX_PATTERN,
    'Path prefix must end with "/" and may contain only letters, digits, and .,+@=_-'
  )

/** `AccessKeyId` on DeleteAccessKey and UpdateAccessKey: 16-128 word characters. */
export const iamAccessKeyIdentifierSchema = z
  .string()
  .min(16, 'Access key ID must be at least 16 characters')
  .max(128, 'Access key ID cannot exceed 128 characters')
  .regex(ACCESS_KEY_ID_PATTERN, 'Access key ID may contain only letters, digits, and underscores')

/** `MaxItems` is documented as 1-1000 on every paginated IAM action. */
export const iamMaxItemsSchema = z
  .number()
  .int('Max items must be a whole number')
  .min(1, 'Max items must be at least 1')
  .max(1000, 'Max items cannot exceed 1000')

/** `Marker` has a documented minimum of 1 and no documented maximum. */
export const iamMarkerSchema = z
  .string()
  .min(1, 'Pagination marker cannot be empty')
  .regex(MARKER_PATTERN, 'Pagination marker contains unsupported characters')

export const iamPolicyScopeSchema = z.enum(['All', 'AWS', 'Local'], {
  message: 'Policy scope must be one of: All, AWS, Local',
})

/** UpdateAccessKey accepts `Expired` on the wire, but only Active/Inactive are settable. */
export const iamAccessKeyStatusSchema = z.enum(['Active', 'Inactive'], {
  message: 'Access key status must be either Active or Inactive',
})

export const iamContextKeyTypeSchema = z.enum(
  [
    'binary',
    'binaryList',
    'boolean',
    'booleanList',
    'date',
    'dateList',
    'ip',
    'ipList',
    'numeric',
    'numericList',
    'string',
    'stringList',
  ],
  { message: 'Context key type must be a documented IAM context key type (e.g., string, ip, date)' }
)

/**
 * Payload guards, not AWS constraints. `SimulatePrincipalPolicy` documents per-member
 * bounds but no array count limit, so these are set far above any realistic simulate
 * call: they bound request memory without narrowing what previously validated.
 */
const MAX_SIMULATED_ACTIONS = 1000
const MAX_SIMULATED_RESOURCES = 1000

/**
 * `ActionNames` reaches the tool as one comma-separated field. AWS documents each member
 * as 3-128 characters, so validate the members rather than the joined string.
 */
export const iamActionNamesSchema = z
  .string()
  .min(1, 'At least one action name is required')
  .superRefine((value, ctx) => {
    const actions = value
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
    if (actions.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'At least one action name is required' })
      return
    }
    if (actions.length > MAX_SIMULATED_ACTIONS) {
      ctx.addIssue({
        code: 'custom',
        message: `Cannot simulate more than ${MAX_SIMULATED_ACTIONS} actions in one request`,
      })
    }
    for (const action of actions) {
      if (action.length < 3 || action.length > 128) {
        ctx.addIssue({
          code: 'custom',
          message: `Action name "${action}" must be between 3 and 128 characters (e.g., s3:GetObject)`,
        })
      }
    }
  })

/** `ResourceArns` members are documented as 1-2048 characters each. */
export const iamResourceArnsSchema = z
  .string()
  .min(1, 'Resource ARNs cannot be empty')
  .superRefine((value, ctx) => {
    const arns = value
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
    if (arns.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Resource ARNs must contain at least one ARN, or be omitted to simulate against *',
      })
      return
    }
    if (arns.length > MAX_SIMULATED_RESOURCES) {
      ctx.addIssue({
        code: 'custom',
        message: `Cannot simulate more than ${MAX_SIMULATED_RESOURCES} resource ARNs in one request`,
      })
    }
    for (const arn of arns) {
      if (arn.length > 2048) {
        ctx.addIssue({
          code: 'custom',
          message: `Resource ARN "${arn.slice(0, 40)}..." cannot exceed 2048 characters`,
        })
      }
    }
  })

export const iamContextEntrySchema = z.object({
  contextKeyName: z
    .string()
    .min(5, 'Context key name must be at least 5 characters (e.g., aws:SourceIp)')
    .max(256, 'Context key name cannot exceed 256 characters'),
  contextKeyValues: z
    .array(z.string().min(1, 'Context key values cannot contain empty strings'))
    .min(1, 'Provide at least one value for each context key')
    .max(64, 'A context key cannot carry more than 64 values'),
  contextKeyType: iamContextKeyTypeSchema,
})

export const iamContextEntriesSchema = z
  .array(iamContextEntrySchema)
  .max(64, 'Cannot supply more than 64 context entries in one simulation')

/** The response slice every paginated IAM contract returns. */
export const iamPaginationResponseShape = {
  isTruncated: z.boolean(),
  marker: z.string().nullable(),
  count: z.number(),
}
