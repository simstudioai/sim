import {
  v2ExecuteWorkflowBodySchema,
  v2ExecuteWorkflowContract,
  v2ExecuteWorkflowDataSchema,
  v2ExecuteWorkflowQueuedSchema,
  v2GetWorkflowDeploymentContract,
  v2GetWorkflowRunContract,
  v2GetWorkflowVersionContract,
} from '@/lib/api/contracts/v2/workflows'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { type AgentCliEngine, agentCliFail, agentCliOk } from '@/lib/mothership/agent-cli/types'
import { resolveTriggerRunOptions } from '@/lib/workflows/triggers/run-options'
import { resolveStartCandidates } from '@/lib/workflows/triggers/triggers'

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** Reads authorized deployment snapshots, never the editable draft or credential values. */
export const workflowApiCommand: AgentCliEngine = {
  async execute(positionals, runtime) {
    const [workflowId] = positionals
    if (!workflowId) return agentCliFail('Usage: sim workflows api <workflowId>')
    const encodedId = encodeURIComponent(workflowId)
    const deploymentPath = v2GetWorkflowDeploymentContract.path.replace('[workflowId]', encodedId)
    const deployment = v2GetWorkflowDeploymentContract.response.schema.parse(
      await runtime.client.request(deploymentPath)
    ).data
    const active = deployment.activeDeployment
    if (!deployment.isDeployed || !active) {
      return agentCliOk(
        JSON.stringify({
          workflowId,
          isDeployed: false,
          deployment,
          note: 'No active deployment is serving this workflow. Deploy it before handing callers an API.',
        })
      )
    }
    const versionPath = v2GetWorkflowVersionContract.path
      .replace('[workflowId]', encodedId)
      .replace('[version]', String(active.version))
    const version = v2GetWorkflowVersionContract.response.schema.parse(
      await runtime.client.request(versionPath)
    ).data
    if (!version.isActive || version.id !== active.deploymentVersionId) {
      return agentCliFail(
        'The active deployment changed while reading its API. Run workflows api again.'
      )
    }

    const [entry] = resolveStartCandidates(version.state.blocks, { execution: 'api' })
    if (!entry) {
      return agentCliOk(
        JSON.stringify({
          workflowId,
          activeVersion: active.version,
          apiRunnable: false,
          webhooks: deployment.webhooks,
          note: 'The active version has no API-compatible Start block. Use its configured trigger surface.',
        })
      )
    }
    const option = resolveTriggerRunOptions(version.state.blocks).find(
      (candidate) => candidate.triggerBlockId === entry.blockId
    )
    const endpoint =
      getBaseUrl() + v2ExecuteWorkflowContract.path.replace('[workflowId]', encodedId)
    const pollUrl =
      getBaseUrl() +
      v2GetWorkflowRunContract.path.replace('[workflowId]', encodedId).replace('[runId]', '<runId>')
    const sample = { input: option?.mockPayload ?? {} }
    const authHeader = deployment.isPublicApi ? '' : ' -H "X-API-Key: $SIM_API_KEY"'
    const curl = (body: object, streaming = false, requireKey = false): string =>
      `curl${streaming ? ' -N' : ''} -X POST ${shellQuote(endpoint)} -H 'Content-Type: application/json'${requireKey ? ' -H "X-API-Key: $SIM_API_KEY"' : authHeader} --data ${shellQuote(JSON.stringify(body))}`
    const describeFields = (
      fields: Record<string, { description?: string }>
    ): Record<string, string> =>
      Object.fromEntries(
        Object.entries(fields).map(([name, field]) => [name, field.description ?? name])
      )

    return agentCliOk(
      JSON.stringify(
        {
          workflowId,
          activeVersion: active.version,
          needsRedeployment: deployment.needsRedeployment,
          endpoint,
          method: v2ExecuteWorkflowContract.method,
          authentication: {
            type: deployment.isPublicApi ? 'public' : 'sim_api_key',
            header: 'X-API-Key',
            note: deployment.isPublicApi
              ? 'Anonymous sync/stream execution is enabled. Async execution and reading saved runs require a Sim API key.'
              : 'Use a Sim API key with access to this workflow. Vendor integration credentials are resolved by Sim, not sent in this header.',
          },
          input: {
            blockId: entry.blockId,
            blockName: entry.block.name,
            fields:
              option?.inputFormat.map(({ name, type, description, value }) => ({
                name,
                type,
                ...(description ? { description } : {}),
                default: value,
              })) ?? [],
            note: 'Put these fields inside the request body input object. Defaults come from the active version; downstream blocks may require nonempty values. Examples are illustrative, not executed tests.',
          },
          request: describeFields(
            v2ExecuteWorkflowBodySchema.pick({ input: true, async: true, stream: true }).shape
          ),
          examples: {
            sync: curl(sample),
            stream: curl({ ...sample, stream: true }, true),
            async: curl({ ...sample, async: true }, false, true),
            poll: `curl ${shellQuote(`${pollUrl}?includeOutput=true`)} -H "X-API-Key: $SIM_API_KEY"`,
          },
          responses: {
            envelope:
              'Sync and async JSON responses wrap all result fields in data: read data.output or data.statusUrl, not output or statusUrl at the top level.',
            sync: { httpStatus: 200, data: describeFields(v2ExecuteWorkflowDataSchema.shape) },
            async: { httpStatus: 202, data: describeFields(v2ExecuteWorkflowQueuedSchema.shape) },
            stream:
              'Server-Sent Events instead of the JSON response. Cannot be combined with async.',
            errors:
              'Check HTTP status and data.status. HTTP 200 can contain data.status=failed and data.error; request/authentication errors use the top-level error object.',
            poll: 'Follow data.statusUrl from the queue receipt with the same key; add includeOutput=true to retrieve the saved output. Queued or running is not completion.',
          },
        },
        null,
        2
      )
    )
  },
}
