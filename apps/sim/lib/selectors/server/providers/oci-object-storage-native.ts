import { isPlainRecord } from '@sim/utils/object'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  executeOciNativeOperation,
  prepareOciNativeClient,
} from '@/lib/internal/oci-object-storage-native/operations'
import { ociNativeInputSchema } from '@/lib/internal/oci-object-storage-native/schema'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import { definePreparedSelectorAttachment, listSelectorResult } from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type NativeSelectorKey = 'oci_object_storage_native.buckets' | 'oci_object_storage_native.objects'

async function prepareDestination(args: ExecuteServerSelectorArgs) {
  const credential = args.credential
  const credentialId = credential?.access?.resolvedCredentialId
  if (
    !credentialId ||
    credential.access?.credentialType !== 'service_account' ||
    credential.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  args.signal?.throwIfAborted()
  try {
    const prepared = await prepareOciNativeClient(
      { credentialId, region: args.context.region || undefined },
      args.workspaceId
    )
    args.signal?.throwIfAborted()
    return { credentialId, prepared }
  } catch {
    args.signal?.throwIfAborted()
    throw new SelectorConnectionUnavailableError()
  }
}

async function executeNativeSelector(
  args: ExecuteServerSelectorArgs,
  destination: Awaited<ReturnType<typeof prepareDestination>>
) {
  if (args.request.kind !== 'list') throw new SelectorOptionsUnavailableError()
  const buckets = args.selectorKey === 'oci_object_storage_native.buckets'
  const parsed = ociNativeInputSchema.safeParse({
    operation: buckets ? 'list_buckets' : 'list_objects',
    credentialId: destination.credentialId,
    region: args.context.region || undefined,
    namespace: args.context.namespace || undefined,
    limit: 100,
    ...(buckets
      ? { compartmentId: args.context.compartmentId, page: args.request.cursor }
      : {
          bucketName: args.context.bucketName,
          prefix: args.context.prefix,
          start: args.request.cursor,
        }),
  })
  if (!parsed.success) throw new SelectorContextUnavailableError()
  try {
    const result = await executeOciNativeOperation(
      parsed.data,
      {
        workspaceId: args.workspaceId,
        requestId: 'oci-native-selector',
        signal: args.signal,
      },
      destination.prepared
    )
    const values = result.output[buckets ? 'buckets' : 'objects']
    if (!Array.isArray(values) || values.length > 100) throw new SelectorOptionsUnavailableError()
    const options = new Map<string, SafeSelectorOption>()
    for (const value of values) {
      if (
        !isPlainRecord(value) ||
        typeof value.name !== 'string' ||
        !value.name ||
        Buffer.byteLength(value.name, 'utf8') > 1_024
      )
        throw new SelectorOptionsUnavailableError()
      options.set(value.name, {
        id: value.name,
        label: value.name,
        ...(!buckets && typeof value.size === 'number' ? { meta: { size: value.size } } : {}),
      })
    }
    const next = result.output[buckets ? 'nextPage' : 'nextStartWith']
    return listSelectorResult([...options.values()], typeof next === 'string' ? next : undefined)
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OciClientError) throw selectorProviderStatusError(error.status ?? 502)
    throw new SelectorOptionsUnavailableError()
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oci_object_storage_native'],
} as const
const integrationBlockTypes = ['oci_object_storage_native'] as const

export const ociObjectStorageNativeSelectorAttachments = {
  'oci_object_storage_native.buckets': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeNativeSelector,
  }),
  'oci_object_storage_native.objects': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeNativeSelector,
  }),
} satisfies ServerSelectorAttachmentMap<NativeSelectorKey>
