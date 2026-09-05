import { z } from 'zod'

const id = z.string().trim().min(1).max(255)
const versionNumber = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const sortOrder = z.enum(['ASC', 'DESC']).optional()
const ifMatch = z.string().min(1).max(1024).optional()
const retryToken = z.string().min(1).max(64).optional()
const timeOfDeletion = z.iso.datetime({ offset: true }).optional()
const pagination = { limit: z.number().int().min(1).max(1000).optional() }
const managementPage = { ...pagination, page: z.string().max(1024).optional() }
const discoveryPage = { ...pagination, page: z.string().max(512).optional() }
const workPage = { ...pagination, page: z.string().max(2000).optional() }
const base = {
  oauthCredential: z.string().trim().min(1),
  accessToken: z.string().trim().min(1).optional(),
  region: z.string().trim().min(1).max(255).optional(),
}
const secret = { ...base, secretId: id }
const version = { ...secret, secretVersionNumber: versionNumber }
const vault = { ...base, vaultId: id }
const workRequest = { ...base, workRequestId: id }
const discoverySort = {
  sortBy: z.enum(['DISPLAYNAME', 'TIMECREATED']).optional(),
  sortOrder,
}

const secretContent = z.object({
  contentType: z.literal('BASE64'),
  content: z
    .string()
    .max(25600)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .optional(),
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9_.-]+$/)
    .optional(),
  stage: z.enum(['CURRENT', 'PENDING']).optional(),
})

const secretRule = z.discriminatedUnion('ruleType', [
  z.object({
    ruleType: z.literal('SECRET_EXPIRY_RULE'),
    isSecretContentRetrievalBlockedOnExpiry: z.boolean().optional(),
    secretVersionExpiryInterval: z.string().trim().min(1).max(128).optional(),
    timeOfAbsoluteExpiry: z.iso.datetime({ offset: true }).optional(),
  }),
  z.object({
    ruleType: z.literal('SECRET_REUSE_RULE'),
    isEnforcedOnDeletedSecretVersions: z.boolean().optional(),
  }),
])

const generationContext = z.discriminatedUnion('generationType', [
  z.object({
    generationType: z.literal('PASSPHRASE'),
    generationTemplate: z.enum(['SECRETS_DEFAULT_PASSWORD', 'DBAAS_DEFAULT_PASSWORD']),
    passphraseLength: z.number().int().positive().optional(),
    secretTemplate: z.string().optional(),
  }),
  z.object({
    generationType: z.literal('SSH_KEY'),
    generationTemplate: z.enum(['RSA_2048', 'RSA_3072', 'RSA_4096']),
    secretTemplate: z.string().optional(),
  }),
  z.object({
    generationType: z.literal('BYTES'),
    generationTemplate: z.enum(['BYTES_512', 'BYTES_1024']),
    secretTemplate: z.string().optional(),
  }),
])

const configuration = {
  description: z.string().max(4000).optional(),
  freeformTags: z.record(z.string(), z.string()).optional(),
  definedTags: z
    .record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  secretContent: secretContent.optional(),
  secretRules: z
    .array(secretRule)
    .max(2)
    .refine(
      (rules) => new Set(rules.map((rule) => rule.ruleType)).size === rules.length,
      'Only one rule of each type is allowed'
    )
    .optional(),
  enableAutoGeneration: z.boolean().optional(),
  secretGenerationContext: generationContext.optional(),
  rotationConfig: z
    .object({
      targetSystemDetails: z.discriminatedUnion('targetSystemType', [
        z.object({ targetSystemType: z.literal('ADB'), adbId: id }),
        z.object({ targetSystemType: z.literal('FUNCTION'), functionId: id }),
      ]),
      isScheduledRotationEnabled: z.boolean().optional(),
      rotationInterval: z.string().trim().min(1).max(128).optional(),
    })
    .optional(),
  replicationConfig: z
    .object({
      replicationTargets: z.array(
        z.object({
          targetKeyId: id,
          targetRegion: z.string().trim().min(1).max(255),
          targetVaultId: id,
        })
      ),
      isWriteForwardEnabled: z.boolean().optional(),
    })
    .optional(),
}

const bundleSelection = {
  versionNumber: versionNumber.optional(),
  secretVersionName: z.string().min(1).max(50).optional(),
  stage: z.enum(['CURRENT', 'PENDING', 'LATEST', 'PREVIOUS', 'DEPRECATED']).optional(),
  decodeContent: z.boolean().optional(),
}

/** The discriminator is derived from the registered tool ID, never from caller input. */
export const ociSecretsInputSchema = z
  .discriminatedUnion('operation', [
    z.object({
      ...base,
      operation: z.literal('list_secrets'),
      compartmentId: id,
      name: z.string().max(255).optional(),
      vaultId: id.optional(),
      lifecycleState: z
        .enum([
          'CREATING',
          'ACTIVE',
          'UPDATING',
          'DELETING',
          'DELETED',
          'SCHEDULING_DELETION',
          'PENDING_DELETION',
          'CANCELLING_DELETION',
          'FAILED',
        ])
        .optional(),
      ...managementPage,
      sortBy: z.enum(['NAME', 'TIMECREATED']).optional(),
      sortOrder,
    }),
    z.object({ ...secret, operation: z.literal('get_secret') }),
    z.object({
      ...base,
      ...configuration,
      operation: z.literal('create_secret'),
      compartmentId: id,
      vaultId: id,
      keyId: id,
      secretName: id,
      retryToken,
    }),
    z.object({
      ...secret,
      ...configuration,
      operation: z.literal('update_secret'),
      currentVersionNumber: versionNumber.optional(),
      ifMatch,
    }),
    z.object({
      ...secret,
      ...managementPage,
      operation: z.literal('list_secret_versions'),
      sortOrder,
    }),
    z.object({ ...version, operation: z.literal('get_secret_version') }),
    z.object({
      ...secret,
      operation: z.literal('schedule_secret_deletion'),
      ifMatch,
      timeOfDeletion,
    }),
    z.object({ ...secret, operation: z.literal('cancel_secret_deletion'), ifMatch }),
    z.object({
      ...version,
      operation: z.literal('schedule_secret_version_deletion'),
      ifMatch,
      timeOfDeletion,
    }),
    z.object({ ...version, operation: z.literal('cancel_secret_version_deletion'), ifMatch }),
    z.object({ ...secret, operation: z.literal('rotate_secret'), ifMatch, retryToken }),
    z.object({ ...secret, operation: z.literal('cancel_secret_rotation'), ifMatch }),
    z.object({
      ...secret,
      operation: z.literal('change_secret_compartment'),
      compartmentId: id,
      ifMatch,
      retryToken,
    }),
    z.object({ ...secret, ...bundleSelection, operation: z.literal('get_secret_bundle') }),
    z.object({
      ...vault,
      ...bundleSelection,
      operation: z.literal('get_secret_bundle_by_name'),
      secretName: id,
    }),
    z.object({
      ...secret,
      ...discoveryPage,
      operation: z.literal('list_secret_bundle_versions'),
      sortOrder,
    }),
    z.object({
      ...base,
      ...discoveryPage,
      ...discoverySort,
      operation: z.literal('list_vaults'),
      compartmentId: id,
    }),
    z.object({ ...vault, operation: z.literal('get_vault') }),
    z.object({
      ...vault,
      ...discoveryPage,
      ...discoverySort,
      operation: z.literal('list_keys'),
      compartmentId: id,
      protectionMode: z.enum(['HSM', 'SOFTWARE', 'EXTERNAL']).optional(),
      algorithm: z.enum(['AES', 'RSA', 'ECDSA']).optional(),
      length: z.number().int().positive().optional(),
      curveId: z.enum(['NIST_P256', 'NIST_P384', 'NIST_P521']).optional(),
    }),
    z.object({ ...vault, operation: z.literal('get_key'), keyId: id }),
    z.object({
      ...secret,
      ...workPage,
      operation: z.literal('list_work_requests'),
      compartmentId: id,
    }),
    z.object({ ...workRequest, operation: z.literal('get_work_request') }),
    z.object({
      ...workRequest,
      ...workPage,
      operation: z.literal('list_work_request_errors'),
      sortOrder,
    }),
    z.object({
      ...workRequest,
      ...workPage,
      operation: z.literal('list_work_request_logs'),
      sortOrder,
    }),
  ])
  .superRefine((input, context) => {
    const issue = (message: string, path: string) =>
      context.addIssue({ code: 'custom', message, path: [path] })

    if (
      input.operation === 'get_secret_bundle' ||
      input.operation === 'get_secret_bundle_by_name'
    ) {
      if (
        [input.versionNumber, input.secretVersionName, input.stage].filter(
          (value) => value !== undefined
        ).length > 1
      ) {
        issue('Choose only one version number, version name or stage', 'stage')
      }
    }
    if (input.operation === 'create_secret' || input.operation === 'update_secret') {
      if (input.secretContent?.content !== undefined && input.enableAutoGeneration) {
        issue('Supply content or enable automatic generation, not both', 'secretContent')
      }
      if (input.operation === 'create_secret') {
        if (input.enableAutoGeneration && !input.secretGenerationContext) {
          issue('Automatic generation requires a generation context', 'secretGenerationContext')
        }
        if (input.secretContent?.content === undefined && !input.enableAutoGeneration) {
          issue('Supply secretContent or enable automatic generation', 'secretContent')
        }
        if (input.secretContent?.stage === 'PENDING') {
          issue('A new secret must start at CURRENT', 'secretContent')
        }
      } else if (
        [input.secretContent, input.currentVersionNumber, input.secretRules].filter(
          (value) => value !== undefined
        ).length > 1
      ) {
        issue(
          'Update content, promote a version and change rules in separate requests',
          'secretContent'
        )
      }
    }
  })

export type OciSecretsInput = z.infer<typeof ociSecretsInputSchema>
