import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  parseOperationInput,
  requestOciDevopsOperation,
} from '@/lib/internal/oci-devops/operations'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID, OCI_SERVICE_ID } from '@/lib/oauth/types'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  listSelectorResult,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption, SelectorContextKey } from '@/lib/selectors/types'
import type { OciDevopsAction, OciDevopsResource } from '@/tools/oci_devops/types'

interface SelectorDefinition {
  parent: string
  context: SelectorContextKey
  list: OciDevopsAction
  get?: OciDevopsAction
  id?: string
}

function option(resource: OciDevopsResource): SafeSelectorOption {
  const id = resource.refName ?? resource.id
  if (!id) throw new SelectorOptionsUnavailableError()
  return {
    id,
    label: resource.displayName ?? resource.name ?? resource.refName ?? id,
    meta: { state: resource.lifecycleState ?? null },
  }
}

function attachment(definition: SelectorDefinition) {
  return definePreparedSelectorAttachment({
    credential: { kind: 'stored', field: 'oauthCredential', serviceIds: [OCI_SERVICE_ID] },
    integrationBlockTypes: ['oci_devops'],
    destination: {
      kind: 'credential-bound',
      async prepare(args: ExecuteServerSelectorArgs) {
        const access = args.credential?.access
        if (
          !access?.ok ||
          !access.resolvedCredentialId ||
          access.workspaceId !== args.workspaceId ||
          args.credential?.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
        )
          throw new SelectorConnectionUnavailableError()
        const parent = args.context[definition.context]
        if (!parent?.trim() || parent.length > 255) throw new SelectorContextUnavailableError()
        const client = await createOciClient({
          credentialId: access.resolvedCredentialId,
          workspaceId: args.workspaceId,
          serviceId: OCI_SERVICE_ID,
          region: args.context.region,
        })
        return { client, parent: parent.trim(), credentialId: access.resolvedCredentialId }
      },
    },
    async execute(args, prepared) {
      try {
        const input: Record<string, unknown> = {
          oauthCredential: prepared.credentialId,
          [definition.parent]: prepared.parent,
        }
        if (args.request.kind === 'detail' && definition.get && definition.id) {
          const params = parseOperationInput(definition.get, {
            oauthCredential: prepared.credentialId,
            [definition.id]: args.request.id,
          })
          const result = await requestOciDevopsOperation(
            prepared.client,
            definition.get,
            params,
            args.signal
          )
          const resource = result.output.resource
          if (
            !resource ||
            resource.id !== args.request.id.trim() ||
            resource[definition.parent as keyof OciDevopsResource] !== prepared.parent
          )
            throw new SelectorOptionsUnavailableError()
          return detailSelectorResult(option(resource))
        }
        if (args.request.kind === 'list') input.page = args.request.cursor
        else {
          input.refName = args.request.id
        }
        const params = parseOperationInput(definition.list, input)
        const result = await requestOciDevopsOperation(
          prepared.client,
          definition.list,
          params,
          args.signal
        )
        const resources = result.output.items ?? []
        if (
          resources.some(
            (resource) => resource[definition.parent as keyof OciDevopsResource] !== prepared.parent
          )
        )
          throw new SelectorOptionsUnavailableError()
        if (args.request.kind === 'detail') {
          const id = args.request.id
          const resource = resources.find((item) => item.refName === id)
          return detailSelectorResult(resource ? option(resource) : null)
        }
        const options = [
          ...new Map(
            resources.map((resource) => {
              const value = option(resource)
              return [value.id, value] as const
            })
          ).values(),
        ]
        return listSelectorResult(options, result.output.nextPage)
      } catch (error) {
        args.signal?.throwIfAborted()
        if (
          error instanceof OciClientError &&
          error.status === 404 &&
          args.request.kind === 'detail'
        )
          return detailSelectorResult(null)
        if (error instanceof OciClientError && (error.status === 401 || error.status === 403))
          throw new SelectorConnectionUnavailableError(error.status)
        if (error instanceof SelectorContextUnavailableError) throw error
        throw new SelectorOptionsUnavailableError()
      }
    },
  })
}

export const ociDevopsSelectorAttachments = {
  'oci_devops.projects': attachment({
    parent: 'compartmentId',
    context: 'compartmentId',
    list: 'list_projects',
    get: 'get_project',
    id: 'projectId',
  }),
  'oci_devops.repositories': attachment({
    parent: 'projectId',
    context: 'projectId',
    list: 'list_repositories',
    get: 'get_repository',
    id: 'repositoryId',
  }),
  'oci_devops.refs': attachment({
    parent: 'repositoryId',
    context: 'repositoryId',
    list: 'list_refs',
  }),
  'oci_devops.buildPipelines': attachment({
    parent: 'projectId',
    context: 'projectId',
    list: 'list_build_pipelines',
    get: 'get_build_pipeline',
    id: 'buildPipelineId',
  }),
  'oci_devops.buildPipelineStages': attachment({
    parent: 'buildPipelineId',
    context: 'pipelineId',
    list: 'list_build_pipeline_stages',
    get: 'get_build_pipeline_stage',
    id: 'buildPipelineStageId',
  }),
  'oci_devops.buildRuns': attachment({
    parent: 'buildPipelineId',
    context: 'pipelineId',
    list: 'list_build_runs',
    get: 'get_build_run',
    id: 'buildRunId',
  }),
  'oci_devops.deployPipelines': attachment({
    parent: 'projectId',
    context: 'projectId',
    list: 'list_deploy_pipelines',
    get: 'get_deploy_pipeline',
    id: 'deployPipelineId',
  }),
  'oci_devops.deployStages': attachment({
    parent: 'deployPipelineId',
    context: 'pipelineId',
    list: 'list_deploy_stages',
    get: 'get_deploy_stage',
    id: 'deployStageId',
  }),
  'oci_devops.deployments': attachment({
    parent: 'deployPipelineId',
    context: 'pipelineId',
    list: 'list_deployments',
    get: 'get_deployment',
    id: 'deploymentId',
  }),
  'oci_devops.environments': attachment({
    parent: 'projectId',
    context: 'projectId',
    list: 'list_deploy_environments',
    get: 'get_deploy_environment',
    id: 'deployEnvironmentId',
  }),
  'oci_devops.artifacts': attachment({
    parent: 'projectId',
    context: 'projectId',
    list: 'list_deploy_artifacts',
    get: 'get_deploy_artifact',
    id: 'deployArtifactId',
  }),
  'oci_devops.connections': attachment({
    parent: 'projectId',
    context: 'projectId',
    list: 'list_connections',
    get: 'get_connection',
    id: 'connectionId',
  }),
  'oci_devops.triggers': attachment({
    parent: 'projectId',
    context: 'projectId',
    list: 'list_triggers',
    get: 'get_trigger',
    id: 'triggerId',
  }),
}
