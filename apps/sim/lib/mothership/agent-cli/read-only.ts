import { toRecord } from '@sim/utils/object'
import type { BlockState } from '@sim/workflow-types/workflow'
import { v2WorkflowGraphSchema } from '@/lib/api/contracts/v2/workflows'
import type { AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import { sanitizeWorkflowForSharing } from '@/lib/workflows/credentials/credential-extractor'

const READ_ENGINES = new Set([
  'files read',
  'files view',
  'docs search',
  'grep',
  'logs query',
  'workflows deps',
  'workflows inputs',
  'workflows tools',
  'workflows lint',
  'workflows api',
])

/** Services and sinks bypass the HTTP transport, so admission checks them independently. */
export function isReadOnlyCliRequest(request: AgentCliRequest): boolean {
  if (request.sink) return false
  const invocation = request.invocation
  return (
    invocation.kind === 'cli' ||
    (invocation.kind === 'augmentation' && READ_ENGINES.has(invocation.name))
  )
}

/** Keep the acting user's authorization while refusing mutations before any transport interceptor runs. */
export function readOnlyCliTransport(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    if (
      request.method !== 'GET' &&
      !(request.method === 'POST' && /^\/api\/v2\/tables\/[^/]+\/query(?:\/count)?$/.test(path))
    ) {
      return Response.json(
        {
          error: { message: 'Benchmark reference generation can only read the source workspace.' },
        },
        { status: 403 }
      )
    }
    const response = await transport(request)
    if (!response.ok || !/^\/api\/v2\/workflows\/[^/]+\/state$/.test(path)) return response
    const graph = v2WorkflowGraphSchema.parse(toRecord(await response.json()).data)
    const sanitized = sanitizeWorkflowForSharing(
      { blocks: graph.blocks as Record<string, BlockState> },
      { preserveEnvVars: true, preserveWorkspaceBindings: true, redactOpaqueCredentialInputs: true }
    )
    return Response.json({ data: { ...graph, blocks: sanitized.blocks } })
  }
}
