import type { ItemCreateParams } from '@1password/sdk'
import { generateId } from '@sim/utils/id'
import type { ContractBody } from '@/lib/api/contracts'
import type {
  onePasswordCreateItemContract,
  onePasswordDeleteItemContract,
  onePasswordGetItemContract,
  onePasswordGetItemFileContract,
  onePasswordGetVaultContract,
  onePasswordListItemsContract,
  onePasswordListVaultsContract,
  onePasswordReplaceItemContract,
  onePasswordResolveSecretContract,
  onePasswordUpdateItemContract,
} from '@/lib/api/contracts/tools/onepassword'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import {
  connectItemToSdkItem,
  connectRequest,
  createOnePasswordClient,
  findItemFileAttributes,
  matchesFilter,
  normalizeSdkItem,
  normalizeSdkItemOverview,
  normalizeSdkVault,
  resolveCredentials,
  toSdkCategory,
  toSdkFieldType,
} from '@/lib/internal/onepassword/client'
import { OnePasswordOperationError } from '@/lib/internal/onepassword/errors'
import {
  applyOnePasswordPatch,
  type JsonPatchOperation,
} from '@/lib/internal/onepassword/json-patch'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

export interface OnePasswordOperationContext {
  signal?: AbortSignal
}

type ListVaultsInput = ContractBody<typeof onePasswordListVaultsContract>
type GetVaultInput = ContractBody<typeof onePasswordGetVaultContract>
type ListItemsInput = ContractBody<typeof onePasswordListItemsContract>
type GetItemInput = ContractBody<typeof onePasswordGetItemContract>
type CreateItemInput = ContractBody<typeof onePasswordCreateItemContract>
type UpdateItemInput = ContractBody<typeof onePasswordUpdateItemContract>
type ReplaceItemInput = ContractBody<typeof onePasswordReplaceItemContract>
type DeleteItemInput = ContractBody<typeof onePasswordDeleteItemContract>
type ResolveSecretInput = ContractBody<typeof onePasswordResolveSecretContract>
type GetItemFileInput = ContractBody<typeof onePasswordGetItemFileContract>

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function providerMessage(data: unknown, fallback: string): string {
  const message = asRecord(data).message
  return typeof message === 'string' && message ? message : fallback
}

async function runSdk<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted()
  const result = await operation()
  signal?.throwIfAborted()
  return result
}

export async function executeOnePasswordListVaults(
  input: ListVaultsInput,
  context: OnePasswordOperationContext
): Promise<unknown> {
  const credentials = resolveCredentials(input)
  if (credentials.mode === 'service_account') {
    const client = await createOnePasswordClient(credentials.serviceAccountToken, context.signal)
    const vaults = await runSdk(context.signal, () => client.vaults.list())
    const normalized = vaults.map(normalizeSdkVault)
    const filter = input.filter
    if (!filter) return normalized
    return normalized.filter((vault) => matchesFilter(vault.name ?? '', vault.id ?? '', filter))
  }

  const response = await connectRequest({
    serverUrl: credentials.serverUrl,
    apiKey: credentials.apiKey,
    path: '/v1/vaults',
    method: 'GET',
    query: input.filter ? `filter=${encodeURIComponent(input.filter)}` : undefined,
    signal: context.signal,
  })
  const data = await response.json()
  context.signal?.throwIfAborted()
  if (!response.ok) {
    throw new OnePasswordOperationError(response.status, {
      error: providerMessage(data, 'Failed to list vaults'),
    })
  }
  return data
}

export async function executeOnePasswordGetVault(
  input: GetVaultInput,
  context: OnePasswordOperationContext
): Promise<unknown> {
  const credentials = resolveCredentials(input)
  if (credentials.mode === 'service_account') {
    const client = await createOnePasswordClient(credentials.serviceAccountToken, context.signal)
    const vaults = await runSdk(context.signal, () => client.vaults.list())
    const vault = vaults.find((candidate) => candidate.id === input.vaultId)
    if (!vault) {
      throw new OnePasswordOperationError(404, { error: 'Vault not found' })
    }
    return normalizeSdkVault(vault)
  }

  const response = await connectRequest({
    serverUrl: credentials.serverUrl,
    apiKey: credentials.apiKey,
    path: `/v1/vaults/${input.vaultId}`,
    method: 'GET',
    signal: context.signal,
  })
  const data = await response.json()
  context.signal?.throwIfAborted()
  if (!response.ok) {
    throw new OnePasswordOperationError(response.status, {
      error: providerMessage(data, 'Failed to get vault'),
    })
  }
  return data
}

export async function executeOnePasswordListItems(
  input: ListItemsInput,
  context: OnePasswordOperationContext
): Promise<unknown> {
  const credentials = resolveCredentials(input)
  if (credentials.mode === 'service_account') {
    const client = await createOnePasswordClient(credentials.serviceAccountToken, context.signal)
    const items = await runSdk(context.signal, () => client.items.list(input.vaultId))
    const normalized = items.map(normalizeSdkItemOverview)
    const filter = input.filter
    if (!filter) return normalized
    return normalized.filter((item) => matchesFilter(item.title ?? '', item.id ?? '', filter))
  }

  const response = await connectRequest({
    serverUrl: credentials.serverUrl,
    apiKey: credentials.apiKey,
    path: `/v1/vaults/${input.vaultId}/items`,
    method: 'GET',
    query: input.filter ? `filter=${encodeURIComponent(input.filter)}` : undefined,
    signal: context.signal,
  })
  const data = await response.json()
  context.signal?.throwIfAborted()
  if (!response.ok) {
    throw new OnePasswordOperationError(response.status, {
      error: providerMessage(data, 'Failed to list items'),
    })
  }
  return data
}

export async function executeOnePasswordGetItem(
  input: GetItemInput,
  context: OnePasswordOperationContext
): Promise<unknown> {
  const credentials = resolveCredentials(input)
  if (credentials.mode === 'service_account') {
    const client = await createOnePasswordClient(credentials.serviceAccountToken, context.signal)
    const item = await runSdk(context.signal, () => client.items.get(input.vaultId, input.itemId))
    return normalizeSdkItem(item)
  }

  const response = await connectRequest({
    serverUrl: credentials.serverUrl,
    apiKey: credentials.apiKey,
    path: `/v1/vaults/${input.vaultId}/items/${input.itemId}`,
    method: 'GET',
    signal: context.signal,
  })
  const data = await response.json()
  context.signal?.throwIfAborted()
  if (!response.ok) {
    throw new OnePasswordOperationError(response.status, {
      error: providerMessage(data, 'Failed to get item'),
    })
  }
  return data
}

export async function executeOnePasswordCreateItem(
  input: CreateItemInput,
  context: OnePasswordOperationContext
): Promise<unknown> {
  const credentials = resolveCredentials(input)
  if (credentials.mode === 'service_account') {
    const client = await createOnePasswordClient(credentials.serviceAccountToken, context.signal)
    const tags = input.tags
      ? input.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : undefined
    const fields = input.fields
      ? (JSON.parse(input.fields) as Array<Record<string, unknown>>).map((field) => {
          const section = asRecord(field.section)
          return {
            id: (field.id as string) || generateId().slice(0, 8),
            title: (field.label as string) || (field.title as string) || '',
            fieldType: toSdkFieldType((field.type as string) || 'STRING'),
            value: (field.value as string) || '',
            sectionId:
              (section.id as string | undefined) ?? (field.sectionId as string | undefined),
          }
        })
      : undefined
    const item = await runSdk(context.signal, () =>
      client.items.create({
        vaultId: input.vaultId,
        category: toSdkCategory(input.category),
        title: input.title || '',
        tags,
        fields,
      } as ItemCreateParams)
    )
    return normalizeSdkItem(item)
  }

  const body: Record<string, unknown> = {
    vault: { id: input.vaultId },
    category: input.category,
  }
  if (input.title) body.title = input.title
  if (input.tags) body.tags = input.tags.split(',').map((tag) => tag.trim())
  if (input.fields) body.fields = JSON.parse(input.fields)
  const response = await connectRequest({
    serverUrl: credentials.serverUrl,
    apiKey: credentials.apiKey,
    path: `/v1/vaults/${input.vaultId}/items`,
    method: 'POST',
    body,
    signal: context.signal,
  })
  const data = await response.json()
  context.signal?.throwIfAborted()
  if (!response.ok) {
    throw new OnePasswordOperationError(response.status, {
      error: providerMessage(data, 'Failed to create item'),
    })
  }
  return data
}

export async function executeOnePasswordUpdateItem(
  input: UpdateItemInput,
  context: OnePasswordOperationContext
): Promise<unknown> {
  const credentials = resolveCredentials(input)
  const operations = JSON.parse(input.operations) as JsonPatchOperation[]
  if (credentials.mode === 'service_account') {
    const client = await createOnePasswordClient(credentials.serviceAccountToken, context.signal)
    const existing = await runSdk(context.signal, () =>
      client.items.get(input.vaultId, input.itemId)
    )
    const connectItem: Record<string, unknown> = { ...normalizeSdkItem(existing) }
    for (const operation of operations) applyOnePasswordPatch(connectItem, operation)
    const result = await runSdk(context.signal, () =>
      client.items.put(connectItemToSdkItem(connectItem, existing))
    )
    return normalizeSdkItem(result)
  }

  const response = await connectRequest({
    serverUrl: credentials.serverUrl,
    apiKey: credentials.apiKey,
    path: `/v1/vaults/${input.vaultId}/items/${input.itemId}`,
    method: 'PATCH',
    body: operations,
    signal: context.signal,
  })
  const data = await response.json()
  context.signal?.throwIfAborted()
  if (!response.ok) {
    throw new OnePasswordOperationError(response.status, {
      error: providerMessage(data, 'Failed to update item'),
    })
  }
  return data
}

export async function executeOnePasswordReplaceItem(
  input: ReplaceItemInput,
  context: OnePasswordOperationContext
): Promise<unknown> {
  const credentials = resolveCredentials(input)
  const itemData = JSON.parse(input.item) as Record<string, unknown>
  if (credentials.mode === 'service_account') {
    const client = await createOnePasswordClient(credentials.serviceAccountToken, context.signal)
    const existing = await runSdk(context.signal, () =>
      client.items.get(input.vaultId, input.itemId)
    )
    const result = await runSdk(context.signal, () =>
      client.items.put(connectItemToSdkItem(itemData, existing))
    )
    return normalizeSdkItem(result)
  }

  const response = await connectRequest({
    serverUrl: credentials.serverUrl,
    apiKey: credentials.apiKey,
    path: `/v1/vaults/${input.vaultId}/items/${input.itemId}`,
    method: 'PUT',
    body: itemData,
    signal: context.signal,
  })
  const data = await response.json()
  context.signal?.throwIfAborted()
  if (!response.ok) {
    throw new OnePasswordOperationError(response.status, {
      error: providerMessage(data, 'Failed to replace item'),
    })
  }
  return data
}

export async function executeOnePasswordDeleteItem(
  input: DeleteItemInput,
  context: OnePasswordOperationContext
): Promise<{ success: true }> {
  const credentials = resolveCredentials(input)
  if (credentials.mode === 'service_account') {
    const client = await createOnePasswordClient(credentials.serviceAccountToken, context.signal)
    await runSdk(context.signal, () => client.items.delete(input.vaultId, input.itemId))
    return { success: true }
  }

  const response = await connectRequest({
    serverUrl: credentials.serverUrl,
    apiKey: credentials.apiKey,
    path: `/v1/vaults/${input.vaultId}/items/${input.itemId}`,
    method: 'DELETE',
    signal: context.signal,
  })
  context.signal?.throwIfAborted()
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    context.signal?.throwIfAborted()
    throw new OnePasswordOperationError(response.status, {
      error: providerMessage(data, 'Failed to delete item'),
    })
  }
  return { success: true }
}

export async function executeOnePasswordResolveSecret(
  input: ResolveSecretInput,
  context: OnePasswordOperationContext
): Promise<{ value: string; reference: string }> {
  const credentials = resolveCredentials(input)
  if (credentials.mode !== 'service_account') {
    throw new OnePasswordOperationError(400, {
      error: 'Resolve Secret is only available in Service Account mode',
    })
  }
  const client = await createOnePasswordClient(credentials.serviceAccountToken, context.signal)
  const value = await runSdk(context.signal, () => client.secrets.resolve(input.secretReference))
  return { value, reference: input.secretReference }
}

export async function executeOnePasswordGetItemFile(
  input: GetItemFileInput,
  context: OnePasswordOperationContext
): Promise<{
  file: { name: string; mimeType: string; data: string; size: number }
}> {
  const credentials = resolveCredentials(input)
  if (credentials.mode === 'service_account') {
    const client = await createOnePasswordClient(credentials.serviceAccountToken, context.signal)
    const item = await runSdk(context.signal, () => client.items.get(input.vaultId, input.itemId))
    const attributes = findItemFileAttributes(item, input.fileId)
    if (!attributes) {
      throw new OnePasswordOperationError(404, { error: 'File not found on item' })
    }
    assertKnownSizeWithinLimit(attributes.size, MAX_FILE_SIZE, '1Password item file')
    const content = await runSdk(context.signal, () =>
      client.items.files.read(input.vaultId, input.itemId, attributes)
    )
    assertKnownSizeWithinLimit(content.byteLength, MAX_FILE_SIZE, '1Password item file')
    const buffer = Buffer.from(content.buffer, content.byteOffset, content.byteLength)
    return {
      file: {
        name: attributes.name,
        mimeType: 'application/octet-stream',
        data: buffer.toString('base64'),
        size: attributes.size,
      },
    }
  }

  const metadataResponse = await connectRequest({
    serverUrl: credentials.serverUrl,
    apiKey: credentials.apiKey,
    path: `/v1/vaults/${input.vaultId}/items/${input.itemId}/files/${input.fileId}`,
    method: 'GET',
    signal: context.signal,
  })
  if (!metadataResponse.ok) {
    const data = await metadataResponse.json().catch(() => ({}))
    context.signal?.throwIfAborted()
    throw new OnePasswordOperationError(metadataResponse.status, {
      error: providerMessage(data, 'Failed to get file metadata'),
    })
  }
  const metadata = asRecord(await metadataResponse.json())
  context.signal?.throwIfAborted()

  const contentResponse = await connectRequest({
    serverUrl: credentials.serverUrl,
    apiKey: credentials.apiKey,
    path: `/v1/vaults/${input.vaultId}/items/${input.itemId}/files/${input.fileId}/content`,
    method: 'GET',
    maxResponseBytes: MAX_FILE_SIZE,
    signal: context.signal,
  })
  if (!contentResponse.ok) {
    const data = await contentResponse.json().catch(() => ({}))
    context.signal?.throwIfAborted()
    throw new OnePasswordOperationError(contentResponse.status, {
      error: providerMessage(data, 'Failed to download file content'),
    })
  }
  const buffer = Buffer.from(await contentResponse.arrayBuffer())
  context.signal?.throwIfAborted()
  return {
    file: {
      name: typeof metadata.name === 'string' ? metadata.name : 'attachment',
      mimeType: contentResponse.headers.get('content-type') || 'application/octet-stream',
      data: buffer.toString('base64'),
      size: typeof metadata.size === 'number' ? metadata.size : buffer.length,
    },
  }
}
