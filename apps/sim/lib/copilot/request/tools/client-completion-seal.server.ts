import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import type { AsyncCompletionData } from '@/lib/copilot/async-runs/lifecycle'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  isResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export const SEALED_CLIENT_TOOL_COMPLETION_FIELD = '__sealedClientToolCompletionV1'
export const SEALED_CLIENT_TOOL_CONTEXT_FIELD = '__sealedClientToolContextV1'

interface ClientToolBinding {
  toolCallId: string
  runId: string
  userId: string
}

interface ClientToolCompletionContent extends ClientToolBinding {
  message?: string
  data?: AsyncCompletionData
}

interface ClientToolContext extends ClientToolBinding {
  registryInstanceId: string
  provenance: ResolvedSecretTraceProvenanceV1
}

interface SealClientToolContextInput extends ClientToolBinding {
  registry: ResolvedSecretTraceRegistry
  toolInput: unknown
}

type ClientCompletionSealGlobal = typeof globalThis & {
  _clientToolRegistryInstanceIds?: WeakMap<ResolvedSecretTraceRegistry, string>
}

const sealGlobal = globalThis as ClientCompletionSealGlobal
sealGlobal._clientToolRegistryInstanceIds ??= new WeakMap<ResolvedSecretTraceRegistry, string>()
const registryInstanceIds = sealGlobal._clientToolRegistryInstanceIds

function getRegistryInstanceId(registry: ResolvedSecretTraceRegistry): string {
  const existing = registryInstanceIds.get(registry)
  if (existing) return existing

  const created = generateId()
  registryInstanceIds.set(registry, created)
  return created
}

function bindingMatches(value: Record<string, unknown>, expected: ClientToolBinding): boolean {
  return (
    value.toolCallId === expected.toolCallId &&
    value.runId === expected.runId &&
    value.userId === expected.userId
  )
}

export async function sealClientToolCompletion(
  content: ClientToolCompletionContent
): Promise<Record<typeof SEALED_CLIENT_TOOL_COMPLETION_FIELD, string>> {
  const { encrypted } = await encryptSecret(JSON.stringify(content))
  return { [SEALED_CLIENT_TOOL_COMPLETION_FIELD]: encrypted }
}

export async function unsealClientToolCompletion(
  value: unknown,
  expected: ClientToolBinding
): Promise<ClientToolCompletionContent | null> {
  if (!isPlainRecord(value)) return null
  const sealed = value[SEALED_CLIENT_TOOL_COMPLETION_FIELD]
  if (typeof sealed !== 'string' || sealed.length === 0) return null

  try {
    const { decrypted } = await decryptSecret(sealed)
    const content: unknown = JSON.parse(decrypted)
    if (!isPlainRecord(content)) return null
    if (!bindingMatches(content, expected)) return null
    if (content.message !== undefined && typeof content.message !== 'string') return null
    return {
      ...expected,
      ...(content.message !== undefined ? { message: content.message } : {}),
      ...(Object.hasOwn(content, 'data') ? { data: content.data } : {}),
    }
  } catch {
    return null
  }
}

export async function sealClientToolContext(
  input: SealClientToolContextInput
): Promise<Record<typeof SEALED_CLIENT_TOOL_CONTEXT_FIELD, string>> {
  const { registry, toolInput, ...binding } = input
  const context: ClientToolContext = {
    ...binding,
    registryInstanceId: getRegistryInstanceId(registry),
    provenance: registry.exportCommittedProvenanceForValue(toolInput),
  }
  const { encrypted } = await encryptSecret(JSON.stringify(context))
  return { [SEALED_CLIENT_TOOL_CONTEXT_FIELD]: encrypted }
}

export function retainSealedClientToolContext(
  value: unknown
): Partial<Record<typeof SEALED_CLIENT_TOOL_CONTEXT_FIELD, string>> {
  if (!isPlainRecord(value)) return {}
  const sealed = value[SEALED_CLIENT_TOOL_CONTEXT_FIELD]
  return typeof sealed === 'string' && sealed.length > 0
    ? { [SEALED_CLIENT_TOOL_CONTEXT_FIELD]: sealed }
    : {}
}

export async function unsealClientToolContext(
  value: unknown,
  expected: ClientToolBinding,
  registry: ResolvedSecretTraceRegistry
): Promise<ClientToolContext | null> {
  if (!isPlainRecord(value)) return null
  const sealed = value[SEALED_CLIENT_TOOL_CONTEXT_FIELD]
  if (typeof sealed !== 'string' || sealed.length === 0) return null

  try {
    const { decrypted } = await decryptSecret(sealed)
    const context: unknown = JSON.parse(decrypted)
    if (!isPlainRecord(context) || !bindingMatches(context, expected)) return null
    if (context.registryInstanceId !== getRegistryInstanceId(registry)) return null
    if (!isResolvedSecretTraceProvenanceV1(context.provenance)) return null
    return {
      ...expected,
      registryInstanceId: context.registryInstanceId,
      provenance: context.provenance,
    }
  } catch {
    return null
  }
}
