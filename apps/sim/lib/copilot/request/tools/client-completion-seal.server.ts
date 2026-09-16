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

export type ClientToolUnsealFailureReason =
  | 'missing-envelope'
  | 'malformed-envelope'
  | 'decrypt-failed'
  | 'invalid-json'
  | 'invalid-content'
  | 'binding-mismatch'
  | 'registry-mismatch'
  | 'invalid-provenance'

type ReportUnsealFailure = (reason: ClientToolUnsealFailureReason) => void

/** Reads a sealed record while exposing only the guard that refused it, never its contents. */
async function readSealedRecord(
  value: unknown,
  field: typeof SEALED_CLIENT_TOOL_COMPLETION_FIELD | typeof SEALED_CLIENT_TOOL_CONTEXT_FIELD,
  reportFailure?: ReportUnsealFailure
): Promise<Record<string, unknown> | null> {
  if (!isPlainRecord(value)) {
    reportFailure?.(value == null ? 'missing-envelope' : 'malformed-envelope')
    return null
  }
  const sealed = value[field]
  if (sealed === undefined) {
    reportFailure?.('missing-envelope')
    return null
  }
  if (typeof sealed !== 'string' || sealed.length === 0) {
    reportFailure?.('malformed-envelope')
    return null
  }
  let decrypted: string
  try {
    const result = await decryptSecret(sealed)
    decrypted = result.decrypted
  } catch {
    reportFailure?.('decrypt-failed')
    return null
  }
  let content: unknown
  try {
    content = JSON.parse(decrypted)
  } catch {
    reportFailure?.('invalid-json')
    return null
  }
  if (!isPlainRecord(content)) {
    reportFailure?.('invalid-content')
    return null
  }
  return content
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
  expected: ClientToolBinding,
  reportFailure?: ReportUnsealFailure
): Promise<ClientToolCompletionContent | null> {
  const content = await readSealedRecord(value, SEALED_CLIENT_TOOL_COMPLETION_FIELD, reportFailure)
  if (!content) return null
  if (!bindingMatches(content, expected)) {
    reportFailure?.('binding-mismatch')
    return null
  }
  if (content.message !== undefined && typeof content.message !== 'string') {
    reportFailure?.('invalid-content')
    return null
  }
  return {
    ...expected,
    ...(content.message !== undefined ? { message: content.message } : {}),
    ...(Object.hasOwn(content, 'data') ? { data: content.data } : {}),
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
  registry: ResolvedSecretTraceRegistry,
  reportFailure?: ReportUnsealFailure
): Promise<ClientToolContext | null> {
  const context = await readSealedRecord(value, SEALED_CLIENT_TOOL_CONTEXT_FIELD, reportFailure)
  if (!context) return null
  if (!bindingMatches(context, expected)) {
    reportFailure?.('binding-mismatch')
    return null
  }
  if (context.registryInstanceId !== getRegistryInstanceId(registry)) {
    reportFailure?.('registry-mismatch')
    return null
  }
  if (!isResolvedSecretTraceProvenanceV1(context.provenance)) {
    reportFailure?.('invalid-provenance')
    return null
  }
  return {
    ...expected,
    registryInstanceId: context.registryInstanceId,
    provenance: context.provenance,
  }
}
