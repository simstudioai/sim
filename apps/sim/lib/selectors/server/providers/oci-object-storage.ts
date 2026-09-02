import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getOciObjectStorageServiceAccountSecret } from '@/lib/credentials/oci-object-storage-service-account'
import {
  sendOciListBuckets,
  withOciObjectStorageClient,
} from '@/lib/internal/oci-object-storage/client'
import { normalizeOciObjectStorageError } from '@/lib/internal/oci-object-storage/errors'
import {
  isValidOciBucketName,
  isValidOciObjectText,
  OCI_CONTINUATION_TOKEN_MAX_LENGTH,
} from '@/lib/internal/oci-object-storage/schema'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import {
  definePreparedSelectorAttachment,
  listSelectorResult,
  requireListRequest,
} from '@/lib/selectors/server/types'

type OciObjectStorageSelectorKey = Extract<
  ServerSelectorKey,
  'oci_object_storage.buckets' | 'oci_object_storage.objects'
>

const SELECTOR_PAGE_SIZE = 100

async function prepareCredential(args: ExecuteServerSelectorArgs) {
  const credential = args.credential
  if (
    !credential ||
    credential.providerId !== 'oci-object-storage-service-account' ||
    credential.access?.credentialType !== 'service_account' ||
    !credential.access.resolvedCredentialId
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  try {
    return await getOciObjectStorageServiceAccountSecret(credential.access.resolvedCredentialId)
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}

function requireBucketName(value: string | undefined): string {
  const bucketName = value?.trim()
  if (!bucketName || !isValidOciBucketName(bucketName)) {
    throw new SelectorContextUnavailableError()
  }
  return bucketName
}

function optionalPrefix(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  if (!isValidOciObjectText(value, true)) {
    throw new SelectorContextUnavailableError()
  }
  return value
}

function optionalCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!value || value.length > OCI_CONTINUATION_TOKEN_MAX_LENGTH) {
    throw new SelectorContextUnavailableError()
  }
  return value
}

async function executeBuckets(
  args: ExecuteServerSelectorArgs,
  secret: Awaited<ReturnType<typeof prepareCredential>>
) {
  if (args.request.kind !== 'list') throw new SelectorOptionsUnavailableError()
  try {
    const response = await withOciObjectStorageClient(secret, 3, (client) =>
      sendOciListBuckets(client, args.signal)
    )
    const options = (response.Buckets ?? [])
      .filter((bucket): bucket is typeof bucket & { Name: string } => Boolean(bucket.Name))
      .map((bucket) => ({
        id: bucket.Name,
        label: bucket.Name,
        ...(bucket.CreationDate
          ? { meta: { detail: `Created ${bucket.CreationDate.toISOString()}` } }
          : {}),
      }))
      .sort((left, right) => left.label.localeCompare(right.label))
    return flatSelectorResult(args.request, options)
  } catch (error) {
    args.signal?.throwIfAborted()
    const normalized = normalizeOciObjectStorageError(error)
    throw selectorProviderStatusError(normalized.status)
  }
}

async function executeObjects(
  args: ExecuteServerSelectorArgs,
  secret: Awaited<ReturnType<typeof prepareCredential>>
) {
  const request = requireListRequest(args.selectorKey, args.request)
  const bucketName = requireBucketName(args.context.bucketName)
  const prefix = optionalPrefix(args.context.prefix)
  const continuationToken = optionalCursor(request.cursor)
  try {
    const response = await withOciObjectStorageClient(secret, 3, (client) =>
      client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: SELECTOR_PAGE_SIZE,
          ContinuationToken: continuationToken,
        }),
        { abortSignal: args.signal }
      )
    )
    if (response.IsTruncated && !response.NextContinuationToken) {
      throw new SelectorOptionsUnavailableError()
    }
    const items = (response.Contents ?? []).flatMap((object) =>
      object.Key && Number.isSafeInteger(object.Size) && (object.Size as number) >= 0
        ? [
            {
              id: object.Key,
              label: object.Key,
              meta: {
                detail: `${object.Size} bytes${object.LastModified ? ` · ${object.LastModified.toISOString()}` : ''}`,
              },
            },
          ]
        : []
    )
    return listSelectorResult(items, response.NextContinuationToken)
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof SelectorOptionsUnavailableError) throw error
    const normalized = normalizeOciObjectStorageError(error)
    throw selectorProviderStatusError(normalized.status)
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oci_object_storage'],
} as const

const integrationBlockTypes = ['oci_object_storage'] as const

export const ociObjectStorageSelectorAttachments = {
  'oci_object_storage.buckets': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareCredential },
    execute: executeBuckets,
  }),
  'oci_object_storage.objects': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareCredential },
    execute: executeObjects,
  }),
} satisfies ServerSelectorAttachmentMap<OciObjectStorageSelectorKey>
