import type { ToolConfig } from '@/tools/types'

export const ociSecretsAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Stored OCI API signing-key service account.',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'System-resolved opaque OCI credential reference; never signing material.',
  },
  region: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Optional OCI region override in the credential realm, such as us-ashburn-1. Defaults to the credential region.',
  },
} as const satisfies ToolConfig['params']
export const ociSecretsParams = {
  compartmentId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Compartment OCID. For Move Secret, this is the destination compartment.',
  },
  secretId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Secret OCID.',
  },
  secretName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Secret name, unique within its vault; up to 255 characters.',
  },
  vaultId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Vault OCID. Key discovery additionally requires read access to this vault.',
  },
  keyId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Encryption key OCID. Creating a secret requires a compatible enabled AES key.',
  },
  name: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Exact secret name filter.',
  },
  lifecycleState: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Secret lifecycle state: CREATING, ACTIVE, UPDATING, DELETING, DELETED, SCHEDULING_DELETION, PENDING_DELETION, CANCELLING_DELETION or FAILED.',
  },
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Maximum items in one page, from 1 to 1000. Returns a nextPage token when more results remain.',
  },
  page: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Opaque nextPage token from the previous response.',
  },
  secretSortBy: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Sort secrets by NAME or TIMECREATED.',
  },
  discoverySortBy: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Sort vaults or keys by DISPLAYNAME or TIMECREATED.',
  },
  sortOrder: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Sort direction: ASC or DESC.',
  },
  secretVersionNumber: {
    type: 'number',
    required: true,
    visibility: 'user-or-llm',
    description: 'Positive secret version number.',
  },
  ifMatch: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'ETag from a previous response for optimistic concurrency control.',
  },
  timeOfDeletion: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'RFC 3339 deletion time, 1 to 30 days in the future. Omit for the Oracle default of 30 days.',
  },
  retryToken: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Optional idempotency token, 1 to 64 characters. Oracle tokens expire after 24 hours and can be invalidated by conflicting operations.',
  },
  currentVersionNumber: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Promote this version to CURRENT. Do not combine with secretContent or secretRules.',
  },
  workRequestId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Work request OCID returned by an asynchronous secret operation.',
  },
  protectionMode: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Key protection mode: HSM, SOFTWARE or EXTERNAL. Oracle defaults to HSM; omission does not list every mode.',
  },
  algorithm: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Key algorithm filter: AES, RSA or ECDSA.',
  },
  length: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Key length filter in bytes, as supported by the selected algorithm.',
  },
  curveId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Elliptic curve filter: NIST_P256, NIST_P384 or NIST_P521.',
  },
} as const satisfies ToolConfig['params']

export const ociSecretsConfigurationParams = {
  description: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Secret description. Avoid confidential information in metadata fields.',
  },
  secretContent: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Content object with contentType:"BASE64", optional base64 content, name and stage (CURRENT or PENDING). Maximum 25600 base64 characters. Creation requires content or automatic generation and allows only CURRENT. An update may omit content to generate a version using the stored generation configuration.',
  },
  secretRules: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'At most one SECRET_EXPIRY_RULE and one SECRET_REUSE_RULE. Expiry fields: secretVersionExpiryInterval (P1D to P90D), timeOfAbsoluteExpiry (RFC 3339, 1 to 365 days), isSecretContentRetrievalBlockedOnExpiry. Reuse field: isEnforcedOnDeletedSecretVersions.',
  },
  freeformTags: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Free-form string key/value tags. Send {} to clear them.',
  },
  definedTags: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Defined tags by namespace, for example {"Operations":{"CostCenter":"42"}}. Send {} to clear them.',
  },
  metadata: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Additional metadata as JSON key/value pairs.',
  },
  enableAutoGeneration: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Generate new content with secretGenerationContext instead of supplying secretContent.',
  },
  secretGenerationContext: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Generation object with generationType, generationTemplate and optional secretTemplate. PASSPHRASE templates: SECRETS_DEFAULT_PASSWORD or DBAAS_DEFAULT_PASSWORD, optional passphraseLength. SSH_KEY: RSA_2048, RSA_3072 or RSA_4096. BYTES: BYTES_512 or BYTES_1024.',
  },
  rotationConfig: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Rotation configuration: {targetSystemDetails:{targetSystemType:"ADB",adbId:"<ocid>"} or {targetSystemType:"FUNCTION",functionId:"<ocid>"},isScheduledRotationEnabled?,rotationInterval?:"P30D"}. Scheduled intervals: P1D to P360D. The target and its IAM permissions must already exist.',
  },
  replicationConfig: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Cross-region replication: {replicationTargets:[{targetKeyId,targetRegion,targetVaultId}],isWriteForwardEnabled?}. Configure the source secret; Oracle enforces target limits and replica write restrictions.',
  },
} as const satisfies ToolConfig['params']

export const ociSecretsBundleSelectionParams = {
  versionNumber: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Retrieve this positive version number. Set at most one of versionNumber, secretVersionName and stage. Omit all three for CURRENT.',
  },
  secretVersionName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Retrieve the uniquely named version. Mutually exclusive with versionNumber and stage.',
  },
  stage: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Version stage: CURRENT, PENDING, LATEST, PREVIOUS or DEPRECATED. Mutually exclusive with versionNumber and secretVersionName.',
  },
  decodeContent: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Also return secretValue as UTF-8 text. Defaults to false; invalid UTF-8 is rejected. The original base64 content is preserved.',
  },
} as const satisfies ToolConfig['params']
