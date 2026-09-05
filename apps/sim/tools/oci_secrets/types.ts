import type { ToolResponse } from '@/tools/types'

export type OciSecretStage = 'CURRENT' | 'PENDING' | 'LATEST' | 'PREVIOUS' | 'DEPRECATED'
export type OciProtectionMode = 'HSM' | 'SOFTWARE' | 'EXTERNAL'
export type OciSortOrder = 'ASC' | 'DESC'

export interface OciSecretsAuthParams {
  oauthCredential: string
  accessToken?: string
  region?: string
}

export interface OciSecretsPaginationParams {
  limit?: number
  page?: string
}

export interface OciSecretContent {
  contentType: 'BASE64'
  content?: string
  name?: string
  stage?: 'CURRENT' | 'PENDING'
}

export type OciSecretRule =
  | {
      ruleType: 'SECRET_EXPIRY_RULE'
      isSecretContentRetrievalBlockedOnExpiry?: boolean
      secretVersionExpiryInterval?: string
      timeOfAbsoluteExpiry?: string
    }
  | { ruleType: 'SECRET_REUSE_RULE'; isEnforcedOnDeletedSecretVersions?: boolean }

export interface OciRotationConfig {
  targetSystemDetails:
    | { targetSystemType: 'ADB'; adbId: string }
    | { targetSystemType: 'FUNCTION'; functionId: string }
  isScheduledRotationEnabled?: boolean
  rotationInterval?: string
}

export type OciSecretGenerationContext = {
  secretTemplate?: string
} & (
  | {
      generationType: 'PASSPHRASE'
      generationTemplate: 'SECRETS_DEFAULT_PASSWORD' | 'DBAAS_DEFAULT_PASSWORD'
      passphraseLength?: number
    }
  | { generationType: 'SSH_KEY'; generationTemplate: 'RSA_2048' | 'RSA_3072' | 'RSA_4096' }
  | { generationType: 'BYTES'; generationTemplate: 'BYTES_512' | 'BYTES_1024' }
)

export interface OciReplicationConfig {
  replicationTargets: { targetKeyId: string; targetRegion: string; targetVaultId: string }[]
  isWriteForwardEnabled?: boolean
}

export interface OciSecretConfiguration {
  description?: string
  freeformTags?: Record<string, string>
  definedTags?: Record<string, Record<string, string | number | boolean>>
  metadata?: Record<string, unknown>
  secretContent?: OciSecretContent
  secretRules?: OciSecretRule[]
  enableAutoGeneration?: boolean
  secretGenerationContext?: OciSecretGenerationContext
  rotationConfig?: OciRotationConfig
  replicationConfig?: OciReplicationConfig
}

export interface OciSecretsListSecretsParams
  extends OciSecretsAuthParams,
    OciSecretsPaginationParams {
  compartmentId: string
  name?: string
  vaultId?: string
  lifecycleState?: string
  sortBy?: 'NAME' | 'TIMECREATED'
  sortOrder?: OciSortOrder
}

export interface OciSecretsGetSecretParams extends OciSecretsAuthParams {
  secretId: string
}

export interface OciSecretsCreateSecretParams extends OciSecretsAuthParams, OciSecretConfiguration {
  compartmentId: string
  secretName: string
  vaultId: string
  keyId: string
  retryToken?: string
}

export interface OciSecretsUpdateSecretParams
  extends OciSecretsGetSecretParams,
    OciSecretConfiguration {
  currentVersionNumber?: number
  ifMatch?: string
}

export interface OciSecretsListSecretVersionsParams
  extends OciSecretsGetSecretParams,
    OciSecretsPaginationParams {
  sortOrder?: OciSortOrder
}

export interface OciSecretsGetSecretVersionParams extends OciSecretsGetSecretParams {
  secretVersionNumber: number
}

export interface OciSecretsCancelSecretDeletionParams extends OciSecretsGetSecretParams {
  ifMatch?: string
}

export interface OciSecretsScheduleSecretDeletionParams
  extends OciSecretsCancelSecretDeletionParams {
  timeOfDeletion?: string
}

export interface OciSecretsCancelSecretVersionDeletionParams
  extends OciSecretsGetSecretVersionParams {
  ifMatch?: string
}

export interface OciSecretsScheduleSecretVersionDeletionParams
  extends OciSecretsCancelSecretVersionDeletionParams {
  timeOfDeletion?: string
}

export interface OciSecretsRotateSecretParams extends OciSecretsCancelSecretDeletionParams {
  retryToken?: string
}

export type OciSecretsCancelSecretRotationParams = OciSecretsCancelSecretDeletionParams

export interface OciSecretsChangeSecretCompartmentParams extends OciSecretsRotateSecretParams {
  compartmentId: string
}

export interface OciSecretBundleSelection {
  versionNumber?: number
  secretVersionName?: string
  stage?: OciSecretStage
  decodeContent?: boolean
}

export type OciSecretsGetSecretBundleParams = OciSecretsGetSecretParams & OciSecretBundleSelection

export interface OciSecretsGetSecretBundleByNameParams
  extends OciSecretsAuthParams,
    OciSecretBundleSelection {
  secretName: string
  vaultId: string
}

export type OciSecretsListSecretBundleVersionsParams = OciSecretsListSecretVersionsParams

export interface OciSecretsListVaultsParams
  extends OciSecretsAuthParams,
    OciSecretsPaginationParams {
  compartmentId: string
  sortBy?: 'DISPLAYNAME' | 'TIMECREATED'
  sortOrder?: OciSortOrder
}

export interface OciSecretsGetVaultParams extends OciSecretsAuthParams {
  vaultId: string
}

export interface OciSecretsListKeysParams extends OciSecretsListVaultsParams {
  vaultId: string
  protectionMode?: OciProtectionMode
  algorithm?: 'AES' | 'RSA' | 'ECDSA'
  length?: number
  curveId?: 'NIST_P256' | 'NIST_P384' | 'NIST_P521'
}

export interface OciSecretsGetKeyParams extends OciSecretsGetVaultParams {
  keyId: string
}

export interface OciSecretsListWorkRequestsParams
  extends OciSecretsAuthParams,
    OciSecretsPaginationParams {
  compartmentId: string
  secretId: string
}

export interface OciSecretsGetWorkRequestParams extends OciSecretsAuthParams {
  workRequestId: string
}

export interface OciSecretsListWorkRequestErrorsParams
  extends OciSecretsGetWorkRequestParams,
    OciSecretsPaginationParams {
  sortOrder?: OciSortOrder
}

export type OciSecretsListWorkRequestLogsParams = OciSecretsListWorkRequestErrorsParams

export interface OciRotationMetadata {
  targetSystemDetails: OciRotationConfig['targetSystemDetails']
  rotationInterval: string | null
  isScheduledRotationEnabled: boolean | null
}

export interface OciGenerationMetadata {
  generationType: string
  generationTemplate: string
  secretTemplate: string | null
  passphraseLength: number | null
}

export type OciSecretRuleMetadata =
  | {
      ruleType: 'SECRET_EXPIRY_RULE'
      isSecretContentRetrievalBlockedOnExpiry: boolean | null
      secretVersionExpiryInterval: string | null
      timeOfAbsoluteExpiry: string | null
    }
  | {
      ruleType: 'SECRET_REUSE_RULE'
      isEnforcedOnDeletedSecretVersions: boolean | null
    }

export interface OciReplicationMetadata {
  replicationTargets: OciReplicationConfig['replicationTargets']
  isWriteForwardEnabled: boolean | null
}

export interface OciSecretSummary {
  id: string
  compartmentId: string
  vaultId: string
  secretName: string
  lifecycleState: string
  timeCreated: string
  description: string | null
  keyId: string | null
  lifecycleDetails: string | null
  timeOfCurrentVersionExpiry: string | null
  timeOfDeletion: string | null
  freeformTags: Record<string, string> | null
  definedTags: Record<string, unknown> | null
  rotationConfig: OciRotationMetadata | null
  rotationStatus: string | null
  lastRotationTime: string | null
  nextRotationTime: string | null
  isAutoGenerationEnabled: boolean | null
  secretGenerationContext: OciGenerationMetadata | null
}

export interface OciSecret extends OciSecretSummary {
  currentVersionNumber: number | null
  metadata: Record<string, unknown> | null
  secretRules: OciSecretRuleMetadata[]
  replicationConfig: OciReplicationMetadata | null
  isReplica: boolean | null
  sourceRegionInformation: {
    sourceKeyId: string
    sourceRegion: string
    sourceVaultId: string
  } | null
}

export interface OciSecretVersion {
  secretId: string | null
  versionNumber: number | null
  name: string | null
  contentType: string | null
  stages: string[]
  timeCreated: string | null
  timeOfDeletion: string | null
  timeOfCurrentVersionExpiry: string | null
  isContentAutoGenerated: boolean | null
}

export interface OciSecretVersionSummary
  extends Omit<OciSecretVersion, 'timeOfCurrentVersionExpiry'> {
  secretId: string
  versionNumber: number
  timeCreated: string
  timeOfExpiry: string | null
}

export interface OciSecretBundleVersion {
  secretId: string
  versionNumber: number
  versionName: string | null
  stages: string[]
  timeCreated: string | null
  timeOfDeletion: string | null
  timeOfExpiry: string | null
}

export interface OciSecretBundle extends OciSecretBundleVersion {
  metadata: Record<string, unknown> | null
  secretBundleContent: { contentType: 'BASE64'; content: string | null } | null
}

export interface OciVaultSummary {
  id: string
  compartmentId: string
  displayName: string
  lifecycleState: string
  vaultType: string
  timeCreated: string
  managementEndpoint: string
  cryptoEndpoint: string
  freeformTags: Record<string, string> | null
  definedTags: Record<string, unknown> | null
}

export interface OciVault extends OciVaultSummary {
  timeOfDeletion: string | null
  isPrimary: boolean | null
  restoredFromVaultId: string | null
  wrappingkeyId: string | null
}

export interface OciKeySummary {
  id: string
  compartmentId: string
  vaultId: string
  displayName: string
  lifecycleState: string
  timeCreated: string
  protectionMode: string | null
  algorithm: string | null
  isAutoRotationEnabled: boolean | null
  freeformTags: Record<string, string> | null
  definedTags: Record<string, unknown> | null
}

export interface OciKey extends Omit<OciKeySummary, 'algorithm'> {
  currentKeyVersion: string
  keyShape: { algorithm: string; length: number; curveId: string | null }
  timeOfDeletion: string | null
  isPrimary: boolean | null
  restoredFromKeyId: string | null
}

export interface OciWorkRequestSummary {
  id: string
  compartmentId: string
  operationType: string
  status: string
  percentComplete: number
  timeAccepted: string
  timeStarted: string | null
  timeFinished: string | null
}

export interface OciWorkRequest extends OciWorkRequestSummary {
  resources: {
    actionType: string
    entityType: string
    identifier: string
    entityUri: string | null
  }[]
}

export interface OciWorkRequestLog {
  message: string
  timestamp: string
}

export interface OciWorkRequestError extends OciWorkRequestLog {
  code: string
}

export interface OciSecretsResponse extends ToolResponse {
  output: {
    status: number
    opcRequestId: string | null
    etag?: string | null
    nextPage?: string | null
    workRequestId?: string | null
    secretValue?: string | null
    secret?: OciSecret
    secrets?: OciSecretSummary[]
    secretVersion?: OciSecretVersion
    secretVersions?: OciSecretVersionSummary[]
    secretBundle?: OciSecretBundle
    secretBundleVersions?: OciSecretBundleVersion[]
    vault?: OciVault
    vaults?: OciVaultSummary[]
    key?: OciKey
    keys?: OciKeySummary[]
    workRequest?: OciWorkRequest
    workRequests?: OciWorkRequestSummary[]
    errors?: OciWorkRequestError[]
    logs?: OciWorkRequestLog[]
  }
}
