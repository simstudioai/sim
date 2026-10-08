import { MIMEType } from 'node:util'
import { CallToolResultSchema, ReadResourceResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Principal, SessionPrincipal } from '@sim/auth/principal'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { buildMcpAppFrame } from '@/lib/mcp/app-frame'
import { executeManagedMcpToolUseCase } from '@/lib/mcp/application/execute-managed-tool'
import { executeMcpToolUseCase } from '@/lib/mcp/application/execute-tool'
import { readManagedMcpResource, readMcpResource } from '@/lib/mcp/application/read-resource'
import { decodeMcpBase64, projectMcpEncodedContents } from '@/lib/mcp/encoded-content'
import { MCP_PRESENTATION_MAX_BYTES } from '@/lib/mcp/presentation'
import { loadMcpPresentation, storeMcpPresentation } from '@/lib/mcp/presentation-storage'
import { isManagedMcpConnectionId } from '@/lib/mcp/utils'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { normalizeInlineChatImage } from '@/lib/mothership/chat/inline-image-storage'
import { extractResourcesFromToolResult } from '@/lib/mothership/resources/extraction'
import { changeStoredChatResources } from '@/lib/mothership/resources/store'
import { resolveFileCategory } from '@/lib/uploads/utils/file-category'
import { resolveStoredFileMetadata } from '@/lib/uploads/utils/stored-file-metadata'
import { projectResolvedSecretModelJsonContent } from '@/executor/utils/resolved-secret-content-projection'
import {
  ResolvedSecretTraceProvenanceAccumulator,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export const MCP_PRESENTATION_AUDIENCE = 'sim:mcp-presentations'
const readOperation = defineWorkspaceOperation({
  id: 'mothership.chats.read_mcp_result',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'mcp_tools.use',
  principalKinds: ['session'],
})
const readOrganizationOperation = defineOrganizationOperation({
  id: readOperation.id,
  minimumRole: 'member',
  capability: 'copilot.use',
  principalKinds: ['session'],
})

interface McpResultInput {
  chatId: string
  id: string
  signal?: AbortSignal
}

const readDefinition = {
  operation: readOperation,
  organizationOperation: readOrganizationOperation,
  authorizationOptions: {},
  resolveContext: ({ principal, input }: { principal: Principal; input: McpResultInput }) =>
    resolveOwnedChatContext(principal, input.chatId),
} as const

/** Only trusted server tool execution publishes a manifest; there is no upload surface. */
export const publishMcpResult = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.publish_mcp_result',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'mcp_tools.use',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.publish_mcp_result',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: MCP_PRESENTATION_AUDIENCE,
  }),
  authorizationOptions: {
    delegation: {
      audience: MCP_PRESENTATION_AUDIENCE,
      isWithinScope: (principal, context) => principal.resourceScope?.chatId === context.chatId,
    },
  },
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: Parameters<typeof storeMcpPresentation>[0]
  }) => resolveOwnedChatContext(principal, input.chatId),
  async execute({ context, input: sourceInput, request }) {
    const input = { ...sourceInput, signal: sourceInput.signal ?? request?.signal }
    await requirePresentationWorkspace(context, input.workspaceId)
    const receipt = await storeMcpPresentation({ ...input, chatId: context.chatId })
    if (receipt?.items.length)
      await changeStoredChatResources(
        context.chatId,
        {
          kind: 'upsert',
          resources: extractResourcesFromToolResult('mcp_run_operation', undefined, {
            mcpPresentation: receipt,
          }),
        },
        `mcp-presentation:${receipt.id}`
      )
    return receipt
  },
})

async function requirePresentationWorkspace(
  context: Awaited<ReturnType<typeof resolveOwnedChatContext>>,
  workspaceId: string
) {
  if (context.workspaceId && context.workspaceId !== workspaceId)
    throw new OrchestrationError('not_found', 'MCP result not found')
  if (context.organizationId)
    await resolveInvocationWorkspace(
      { userId: context.userId, organizationId: context.organizationId, chatId: context.chatId },
      workspaceId
    )
}

async function readManifest(
  context: Awaited<ReturnType<typeof resolveOwnedChatContext>>,
  input: McpResultInput
) {
  const manifest = await loadMcpPresentation(context.chatId, input.id, input.signal)
  await requirePresentationWorkspace(context, manifest.workspaceId)
  return manifest
}

export const readMcpResult = defineAuthorizedChatUseCase({
  ...readDefinition,
  async execute({ context, input: sourceInput, request }) {
    const input = { ...sourceInput, signal: sourceInput.signal ?? request?.signal }
    const manifest = await readManifest(context, input)
    return {
      workspaceId: manifest.workspaceId,
      receipt: manifest.receipt,
      arguments: manifest.arguments,
      result: manifest.result,
    }
  },
})

export const readMcpResultMetadata = defineAuthorizedChatUseCase({
  ...readDefinition,
  async execute({ context, input: sourceInput, request }) {
    const input = { ...sourceInput, signal: sourceInput.signal ?? request?.signal }
    const manifest = await readManifest(context, input)
    return { workspaceId: manifest.workspaceId, receipt: manifest.receipt }
  },
})

async function readProviderResource(
  principal: SessionPrincipal,
  manifest: Awaited<ReturnType<typeof loadMcpPresentation>>,
  uri: string,
  signal?: AbortSignal
) {
  const useCase = isManagedMcpConnectionId(manifest.connectionId)
    ? readManagedMcpResource
    : readMcpResource
  const provenance = new ResolvedSecretTraceProvenanceAccumulator({
    userId: principal.userId,
    workspaceId: manifest.workspaceId,
  })
  const result = await useCase.execute({
    principal,
    input: {
      workspaceId: manifest.workspaceId,
      connectionId: manifest.connectionId,
      toolName: manifest.toolName,
      appUri: manifest.appUri,
      uri,
      signal,
      onResolvedSecretTraceProvenance: (value) => provenance.record(value),
    },
  })
  return ReadResourceResultSchema.parse(
    await projectAppValue(result, provenance, principal.userId, manifest.workspaceId)
  )
}

export const readMcpAppFrame = defineAuthorizedChatUseCase({
  ...readDefinition,
  async execute({ principal, context, input: sourceInput, request }) {
    const input = { ...sourceInput, signal: sourceInput.signal ?? request?.signal }
    const manifest = await readManifest(context, input)
    if (!manifest.appUri) throw new OrchestrationError('not_found', 'MCP App not found')
    const resource = await readProviderResource(principal, manifest, manifest.appUri, input.signal)
    const content = resource.contents.find((item) => {
      if (item.uri !== manifest.appUri || !item.mimeType) return false
      try {
        const mime = new MIMEType(item.mimeType)
        return mime.essence === 'text/html' && mime.params.get('profile') === 'mcp-app'
      } catch {
        return false
      }
    })
    if (!content)
      throw new OrchestrationError('validation', 'The MCP App did not return an HTML resource')
    const html = 'text' in content ? content.text : decodeMcpBase64(content.blob).toString('utf8')
    return buildMcpAppFrame(html, content._meta)
  },
})

export const callMcpAppTool = defineAuthorizedChatUseCase({
  ...readDefinition,
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.call_mcp_app_tool',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'mcp_tools.use',
    principalKinds: ['session'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.call_mcp_app_tool',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session'],
  }),
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: McpResultInput & { name: string; arguments?: Record<string, unknown> }
  }) => resolveOwnedChatContext(principal, input.chatId),
  async execute({ principal, context, input: sourceInput, request }) {
    const input = { ...sourceInput, signal: sourceInput.signal ?? request?.signal }
    const manifest = await readManifest(context, input)
    if (!manifest.appUri) throw new OrchestrationError('forbidden', 'This result has no MCP App')
    const provenance = new ResolvedSecretTraceProvenanceAccumulator({
      userId: principal.userId,
      workspaceId: manifest.workspaceId,
    })
    const common = {
      onResolvedSecretTraceProvenance: (value: Parameters<typeof provenance.record>[0]) =>
        provenance.record(value),
      workspaceId: manifest.workspaceId,
      toolName: input.name,
      arguments: input.arguments,
      appOrigin: { toolName: manifest.toolName, resourceUri: manifest.appUri },
      presentation: 'app' as const,
      signal: input.signal,
      timeoutMs: 60_000,
    }
    const result = isManagedMcpConnectionId(manifest.connectionId)
      ? await executeManagedMcpToolUseCase.execute({
          principal,
          input: { ...common, credentialId: manifest.connectionId },
        })
      : await executeMcpToolUseCase.execute({
          principal,
          input: { ...common, serverId: manifest.connectionId },
        })
    const output = result.presentation?.result ?? {
      content: [{ type: 'text' as const, text: result.success ? 'Done' : result.error }],
      isError: !result.success,
    }
    return CallToolResultSchema.parse(
      await projectAppValue(output, provenance, principal.userId, manifest.workspaceId)
    )
  },
})

export const readMcpAppResource = defineAuthorizedChatUseCase({
  ...readDefinition,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: McpResultInput & { uri: string }
  }) => resolveOwnedChatContext(principal, input.chatId),
  async execute({ principal, context, input: sourceInput, request }) {
    const input = { ...sourceInput, signal: sourceInput.signal ?? request?.signal }
    const manifest = await readManifest(context, input)
    if (!manifest.appUri) throw new OrchestrationError('forbidden', 'This result has no MCP App')
    return readProviderResource(principal, manifest, input.uri, input.signal)
  },
})

async function projectAppValue(
  value: Parameters<typeof projectMcpEncodedContents>[0],
  provenance: ResolvedSecretTraceProvenanceAccumulator,
  userId: string,
  workspaceId: string
) {
  const registry = new ResolvedSecretTraceRegistry([], { userId, workspaceId })
  if (
    !(await registry.importProvenance(provenance.exportProvenance(), {
      trusted: true,
      origin: 'mcp.app',
    }))
  )
    throw new OrchestrationError('forbidden', 'MCP App response metadata could not be verified')
  const projection = projectResolvedSecretModelJsonContent(
    projectMcpEncodedContents(value, registry.forkForPropagatedEntries()),
    registry.forkForPropagatedEntries(),
    MCP_PRESENTATION_MAX_BYTES
  )
  if (!projection.safe)
    throw new OrchestrationError('forbidden', 'MCP App response could not be displayed safely')
  return projection.value
}

export const readMcpResultAsset = defineAuthorizedChatUseCase({
  ...readDefinition,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: McpResultInput & { index: number }
  }) => resolveOwnedChatContext(principal, input.chatId),
  async execute({ context, input: sourceInput, request }) {
    const input = { ...sourceInput, signal: sourceInput.signal ?? request?.signal }
    const manifest = await readManifest(context, input)
    const item = manifest.result.content[input.index]
    const receiptItem = manifest.receipt.items.find((item) => item.index === input.index)
    if (!receiptItem || !item || item.type === 'text')
      throw new OrchestrationError('not_found', 'MCP file not found')
    const resource =
      item.type === 'resource_link'
        ? manifest.resources.find((content) => content.uri === item.uri)
        : item.type === 'resource'
          ? item.resource
          : undefined
    const buffer =
      item.type === 'image' || item.type === 'audio'
        ? decodeMcpBase64(item.data)
        : resource && 'blob' in resource
          ? decodeMcpBase64(resource.blob)
          : resource && 'text' in resource
            ? Buffer.from(resource.text)
            : undefined
    if (!buffer) throw new OrchestrationError('not_found', 'MCP file not found')
    const mimeType = receiptItem.mimeType
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType))
      return {
        buffer: await normalizeInlineChatImage(buffer, input.signal),
        contentType: 'image/webp',
        disposition: 'inline',
      }
    const metadata = resolveStoredFileMetadata(`mcp-result-${input.index + 1}`, mimeType, buffer)
    const safeInline =
      resolveFileCategory(metadata.mimeType, '') === 'audio-previewable' ||
      metadata.mimeType === 'application/pdf' ||
      metadata.mimeType === 'text/plain'
    return {
      buffer,
      contentType: metadata.mimeType,
      disposition: safeInline ? 'inline' : 'attachment',
    }
  },
})
