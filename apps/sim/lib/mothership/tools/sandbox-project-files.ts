import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { getRedisClient } from '@/lib/core/config/redis'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { createDurableSecretProvenanceRegistry } from '@/lib/execution/durable-secret-provenance'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import {
  readSessionSecretProvenance,
  recordExistingSessionFileInput,
} from '@/lib/execution/remote-sandbox/session-file-provenance'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { createProjectFileCliTransport } from '@/lib/mothership/agent-cli/project-file-transport'
import { createProjectFileUploadTransport } from '@/lib/mothership/agent-cli/project-file-upload-transport'
import { createProjectFileWriteTransport } from '@/lib/mothership/agent-cli/project-file-write-transport'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import {
  type readSandboxResourceScope,
  recordSandboxResourceEffects,
} from '@/lib/mothership/tools/sandbox-resources'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { observeWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('SandboxProjectFiles')

/** Authenticated callback lease supplies identity; every selected Project operation reauthorizes it. */
export async function proxySandboxProjectFileRequest(
  request: Request,
  token: string,
  path: string,
  search: string,
  scope: NonNullable<Awaited<ReturnType<typeof readSandboxResourceScope>>>,
  projectId: string
): Promise<Response> {
  const endpoint = getInternalApiBaseUrl()
  const sessionKey = chatSandboxSessionKey(scope.chatId)
  const context: AgentCliExecutionContext = {
    userId: scope.userId,
    chatId: scope.chatId,
    toolCallId: scope.toolCallId,
    copilotToolExecution: true,
    copilotResourceAdmission: createCopilotResourceAdmission({
      userId: scope.userId,
      invocation: { kind: 'chat', chatId: scope.chatId },
    }),
    signal: request.signal,
  }
  const history = async () => {
    request.signal.throwIfAborted()
    const provider = resolveProvider()
    const machine = await provider.findSessionSandbox?.(sessionKey, {})
    if (!machine) throw new Error('The active workbench is unavailable')
    const provenance = await readSessionSecretProvenance(sessionKey, {
      providerId: provider.id,
      sandboxId: machine.sandboxId,
    })
    if (provenance.status !== 'exact') throw new Error('Workbench source provenance is unavailable')
    return provenance
  }
  const resolveSecretTraceRegistry = async () =>
    (await createDurableSecretProvenanceRegistry(await history(), {
      userId: scope.userId,
    })) ?? new ResolvedSecretTraceRegistry([], { userId: scope.userId })
  const bindingKey = `mothership:sandbox-resources:${token}:project-uploads:${encodeURIComponent(projectId)}`
  const redis = () => {
    const client = getRedisClient()
    if (!client) throw new Error('Workbench upload binding is unavailable')
    return client
  }
  const transport = createProjectFileUploadTransport({
    endpoint,
    projectId,
    context,
    resolveSecretTraceRegistry,
    uploadBinding: {
      async record(uploadId) {
        await redis().eval(
          "redis.call('SADD', KEYS[1], ARGV[1]); redis.call('EXPIRE', KEYS[1], 600); return 1",
          1,
          bindingKey,
          uploadId
        )
      },
      async contains(uploadId) {
        return (await redis().sismember(bindingKey, uploadId)) === 1
      },
    },
    /** Direct uploads conservatively retain the physical machine's complete source history. */
    async uploadProvenance() {
      const provenance = await history()
      request.signal.throwIfAborted()
      return {
        status: 'exact',
        entries: provenance.entries.map((entry) => {
          if (!entry.sourceUserId) throw new Error('Workbench source identity is unavailable')
          return { ...entry, sourceUserId: entry.sourceUserId }
        }),
      }
    },
    fallback: createProjectFileWriteTransport({
      endpoint,
      projectId,
      context,
      resolveSecretTraceRegistry,
      fallback: createProjectFileCliTransport(endpoint, context, { projectId }),
    }),
  })
  const headers = new Headers(request.headers)
  for (const name of [
    'host',
    'cookie',
    'authorization',
    'connection',
    'transfer-encoding',
    'x-api-key',
    'x-mothership-workspace-id',
    'x-mothership-file-owner',
  ])
    headers.delete(name)
  const forwarded = new Request(`${endpoint.replace(/\/$/, '')}${path}${search}`, {
    method: request.method,
    headers,
    signal: request.signal,
    redirect: 'manual',
    ...(request.method === 'GET' || request.method === 'HEAD'
      ? {}
      : { body: request.body, duplex: 'half' }),
  })
  let observed = false
  const delivery: typeof fetch = (input, init) =>
    observeWorkspaceFileDelivery(
      async (provenance) => {
        if (provenance?.status !== 'exact')
          throw new Error('Project file provenance is unavailable')
        await recordExistingSessionFileInput(sessionKey, provenance)
        observed = true
      },
      () => transport(input, init)
    )
  const effects: ResourceChange[] = []
  let completed: Response | undefined
  const dispatch: typeof fetch = async (input, init) => {
    completed = await delivery(input, init)
    return completed
  }
  let response: Response
  try {
    response = await createResourceEffectTransport(endpoint, dispatch, effects)(forwarded)
  } catch (error) {
    if (!completed) throw error
    response = completed
    logger.warn('Project callback effect projection failed after API completion', {
      toolCallId: scope.toolCallId,
    })
  }
  if (response.ok && response.body && response.headers.has('Content-Disposition') && !observed) {
    await response.body.cancel()
    return Response.json(
      { error: 'File read provenance is unavailable. Retry the read.' },
      { status: 503 }
    )
  }
  const requestId = generateId()
  await recordSandboxResourceEffects(
    token,
    scope,
    effects.map((effect, index) => ({
      ...effect,
      effectId: `${scope.runId}:${scope.toolCallId}:${requestId}:${index}`,
    }))
  )
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
