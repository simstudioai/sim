import { z } from 'zod'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  discoveryResponseSchema,
  jobResponseSchema,
  parseResponse,
  prepareOciResourceManagerClient,
  providerResponseSchema,
  requestResourceManager,
  resourcePath,
  responseJson,
  stackResponseSchema,
  templateResponseSchema,
  versionResponseSchema,
} from '@/lib/internal/oci-resource-manager/client'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

const jobOperations: Record<string, string> = {
  'plan-jobs': 'PLAN',
  'rollback-plan-jobs': 'PLAN_ROLLBACK',
  'successful-apply-jobs': 'APPLY',
}
function requiredId(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 255 ||
    value === '.' ||
    value === '..'
  )
    throw new SelectorContextUnavailableError()
  return value.trim()
}
async function prepare(args: ExecuteServerSelectorArgs) {
  const access = args.credential?.access
  if (
    !access?.ok ||
    !access.resolvedCredentialId ||
    access.credentialType !== 'service_account' ||
    access.workspaceId !== args.workspaceId ||
    args.credential?.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  )
    throw new SelectorConnectionUnavailableError()
  try {
    return await prepareOciResourceManagerClient({
      credentialId: access.resolvedCredentialId,
      workspaceId: args.workspaceId,
      region: args.context.ociRegion === 'credential' ? undefined : args.context.ociRegion,
    })
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}
function option(row: Record<string, unknown>): SafeSelectorOption {
  const id = requiredId(row.id ?? row.name)
  return {
    id,
    label: typeof row.displayName === 'string' && row.displayName ? row.displayName : id,
    meta: { lifecycleState: typeof row.lifecycleState === 'string' ? row.lifecycleState : null },
  }
}
function attachment() {
  return definePreparedSelectorAttachment({
    credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['oci-resource-manager'] },
    integrationBlockTypes: ['oci_resource_manager'],
    destination: { kind: 'credential-bound', prepare },
    execute: async (args, prepared) => {
      const kind = args.selectorKey.slice('oci-resource-manager.'.length)
      const jobs = kind === 'jobs' || Object.hasOwn(jobOperations, kind)
      const stacks = kind === 'stacks'
      const requiredOperation = jobOperations[kind]
      const scope = jobs
        ? requiredId(args.context.stackId)
        : stacks || kind === 'configuration-source-providers'
          ? requiredId(args.context.compartmentId)
          : args.context.compartmentId
      const paths: Record<string, string> = {
        'terraform-versions': 'terraformVersions',
        'configuration-source-providers': 'configurationSourceProviders',
        templates: 'templates',
        'resource-discovery-services': 'resourceDiscoveryServices',
      }
      const schemas: Record<string, z.ZodType> = {
        'terraform-versions': versionResponseSchema,
        'configuration-source-providers': providerResponseSchema,
        templates: templateResponseSchema,
        'resource-discovery-services': discoveryResponseSchema,
      }
      const matches = (row: Record<string, unknown>) =>
        (!jobs || row.stackId === scope) &&
        (!stacks || row.compartmentId === scope) &&
        (!requiredOperation ||
          (row.operation === requiredOperation && row.lifecycleState === 'SUCCEEDED'))
      try {
        if (args.request.kind === 'detail') {
          if (!jobs && !stacks) return detailSelectorResult(null)
          const response = await requestResourceManager(
            prepared,
            {
              method: 'GET',
              path: resourcePath(jobs ? 'jobs' : 'stacks', requiredId(args.request.id)),
            },
            args.signal
          )
          const row = jobs
            ? parseResponse(jobResponseSchema, responseJson(response))
            : parseResponse(stackResponseSchema, responseJson(response))
          return detailSelectorResult(matches(row) ? option(row) : null)
        }
        const paginated = kind !== 'terraform-versions' && kind !== 'resource-discovery-services'
        const query: [string, string][] = []
        if (scope) query.push([jobs ? 'stackId' : 'compartmentId', scope])
        if (paginated) query.push(['limit', '50'])
        if (requiredOperation) query.push(['lifecycleState', 'SUCCEEDED'])
        if (args.request.cursor && paginated) {
          if (args.request.cursor.length > 512) throw new SelectorContextUnavailableError()
          query.push(['page', args.request.cursor])
        }
        const response = await requestResourceManager(
          prepared,
          {
            method: 'GET',
            path:
              jobs || stacks ? resourcePath(jobs ? 'jobs' : 'stacks') : `/20180917/${paths[kind]}`,
            query,
          },
          args.signal
        )
        const schema = jobs ? jobResponseSchema : stacks ? stackResponseSchema : schemas[kind]
        const raw = responseJson(response)
        const rows =
          jobs || stacks
            ? parseResponse(z.array(schema).max(1000), raw)
            : parseResponse(z.object({ items: z.array(schema).max(1000) }), raw).items
        return listSelectorResult(
          (rows as Record<string, unknown>[]).filter(matches).map(option),
          paginated ? response.headers['opc-next-page'] : undefined
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (error instanceof OciClientError) {
          if (args.request.kind === 'detail' && error.status === 404)
            return detailSelectorResult(null)
          throw selectorProviderStatusError(error.status ?? 502)
        }
        if (error instanceof SelectorContextUnavailableError) throw error
        throw new SelectorOptionsUnavailableError()
      }
    },
  })
}
export const ociResourceManagerSelectorAttachments = {
  'oci-resource-manager.stacks': attachment(),
  'oci-resource-manager.jobs': attachment(),
  'oci-resource-manager.plan-jobs': attachment(),
  'oci-resource-manager.rollback-plan-jobs': attachment(),
  'oci-resource-manager.successful-apply-jobs': attachment(),
  'oci-resource-manager.terraform-versions': attachment(),
  'oci-resource-manager.configuration-source-providers': attachment(),
  'oci-resource-manager.templates': attachment(),
  'oci-resource-manager.resource-discovery-services': attachment(),
}
