import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { z } from 'zod'
import { buildObjectKey, normalizePrefix } from '@/lib/data-drains/destinations/utils'
import type { DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainAzureBlobDestination')

/**
 * Azure storage account names: 3-24 chars, lowercase letters and digits only.
 * https://learn.microsoft.com/en-us/azure/storage/common/storage-account-overview#storage-account-name
 */
const ACCOUNT_NAME_RE = /^[a-z0-9]{3,24}$/

/**
 * Azure container names: 3-63 chars, lowercase letters, digits, single hyphens
 * (no leading/trailing/double hyphens).
 * https://learn.microsoft.com/en-us/rest/api/storageservices/naming-and-referencing-containers--blobs--and-metadata
 */
const CONTAINER_NAME_RE = /^[a-z0-9]([a-z0-9]|-(?!-))+[a-z0-9]$/

/** Azure storage account keys are 64 raw bytes => exactly 88 base64 chars (0-2 trailing `=`). */
const ACCOUNT_KEY_RE = /^[A-Za-z0-9+/]+={0,2}$/

/** Public cloud default; sovereign clouds (Gov/China/legacy DE) are validated via allowlist. */
const DEFAULT_ENDPOINT_SUFFIX = 'blob.core.windows.net'

/**
 * Allowlist of Azure Storage endpoint suffixes. URL host must end with one of these
 * (after the account name + dot). Reject anything else to prevent SSRF via attacker-controlled
 * endpoint suffix.
 */
const ALLOWED_ENDPOINT_SUFFIXES = [
  'blob.core.windows.net',
  'blob.core.usgovcloudapi.net',
  'blob.core.chinacloudapi.cn',
  'blob.core.cloudapi.de',
] as const

const azureBlobConfigSchema = z.object({
  accountName: z
    .string()
    .min(1, 'accountName is required')
    .refine((value) => ACCOUNT_NAME_RE.test(value), {
      message: 'accountName must be 3-24 lowercase letters or digits',
    }),
  containerName: z
    .string()
    .min(3, 'containerName must be 3-63 characters')
    .max(63)
    .refine((value) => CONTAINER_NAME_RE.test(value), {
      message: 'containerName must use lowercase letters, digits, or single hyphens',
    }),
  /** Optional prefix; trailing slash is added automatically when assembling blob names. */
  prefix: z.string().max(512).optional(),
  /** Storage endpoint suffix. Must be one of the known Azure Storage suffixes (public/Gov/China/DE). */
  endpointSuffix: z
    .string()
    .refine((v) => (ALLOWED_ENDPOINT_SUFFIXES as readonly string[]).includes(v), {
      message: `endpointSuffix must be one of: ${ALLOWED_ENDPOINT_SUFFIXES.join(', ')}`,
    })
    .optional(),
})

const azureBlobCredentialsSchema = z.object({
  accountKey: z
    .string()
    .length(88, 'accountKey must be exactly 88 base64 characters (64-byte Azure storage key)')
    .refine((v) => ACCOUNT_KEY_RE.test(v), {
      message: 'accountKey must be a base64-encoded Azure storage account key',
    }),
})

export type AzureBlobDestinationConfig = z.infer<typeof azureBlobConfigSchema>
export type AzureBlobDestinationCredentials = z.infer<typeof azureBlobCredentialsSchema>

interface BlobClients {
  containerClient: import('@azure/storage-blob').ContainerClient
}

async function buildClients(
  config: AzureBlobDestinationConfig,
  credentials: AzureBlobDestinationCredentials
): Promise<BlobClients> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  const sharedKeyCredential = new StorageSharedKeyCredential(
    config.accountName,
    credentials.accountKey
  )
  const suffix = config.endpointSuffix ?? DEFAULT_ENDPOINT_SUFFIX
  /**
   * Bound per-attempt timeout. SDK default `tryTimeoutInMs` is "infinite" / OS
   * connection-idle limits, so a hung receiver could pin a delivery indefinitely.
   * 30s per try + 5 tries (~ exponential 0.5s → 30s) caps the worst-case wall time.
   */
  const blobServiceClient = new BlobServiceClient(
    `https://${config.accountName}.${suffix}`,
    sharedKeyCredential,
    {
      retryOptions: {
        tryTimeoutInMs: 30_000,
        maxTries: 5,
        retryDelayInMs: 500,
        maxRetryDelayInMs: 30_000,
      },
    }
  )
  return { containerClient: blobServiceClient.getContainerClient(config.containerName) }
}

interface AzureRestErrorLike {
  statusCode?: number
  code?: string
  message?: string
}

function isAzureRestError(error: unknown): error is AzureRestErrorLike {
  return typeof error === 'object' && error !== null && ('statusCode' in error || 'code' in error)
}

async function withAzureErrorContext<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isAzureRestError(error)) {
      const status = error.statusCode
      const code = error.code
      logger.warn('Azure Blob operation failed', { action, code, status })
      throw new Error(
        `Azure Blob ${action} failed (${code ?? 'Error'}${status ? ` ${status}` : ''}): ${error.message ?? ''}`,
        { cause: error }
      )
    }
    throw error
  }
}

export const azureBlobDestination: DrainDestination<
  AzureBlobDestinationConfig,
  AzureBlobDestinationCredentials
> = {
  type: 'azure_blob',
  displayName: 'Azure Blob Storage',
  configSchema: azureBlobConfigSchema,
  credentialsSchema: azureBlobCredentialsSchema,

  async test({ config, credentials, signal }) {
    const { containerClient } = await buildClients(config, credentials)
    const probeName = `${normalizePrefix(config.prefix)}.sim-drain-write-probe/${generateShortId(12)}`
    const blockBlobClient = containerClient.getBlockBlobClient(probeName)
    await withAzureErrorContext('test-put', () =>
      blockBlobClient.upload(Buffer.alloc(0), 0, {
        blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
        abortSignal: signal,
      })
    )
    try {
      await blockBlobClient.deleteIfExists({ abortSignal: signal })
    } catch (cleanupError) {
      logger.debug('Azure Blob test write probe cleanup failed (non-fatal)', {
        accountName: config.accountName,
        containerName: config.containerName,
        blobName: probeName,
        error: cleanupError,
      })
    }
  },

  openSession({ config, credentials }) {
    let clientsPromise: Promise<BlobClients> | null = null
    return {
      async deliver({ body, contentType, metadata, signal }) {
        if (clientsPromise === null) clientsPromise = buildClients(config, credentials)
        const { containerClient } = await clientsPromise
        const blobName = buildObjectKey(config.prefix, metadata)
        const blockBlobClient = containerClient.getBlockBlobClient(blobName)
        await withAzureErrorContext('put-object', () =>
          blockBlobClient.upload(body, body.byteLength, {
            blobHTTPHeaders: { blobContentType: contentType },
            metadata: {
              simdrainid: metadata.drainId,
              simrunid: metadata.runId,
              simsource: metadata.source,
              simsequence: metadata.sequence.toString(),
              simrowcount: metadata.rowCount.toString(),
            },
            abortSignal: signal,
          })
        )
        logger.debug('Azure Blob chunk delivered', {
          accountName: config.accountName,
          containerName: config.containerName,
          blobName,
          bytes: body.byteLength,
        })
        return {
          locator: `azure://${config.accountName}/${config.containerName}/${blobName}`,
        }
      },
      async close() {},
    }
  },
}
