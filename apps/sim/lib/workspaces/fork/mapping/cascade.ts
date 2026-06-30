import { customTools, knowledgeConnector, mcpServers } from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  ENV_REF_PATTERN,
  type ForkReference,
  type ForkReferenceResolver,
} from '@/lib/workspaces/fork/remap/remap-references'

function extractEnvKeys(text: string): string[] {
  const keys = new Set<string>()
  for (const match of text.matchAll(ENV_REF_PATTERN)) {
    if (match[1]) keys.add(match[1])
  }
  return Array.from(keys)
}

export interface ForkCascadeResult {
  /** Transitive env-var / credential references discovered inside referenced resources. */
  references: ForkReference[]
  unmapped: ForkReference[]
  /** Source MCP server ids that use OAuth and need re-authorization in the target. */
  mcpReauthServerIds: string[]
  /** Human-readable descriptions of inline secrets that cannot be mapped (review-only). */
  inlineSecretSources: string[]
}

const EMPTY: ForkCascadeResult = {
  references: [],
  unmapped: [],
  mcpReauthServerIds: [],
  inlineSecretSources: [],
}

/**
 * Walk the bodies of resources a workflow references (custom tools, MCP servers,
 * knowledge bases) and surface the secrets they carry transitively: `{{ENV}}`
 * keys inside custom tool code and MCP url/headers, and credential ids on KB
 * connectors. These become additional required env-var / credential references
 * (validated for existence in the target via `resolve`). OAuth MCP servers and
 * inline connector keys are surfaced separately for review since they cannot be
 * id-mapped. Reads only the source workspace's resources.
 */
export async function detectForkCascadeReferences(params: {
  executor: DbOrTx
  sourceWorkspaceId: string
  references: ForkReference[]
  resolve: ForkReferenceResolver
}): Promise<ForkCascadeResult> {
  const { executor, sourceWorkspaceId, references, resolve } = params

  const customToolIds = new Set<string>()
  const mcpServerIds = new Set<string>()
  const knowledgeBaseIds = new Set<string>()
  for (const reference of references) {
    if (reference.kind === 'custom-tool') customToolIds.add(reference.sourceId)
    else if (reference.kind === 'mcp-server') mcpServerIds.add(reference.sourceId)
    else if (reference.kind === 'knowledge-base') knowledgeBaseIds.add(reference.sourceId)
  }

  if (customToolIds.size === 0 && mcpServerIds.size === 0 && knowledgeBaseIds.size === 0) {
    return EMPTY
  }

  const refs = new Map<string, ForkReference>()
  const unmapped = new Map<string, ForkReference>()
  const mcpReauthServerIds = new Set<string>()
  const inlineSecretSources: string[] = []

  const recordEnv = (key: string, sourceLabel: string) => {
    const dedupeKey = `env-var:${key}`
    if (refs.has(dedupeKey)) return
    const reference: ForkReference = {
      kind: 'env-var',
      sourceId: key,
      subBlockKey: '(cascade)',
      blockName: sourceLabel,
      required: true,
    }
    refs.set(dedupeKey, reference)
    if (resolve('env-var', key) == null) unmapped.set(dedupeKey, reference)
  }

  const recordCredential = (credentialId: string, sourceLabel: string) => {
    const dedupeKey = `credential:${credentialId}`
    if (refs.has(dedupeKey)) return
    const reference: ForkReference = {
      kind: 'credential',
      sourceId: credentialId,
      subBlockKey: '(cascade)',
      blockName: sourceLabel,
      required: true,
    }
    refs.set(dedupeKey, reference)
    if (resolve('credential', credentialId) == null) unmapped.set(dedupeKey, reference)
  }

  if (customToolIds.size > 0) {
    const tools = await executor
      .select({ id: customTools.id, title: customTools.title, code: customTools.code })
      .from(customTools)
      .where(
        and(
          inArray(customTools.id, Array.from(customToolIds)),
          eq(customTools.workspaceId, sourceWorkspaceId)
        )
      )
    for (const tool of tools) {
      for (const key of extractEnvKeys(tool.code ?? '')) {
        recordEnv(key, `Custom tool: ${tool.title}`)
      }
    }
  }

  if (mcpServerIds.size > 0) {
    const servers = await executor
      .select({
        id: mcpServers.id,
        name: mcpServers.name,
        url: mcpServers.url,
        headers: mcpServers.headers,
        authType: mcpServers.authType,
      })
      .from(mcpServers)
      .where(
        and(
          inArray(mcpServers.id, Array.from(mcpServerIds)),
          eq(mcpServers.workspaceId, sourceWorkspaceId)
        )
      )
    for (const server of servers) {
      const label = `MCP server: ${server.name}`
      if (server.url) {
        for (const key of extractEnvKeys(server.url)) recordEnv(key, label)
      }
      const headers = (server.headers ?? {}) as Record<string, unknown>
      for (const [headerName, headerValue] of Object.entries(headers)) {
        if (typeof headerValue !== 'string') continue
        const keys = extractEnvKeys(headerValue)
        if (keys.length > 0) {
          for (const key of keys) recordEnv(key, label)
        } else if (server.authType === 'headers' && headerValue) {
          inlineSecretSources.push(`${label} (header ${headerName})`)
        }
      }
      if (server.authType === 'oauth') mcpReauthServerIds.add(server.id)
    }
  }

  if (knowledgeBaseIds.size > 0) {
    const connectors = await executor
      .select({
        id: knowledgeConnector.id,
        knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
        credentialId: knowledgeConnector.credentialId,
        encryptedApiKey: knowledgeConnector.encryptedApiKey,
      })
      .from(knowledgeConnector)
      .where(
        and(
          inArray(knowledgeConnector.knowledgeBaseId, Array.from(knowledgeBaseIds)),
          isNull(knowledgeConnector.deletedAt)
        )
      )
    for (const connector of connectors) {
      if (connector.credentialId) {
        recordCredential(connector.credentialId, `Knowledge base connector`)
      } else if (connector.encryptedApiKey) {
        inlineSecretSources.push(`Knowledge base connector ${connector.id} (API key)`)
      }
    }
  }

  return {
    references: Array.from(refs.values()),
    unmapped: Array.from(unmapped.values()),
    mcpReauthServerIds: Array.from(mcpReauthServerIds),
    inlineSecretSources,
  }
}
