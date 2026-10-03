import { vi } from 'vitest'

interface MockS3BucketConfig {
  bucket: string
  region: string
}

interface MockS3Config extends MockS3BucketConfig {
  endpoint?: string
  forcePathStyle?: boolean
}

interface MockBlobConfig {
  accountName: string
  accountKey: string
  connectionString: string
  containerName: string
}

interface MockGcsConfig {
  bucket: string
}

/**
 * Mutable value-export state for the shared `@/lib/uploads/config` mock. Defaults mirror the
 * real module evaluated with no storage env vars set: local storage (every `USE_*` flag
 * `false`), empty bucket/account strings, and the literal `sim-execution-files` default for the
 * execution-files S3 bucket and Blob container.
 */
export interface UploadsConfigMockState {
  USE_BLOB_STORAGE: boolean
  USE_S3_STORAGE: boolean
  USE_GCS_STORAGE: boolean
  S3_CONFIG: MockS3Config
  BLOB_CONFIG: MockBlobConfig
  GCS_CONFIG: MockGcsConfig
  GCS_KB_CONFIG: MockGcsConfig
  GCS_EXECUTION_FILES_CONFIG: MockGcsConfig
  GCS_CHAT_CONFIG: MockGcsConfig
  GCS_COPILOT_CONFIG: MockGcsConfig
  GCS_PROFILE_PICTURES_CONFIG: MockGcsConfig
  GCS_OG_IMAGES_CONFIG: MockGcsConfig
  GCS_WORKSPACE_LOGOS_CONFIG: MockGcsConfig
  S3_KB_CONFIG: MockS3BucketConfig
  S3_EXECUTION_FILES_CONFIG: MockS3BucketConfig
  BLOB_KB_CONFIG: MockBlobConfig
  BLOB_EXECUTION_FILES_CONFIG: MockBlobConfig
  S3_CHAT_CONFIG: MockS3BucketConfig
  BLOB_CHAT_CONFIG: MockBlobConfig
  S3_COPILOT_CONFIG: MockS3BucketConfig
  BLOB_COPILOT_CONFIG: MockBlobConfig
  S3_PROFILE_PICTURES_CONFIG: MockS3BucketConfig
  BLOB_PROFILE_PICTURES_CONFIG: MockBlobConfig
  S3_OG_IMAGES_CONFIG: MockS3BucketConfig
  BLOB_OG_IMAGES_CONFIG: MockBlobConfig
  S3_WORKSPACE_LOGOS_CONFIG: MockS3BucketConfig
  BLOB_WORKSPACE_LOGOS_CONFIG: MockBlobConfig
}

function emptyBlob(containerName = ''): MockBlobConfig {
  return { accountName: '', accountKey: '', connectionString: '', containerName }
}

function defaultUploadsConfigState(): UploadsConfigMockState {
  return {
    USE_BLOB_STORAGE: false,
    USE_S3_STORAGE: false,
    USE_GCS_STORAGE: false,
    S3_CONFIG: { bucket: '', region: '', endpoint: undefined, forcePathStyle: false },
    BLOB_CONFIG: emptyBlob(),
    GCS_CONFIG: { bucket: '' },
    GCS_KB_CONFIG: { bucket: '' },
    GCS_EXECUTION_FILES_CONFIG: { bucket: '' },
    GCS_CHAT_CONFIG: { bucket: '' },
    GCS_COPILOT_CONFIG: { bucket: '' },
    GCS_PROFILE_PICTURES_CONFIG: { bucket: '' },
    GCS_OG_IMAGES_CONFIG: { bucket: '' },
    GCS_WORKSPACE_LOGOS_CONFIG: { bucket: '' },
    S3_KB_CONFIG: { bucket: '', region: '' },
    S3_EXECUTION_FILES_CONFIG: { bucket: 'sim-execution-files', region: '' },
    BLOB_KB_CONFIG: emptyBlob(),
    BLOB_EXECUTION_FILES_CONFIG: emptyBlob('sim-execution-files'),
    S3_CHAT_CONFIG: { bucket: '', region: '' },
    BLOB_CHAT_CONFIG: emptyBlob(),
    S3_COPILOT_CONFIG: { bucket: '', region: '' },
    BLOB_COPILOT_CONFIG: emptyBlob(),
    S3_PROFILE_PICTURES_CONFIG: { bucket: '', region: '' },
    BLOB_PROFILE_PICTURES_CONFIG: emptyBlob(),
    S3_OG_IMAGES_CONFIG: { bucket: '', region: '' },
    BLOB_OG_IMAGES_CONFIG: emptyBlob(),
    S3_WORKSPACE_LOGOS_CONFIG: { bucket: '', region: '' },
    BLOB_WORKSPACE_LOGOS_CONFIG: emptyBlob(),
  }
}

const state: UploadsConfigMockState = defaultUploadsConfigState()

type MockStorageConfig = Record<string, string | undefined>

type ContextSuffix = 'KB' | 'EXECUTION_FILES' | 'CHAT' | 'COPILOT' | 'PROFILE_PICTURES'
type FallbackSuffix = 'OG_IMAGES' | 'WORKSPACE_LOGOS'

const DEDICATED_CONTEXTS: Record<string, ContextSuffix> = {
  'knowledge-base': 'KB',
  chat: 'CHAT',
  copilot: 'COPILOT',
  execution: 'EXECUTION_FILES',
  'profile-pictures': 'PROFILE_PICTURES',
}

const FALLBACK_CONTEXTS: Record<string, FallbackSuffix> = {
  'og-images': 'OG_IMAGES',
  'workspace-logos': 'WORKSPACE_LOGOS',
}

function s3Config(context: string): MockStorageConfig {
  const general = state.S3_CONFIG
  const dedicated = DEDICATED_CONTEXTS[context]
  if (dedicated) {
    const config = state[`S3_${dedicated}_CONFIG`]
    return { bucket: config.bucket, region: config.region }
  }
  const fallback = FALLBACK_CONTEXTS[context]
  if (fallback) {
    const config = state[`S3_${fallback}_CONFIG`]
    return { bucket: config.bucket || general.bucket, region: config.region || general.region }
  }
  return { bucket: general.bucket, region: general.region }
}

function blobConfig(context: string): MockStorageConfig {
  const general = state.BLOB_CONFIG
  const dedicated = DEDICATED_CONTEXTS[context]
  if (dedicated) {
    const { accountName, accountKey, connectionString, containerName } =
      state[`BLOB_${dedicated}_CONFIG`]
    return { accountName, accountKey, connectionString, containerName }
  }
  const fallback = FALLBACK_CONTEXTS[context]
  if (fallback) {
    const config = state[`BLOB_${fallback}_CONFIG`]
    return {
      accountName: config.accountName || general.accountName,
      accountKey: config.accountKey || general.accountKey,
      connectionString: config.connectionString || general.connectionString,
      containerName: config.containerName || general.containerName,
    }
  }
  const { accountName, accountKey, connectionString, containerName } = general
  return { accountName, accountKey, connectionString, containerName }
}

function gcsConfig(context: string): MockStorageConfig {
  const suffix = DEDICATED_CONTEXTS[context] ?? FALLBACK_CONTEXTS[context]
  const bucket = suffix ? state[`GCS_${suffix}_CONFIG`].bucket : ''
  return { bucket: bucket || state.GCS_CONFIG.bucket }
}

function getStorageConfigImpl(context: string): MockStorageConfig {
  if (state.USE_BLOB_STORAGE) return blobConfig(context)
  if (state.USE_S3_STORAGE) return s3Config(context)
  if (state.USE_GCS_STORAGE) return gcsConfig(context)
  return {}
}

function getStorageProviderImpl(): 'Azure Blob' | 'S3' | 'GCS' | 'Local' {
  if (state.USE_BLOB_STORAGE) return 'Azure Blob'
  if (state.USE_S3_STORAGE) return 'S3'
  if (state.USE_GCS_STORAGE) return 'GCS'
  return 'Local'
}

function isUsingCloudStorageImpl(): boolean {
  return state.USE_S3_STORAGE || state.USE_BLOB_STORAGE || state.USE_GCS_STORAGE
}

function getServeStoragePrefixImpl(): 'blob' | 's3' | 'gcs' {
  if (state.USE_BLOB_STORAGE) return 'blob'
  if (state.USE_GCS_STORAGE) return 'gcs'
  return 's3'
}

/**
 * Controllable mock functions for `@/lib/uploads/config`. Every function is a faithful port of
 * the real (pure) logic over the mutable state set by {@link setUploadsConfig}:
 * - `mockGetStorageProvider` → `'Local'` by default (`'Azure Blob'`/`'S3'`/`'GCS'` per flag).
 * - `mockIsUsingCloudStorage` → `false` by default.
 * - `mockGetServeStoragePrefix` → `'s3'` by default (the real historical default).
 * - `mockGetStorageConfig(context)` → `{}` for local storage, otherwise the per-context bucket /
 *   container with the real general-config fallbacks.
 *
 * @example
 * ```ts
 * import { uploadsConfigMockFns } from '@sim/testing/mocks/uploads-config.mock'
 *
 * uploadsConfigMockFns.mockGetStorageConfig.mockReturnValue({ bucket: 'b', region: 'r' })
 * ```
 */
export const uploadsConfigMockFns = {
  mockGetStorageProvider: vi.fn(getStorageProviderImpl),
  mockIsUsingCloudStorage: vi.fn(isUsingCloudStorageImpl),
  mockGetServeStoragePrefix: vi.fn(getServeStoragePrefixImpl),
  mockGetStorageConfig: vi.fn(getStorageConfigImpl),
}

/**
 * Applies overrides to the shared `@/lib/uploads/config` mock state. Reads of the `USE_*` flags
 * and `*_CONFIG` objects through the mocked module observe the new values immediately.
 *
 * @example
 * ```ts
 * setUploadsConfig({ USE_S3_STORAGE: true, S3_CONFIG: { bucket: 'bucket', region: 'region' } })
 * ```
 */
export function setUploadsConfig(overrides: Partial<UploadsConfigMockState>): void {
  Object.assign(state, overrides)
}

/** Restores the default (local storage) state and the default function implementations. */
export function resetUploadsConfigMock(): void {
  Object.assign(state, defaultUploadsConfigState())
  uploadsConfigMockFns.mockGetStorageProvider.mockReset().mockImplementation(getStorageProviderImpl)
  uploadsConfigMockFns.mockIsUsingCloudStorage
    .mockReset()
    .mockImplementation(isUsingCloudStorageImpl)
  uploadsConfigMockFns.mockGetServeStoragePrefix
    .mockReset()
    .mockImplementation(getServeStoragePrefixImpl)
  uploadsConfigMockFns.mockGetStorageConfig.mockReset().mockImplementation(getStorageConfigImpl)
}

/**
 * Static mock module for `@/lib/uploads/config`. Every value export is a getter over the
 * state set by {@link setUploadsConfig}; functions are {@link uploadsConfigMockFns}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
 * setUploadsConfig({ USE_S3_STORAGE: true })
 * ```
 */
export const uploadsConfigMock = {
  get USE_BLOB_STORAGE() {
    return state.USE_BLOB_STORAGE
  },
  get USE_S3_STORAGE() {
    return state.USE_S3_STORAGE
  },
  get USE_GCS_STORAGE() {
    return state.USE_GCS_STORAGE
  },
  get S3_CONFIG() {
    return state.S3_CONFIG
  },
  get BLOB_CONFIG() {
    return state.BLOB_CONFIG
  },
  get GCS_CONFIG() {
    return state.GCS_CONFIG
  },
  get GCS_KB_CONFIG() {
    return state.GCS_KB_CONFIG
  },
  get GCS_EXECUTION_FILES_CONFIG() {
    return state.GCS_EXECUTION_FILES_CONFIG
  },
  get GCS_CHAT_CONFIG() {
    return state.GCS_CHAT_CONFIG
  },
  get GCS_COPILOT_CONFIG() {
    return state.GCS_COPILOT_CONFIG
  },
  get GCS_PROFILE_PICTURES_CONFIG() {
    return state.GCS_PROFILE_PICTURES_CONFIG
  },
  get GCS_OG_IMAGES_CONFIG() {
    return state.GCS_OG_IMAGES_CONFIG
  },
  get GCS_WORKSPACE_LOGOS_CONFIG() {
    return state.GCS_WORKSPACE_LOGOS_CONFIG
  },
  get S3_KB_CONFIG() {
    return state.S3_KB_CONFIG
  },
  get S3_EXECUTION_FILES_CONFIG() {
    return state.S3_EXECUTION_FILES_CONFIG
  },
  get BLOB_KB_CONFIG() {
    return state.BLOB_KB_CONFIG
  },
  get BLOB_EXECUTION_FILES_CONFIG() {
    return state.BLOB_EXECUTION_FILES_CONFIG
  },
  get S3_CHAT_CONFIG() {
    return state.S3_CHAT_CONFIG
  },
  get BLOB_CHAT_CONFIG() {
    return state.BLOB_CHAT_CONFIG
  },
  get S3_COPILOT_CONFIG() {
    return state.S3_COPILOT_CONFIG
  },
  get BLOB_COPILOT_CONFIG() {
    return state.BLOB_COPILOT_CONFIG
  },
  get S3_PROFILE_PICTURES_CONFIG() {
    return state.S3_PROFILE_PICTURES_CONFIG
  },
  get BLOB_PROFILE_PICTURES_CONFIG() {
    return state.BLOB_PROFILE_PICTURES_CONFIG
  },
  get S3_OG_IMAGES_CONFIG() {
    return state.S3_OG_IMAGES_CONFIG
  },
  get BLOB_OG_IMAGES_CONFIG() {
    return state.BLOB_OG_IMAGES_CONFIG
  },
  get S3_WORKSPACE_LOGOS_CONFIG() {
    return state.S3_WORKSPACE_LOGOS_CONFIG
  },
  get BLOB_WORKSPACE_LOGOS_CONFIG() {
    return state.BLOB_WORKSPACE_LOGOS_CONFIG
  },
  getStorageProvider: uploadsConfigMockFns.mockGetStorageProvider,
  isUsingCloudStorage: uploadsConfigMockFns.mockIsUsingCloudStorage,
  getServeStoragePrefix: uploadsConfigMockFns.mockGetServeStoragePrefix,
  getStorageConfig: uploadsConfigMockFns.mockGetStorageConfig,
}
