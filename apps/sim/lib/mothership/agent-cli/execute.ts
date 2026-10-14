import type { EmbeddedCliIdentity } from 'sim/embed'
import { runCli } from '@/lib/mothership/agent-cli/run-cli'
import { applySink } from '@/lib/mothership/agent-cli/sink'
import type { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import type {
  AgentCliAugmentationInvocation,
  AgentCliRawResult,
  AgentCliRequest,
} from '@/lib/mothership/generated/agent-cli'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/mothership/request/otel'

interface PreparedCliInvocation {
  identity: EmbeddedCliIdentity
  sessionKey: string | null
  files?: ReturnType<typeof createWorkbenchFileProvenance>
  resources: ResourceChange[]
  augment(invocation: AgentCliAugmentationInvocation): Promise<AgentCliRawResult>
  curate?(result: AgentCliRawResult): Promise<AgentCliRawResult>
  projectResources?(resources: ResourceChange[]): ResourceChange[]
}

/** Owner adapters prepare authority and transport; every invocation shares execution and result delivery. */
export async function executePreparedCliRequest(
  request: AgentCliRequest,
  prepared: PreparedCliInvocation
): Promise<AgentCliRawResult> {
  const { identity, sessionKey, files, resources } = prepared
  const { invocation, sink } = request
  identity.signal?.throwIfAborted()
  let result: AgentCliRawResult
  if (invocation.kind === 'stdout') {
    result = { exitCode: 0, stdout: invocation.stdout, stderr: '' }
  } else if (invocation.kind === 'service') {
    throw new Error('Service invocation must use the service bridge')
  } else {
    result = await withCopilotSpan(TraceSpan.CopilotCliInvoke, undefined, () =>
      invocation.kind === 'augmentation'
        ? prepared.augment(invocation)
        : runCli(invocation.argv, identity, sessionKey, files)
    )
    if (invocation.kind === 'cli' && prepared.curate) result = await prepared.curate(result)
  }
  if (resources.length)
    result = { ...result, resources: [...resources, ...(result.resources ?? [])] }
  if (result.resources?.length && prepared.projectResources) {
    result = { ...result, resources: prepared.projectResources(result.resources) }
  }
  return sink
    ? withCopilotSpan(TraceSpan.CopilotCliSink, undefined, () =>
        applySink(sink, sessionKey, result, identity.signal, files?.observeOutput)
      )
    : result
}
