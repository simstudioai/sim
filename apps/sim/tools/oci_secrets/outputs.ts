import type { ToolOutputProperty } from '@/tools/types'

export const secretSummaryProperties = {
  id: {
    type: 'string',
    description: 'Secret OCID',
  },
  compartmentId: {
    type: 'string',
    description: 'Compartment OCID',
  },
  vaultId: {
    type: 'string',
    description: 'Vault OCID',
  },
  secretName: {
    type: 'string',
    description: 'Secret name',
  },
  lifecycleState: {
    type: 'string',
    description: 'Secret lifecycle state',
  },
  timeCreated: {
    type: 'string',
    description: 'Creation time in RFC 3339 format',
  },
  description: {
    type: 'string',
    description: 'Secret description',
    optional: true,
    nullable: true,
  },
  keyId: {
    type: 'string',
    description: 'Encryption key OCID',
    optional: true,
    nullable: true,
  },
  lifecycleDetails: {
    type: 'string',
    description: 'Lifecycle details',
    optional: true,
    nullable: true,
  },
  timeOfCurrentVersionExpiry: {
    type: 'string',
    description: 'Current version expiration time',
    optional: true,
    nullable: true,
  },
  timeOfDeletion: {
    type: 'string',
    description: 'Scheduled deletion time',
    optional: true,
    nullable: true,
  },
  freeformTags: {
    type: 'json',
    description: 'Free-form string key/value tags',
    optional: true,
    nullable: true,
  },
  definedTags: {
    type: 'json',
    description: 'Defined tag values grouped by namespace',
    optional: true,
    nullable: true,
  },
  rotationConfig: {
    type: 'json',
    description: 'Rotation configuration',
    optional: true,
    nullable: true,
    properties: {
      targetSystemDetails: {
        type: 'json',
        description: 'Rotation target system',
        properties: {
          targetSystemType: {
            type: 'string',
            description: 'ADB or FUNCTION',
          },
          adbId: {
            type: 'string',
            description: 'Autonomous Database OCID for an ADB target',
            optional: true,
            nullable: true,
          },
          functionId: {
            type: 'string',
            description: 'Function OCID for a FUNCTION target',
            optional: true,
            nullable: true,
          },
        },
      },
      isScheduledRotationEnabled: {
        type: 'boolean',
        description: 'Whether scheduled rotation is enabled',
        optional: true,
        nullable: true,
      },
      rotationInterval: {
        type: 'string',
        description: 'Scheduled rotation interval in ISO 8601 days',
        optional: true,
        nullable: true,
      },
    },
  },
  rotationStatus: {
    type: 'string',
    description: 'Rotation status',
    optional: true,
    nullable: true,
  },
  lastRotationTime: {
    type: 'string',
    description: 'Last rotation time',
    optional: true,
    nullable: true,
  },
  nextRotationTime: {
    type: 'string',
    description: 'Next scheduled rotation time',
    optional: true,
    nullable: true,
  },
  isAutoGenerationEnabled: {
    type: 'boolean',
    description: 'Whether secret content is generated automatically',
    optional: true,
    nullable: true,
  },
  secretGenerationContext: {
    type: 'json',
    description: 'Automatic generation configuration',
    optional: true,
    nullable: true,
    properties: {
      generationType: {
        type: 'string',
        description: 'PASSPHRASE, SSH_KEY or BYTES',
      },
      generationTemplate: {
        type: 'string',
        description: 'Generation template for this type',
      },
      secretTemplate: {
        type: 'string',
        description: 'Template into which generated content is inserted',
        optional: true,
        nullable: true,
      },
      passphraseLength: {
        type: 'number',
        description: 'Generated passphrase length when applicable',
        optional: true,
        nullable: true,
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const secretProperties = {
  ...secretSummaryProperties,
  currentVersionNumber: {
    type: 'number',
    description: 'Current secret version number',
    optional: true,
    nullable: true,
  },
  metadata: {
    type: 'json',
    description: 'Additional user-defined metadata',
    optional: true,
    nullable: true,
  },
  secretRules: {
    type: 'array',
    description: 'Secret expiry and reuse rules',
    items: {
      type: 'object',
      properties: {
        ruleType: {
          type: 'string',
          description: 'SECRET_EXPIRY_RULE or SECRET_REUSE_RULE',
        },
        secretVersionExpiryInterval: {
          type: 'string',
          description: 'Version validity in ISO 8601 days',
          optional: true,
          nullable: true,
        },
        timeOfAbsoluteExpiry: {
          type: 'string',
          description: 'Absolute secret expiration time',
          optional: true,
          nullable: true,
        },
        isSecretContentRetrievalBlockedOnExpiry: {
          type: 'boolean',
          description: 'Whether expired content retrieval is blocked',
          optional: true,
          nullable: true,
        },
        isEnforcedOnDeletedSecretVersions: {
          type: 'boolean',
          description: 'Whether reuse checks include deleted versions',
          optional: true,
          nullable: true,
        },
      },
    },
  },
  replicationConfig: {
    type: 'json',
    description: 'Cross-region replication configuration',
    optional: true,
    nullable: true,
    properties: {
      replicationTargets: {
        type: 'array',
        description: 'Cross-region replication targets',
        items: {
          type: 'object',
          properties: {
            targetKeyId: {
              type: 'string',
              description: 'Target encryption key OCID',
            },
            targetRegion: {
              type: 'string',
              description: 'Target OCI region',
            },
            targetVaultId: {
              type: 'string',
              description: 'Target vault OCID',
            },
          },
        },
      },
      isWriteForwardEnabled: {
        type: 'boolean',
        description: 'Whether supported replica writes are forwarded to the source',
        optional: true,
        nullable: true,
      },
    },
  },
  isReplica: {
    type: 'boolean',
    description: 'Whether this secret is a replica',
    optional: true,
    nullable: true,
  },
  sourceRegionInformation: {
    type: 'json',
    description: 'Source of a replicated secret',
    optional: true,
    nullable: true,
    properties: {
      sourceKeyId: {
        type: 'string',
        description: 'Source encryption key OCID',
      },
      sourceRegion: {
        type: 'string',
        description: 'Source OCI region',
      },
      sourceVaultId: {
        type: 'string',
        description: 'Source vault OCID',
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const versionProperties = {
  secretId: {
    type: 'string',
    description: 'Secret OCID',
    optional: true,
    nullable: true,
  },
  versionNumber: {
    type: 'number',
    description: 'Version number',
    optional: true,
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'Secret version name',
    optional: true,
    nullable: true,
  },
  contentType: {
    type: 'string',
    description: 'Content encoding, BASE64',
    optional: true,
    nullable: true,
  },
  stages: {
    type: 'array',
    description: 'Rotation stages',
    items: {
      type: 'string',
    },
  },
  timeCreated: {
    type: 'string',
    description: 'Creation time',
    optional: true,
    nullable: true,
  },
  timeOfDeletion: {
    type: 'string',
    description: 'Scheduled deletion time',
    optional: true,
    nullable: true,
  },
  timeOfCurrentVersionExpiry: {
    type: 'string',
    description: 'Current version expiration time',
    optional: true,
    nullable: true,
  },
  isContentAutoGenerated: {
    type: 'boolean',
    description: 'Whether the content was generated automatically',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const versionSummaryProperties = {
  secretId: {
    type: 'string',
    description: 'Secret OCID',
  },
  versionNumber: {
    type: 'number',
    description: 'Version number',
  },
  name: {
    type: 'string',
    description: 'Secret version name',
    optional: true,
    nullable: true,
  },
  contentType: {
    type: 'string',
    description: 'Content encoding, BASE64',
    optional: true,
    nullable: true,
  },
  stages: {
    type: 'array',
    description: 'Rotation stages',
    items: {
      type: 'string',
    },
  },
  timeCreated: {
    type: 'string',
    description: 'Creation time',
  },
  timeOfDeletion: {
    type: 'string',
    description: 'Scheduled deletion time',
    optional: true,
    nullable: true,
  },
  isContentAutoGenerated: {
    type: 'boolean',
    description: 'Whether the content was generated automatically',
    optional: true,
    nullable: true,
  },
  timeOfExpiry: {
    type: 'string',
    description: 'Version expiration time',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const bundleVersionProperties = {
  secretId: {
    type: 'string',
    description: 'Secret OCID',
  },
  versionNumber: {
    type: 'number',
    description: 'Version number',
  },
  versionName: {
    type: 'string',
    description: 'Secret version name',
    optional: true,
    nullable: true,
  },
  stages: {
    type: 'array',
    description: 'Rotation stages',
    items: {
      type: 'string',
    },
  },
  timeCreated: {
    type: 'string',
    description: 'Creation time',
    optional: true,
    nullable: true,
  },
  timeOfDeletion: {
    type: 'string',
    description: 'Scheduled deletion time',
    optional: true,
    nullable: true,
  },
  timeOfExpiry: {
    type: 'string',
    description: 'Version expiration time',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const bundleProperties = {
  ...bundleVersionProperties,
  metadata: {
    type: 'json',
    description: 'Additional user-defined version metadata',
    optional: true,
    nullable: true,
  },
  secretBundleContent: {
    type: 'json',
    description: 'Intentionally retrieved secret content; preserve its base64 encoding',
    optional: true,
    nullable: true,
    properties: {
      contentType: {
        type: 'string',
        description: 'Content encoding, BASE64',
      },
      content: {
        type: 'string',
        description: 'Base64-encoded secret content',
        optional: true,
        nullable: true,
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const vaultSummaryProperties = {
  id: {
    type: 'string',
    description: 'Vault OCID',
  },
  compartmentId: {
    type: 'string',
    description: 'Compartment OCID',
  },
  displayName: {
    type: 'string',
    description: 'Vault display name',
  },
  lifecycleState: {
    type: 'string',
    description: 'Vault lifecycle state',
  },
  vaultType: {
    type: 'string',
    description: 'DEFAULT, VIRTUAL_PRIVATE or EXTERNAL',
  },
  timeCreated: {
    type: 'string',
    description: 'Creation time',
  },
  managementEndpoint: {
    type: 'string',
    description: 'Vault management endpoint',
  },
  cryptoEndpoint: {
    type: 'string',
    description: 'Vault cryptographic endpoint',
  },
  freeformTags: {
    type: 'json',
    description: 'Free-form string key/value tags',
    optional: true,
    nullable: true,
  },
  definedTags: {
    type: 'json',
    description: 'Defined tag values grouped by namespace',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const vaultProperties = {
  ...vaultSummaryProperties,
  timeOfDeletion: {
    type: 'string',
    description: 'Scheduled deletion time',
    optional: true,
    nullable: true,
  },
  isPrimary: {
    type: 'boolean',
    description: 'Whether this is the primary vault',
    optional: true,
    nullable: true,
  },
  restoredFromVaultId: {
    type: 'string',
    description: 'Original vault OCID when restored',
    optional: true,
    nullable: true,
  },
  wrappingkeyId: {
    type: 'string',
    description: 'Wrapping key OCID',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const keyBaseProperties = {
  id: {
    type: 'string',
    description: 'Key OCID',
  },
  compartmentId: {
    type: 'string',
    description: 'Compartment OCID',
  },
  vaultId: {
    type: 'string',
    description: 'Vault OCID',
  },
  displayName: {
    type: 'string',
    description: 'Key display name',
  },
  lifecycleState: {
    type: 'string',
    description: 'Key lifecycle state',
  },
  timeCreated: {
    type: 'string',
    description: 'Creation time',
  },
  protectionMode: {
    type: 'string',
    description: 'HSM, SOFTWARE or EXTERNAL',
    optional: true,
    nullable: true,
  },
  isAutoRotationEnabled: {
    type: 'boolean',
    description: 'Whether key rotation is enabled',
    optional: true,
    nullable: true,
  },
  freeformTags: {
    type: 'json',
    description: 'Free-form string key/value tags',
    optional: true,
    nullable: true,
  },
  definedTags: {
    type: 'json',
    description: 'Defined tag values grouped by namespace',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const keySummaryProperties = {
  ...keyBaseProperties,
  algorithm: {
    type: 'string',
    description: 'AES, RSA or ECDSA',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const keyProperties = {
  ...keyBaseProperties,
  currentKeyVersion: {
    type: 'string',
    description: 'Current key version OCID',
  },
  keyShape: {
    type: 'json',
    description: 'Key algorithm, byte length and optional elliptic curve',
    properties: {
      algorithm: {
        type: 'string',
        description: 'Key algorithm',
      },
      length: {
        type: 'number',
        description: 'Key length in bytes',
      },
      curveId: {
        type: 'string',
        description: 'Elliptic curve identifier',
        optional: true,
        nullable: true,
      },
    },
  },
  timeOfDeletion: {
    type: 'string',
    description: 'Scheduled deletion time',
    optional: true,
    nullable: true,
  },
  isPrimary: {
    type: 'boolean',
    description: 'Whether this is the primary key',
    optional: true,
    nullable: true,
  },
  restoredFromKeyId: {
    type: 'string',
    description: 'Original key OCID when restored',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const workSummaryProperties = {
  id: {
    type: 'string',
    description: 'Work request OCID',
  },
  compartmentId: {
    type: 'string',
    description: 'Compartment OCID',
  },
  operationType: {
    type: 'string',
    description: 'Operation type',
  },
  status: {
    type: 'string',
    description: 'ACCEPTED, IN_PROGRESS, FAILED, SUCCEEDED, CANCELING or CANCELED',
  },
  percentComplete: {
    type: 'number',
    description: 'Completion percentage',
  },
  timeAccepted: {
    type: 'string',
    description: 'Acceptance time',
  },
  timeStarted: {
    type: 'string',
    description: 'Start time',
    optional: true,
    nullable: true,
  },
  timeFinished: {
    type: 'string',
    description: 'Finish time',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const workProperties = {
  ...workSummaryProperties,
  resources: {
    type: 'array',
    description: 'Resources associated with the work request',
    items: {
      type: 'object',
      properties: {
        actionType: {
          type: 'string',
          description: 'Resource action type',
        },
        entityType: {
          type: 'string',
          description: 'Resource entity type',
        },
        identifier: {
          type: 'string',
          description: 'Resource identifier',
        },
        entityUri: {
          type: 'string',
          description: 'Resource URI; informational only',
          optional: true,
          nullable: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const logProperties = {
  message: {
    type: 'string',
    description: 'Activity log message',
  },
  timestamp: {
    type: 'string',
    description: 'Log entry time',
  },
} as const satisfies Record<string, ToolOutputProperty>

export const errProperties = {
  code: {
    type: 'string',
    description: 'Oracle error code',
  },
  message: {
    type: 'string',
    description: 'Work request diagnostic message',
  },
  timestamp: {
    type: 'string',
    description: 'Error time',
  },
} as const satisfies Record<string, ToolOutputProperty>
