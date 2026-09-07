import { OciClientError } from '@/lib/internal/oci/errors'
import { prepareDocumentClient } from '@/lib/internal/oci-document-understanding/client'
import { executeDocumentOperation } from '@/lib/internal/oci-document-understanding/operations'
import { documentInputSchema } from '@/lib/internal/oci-document-understanding/schema'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

async function prepareDestination(args: ExecuteServerSelectorArgs) {
  const credential = args.credential
  const credentialId = credential?.access?.resolvedCredentialId
  if (
    !credentialId ||
    credential.access?.credentialType !== 'service_account' ||
    credential.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  )
    throw new SelectorConnectionUnavailableError()
  args.signal?.throwIfAborted()
  try {
    return {
      credentialId,
      prepared: await prepareDocumentClient(
        { credentialId, region: args.context.region || undefined },
        args.workspaceId
      ),
    }
  } catch {
    args.signal?.throwIfAborted()
    throw new SelectorConnectionUnavailableError()
  }
}

async function executeSelector(
  args: ExecuteServerSelectorArgs,
  destination: Awaited<ReturnType<typeof prepareDestination>>
) {
  if (args.request.kind !== 'list') throw new SelectorOptionsUnavailableError()
  const artifacts = args.selectorKey === 'oci_document_understanding.artifacts'
  const models = args.selectorKey === 'oci_document_understanding.models'
  const operation = artifacts ? 'list_job_outputs' : models ? 'list_models' : 'list_projects'
  const parsed = documentInputSchema.safeParse({
    operation,
    credentialId: destination.credentialId,
    region: args.context.region || undefined,
    limit: 100,
    ...(artifacts
      ? { jobId: args.context.jobId, start: args.request.cursor }
      : {
          compartmentId: args.context.compartmentId,
          page: args.request.cursor,
          ...(models
            ? { projectId: args.context.projectId || undefined, lifecycleState: 'ACTIVE' }
            : {}),
        }),
  })
  if (!parsed.success) throw new SelectorContextUnavailableError()
  try {
    const result = await executeDocumentOperation(
      parsed.data,
      {
        toolId: `oci_document_understanding_${operation}`,
        headers: new Headers(),
        requestId: 'oci-document-selector',
        signal: args.signal,
        context: {
          workspaceId: args.workspaceId,
          workflowId: args.scope.kind === 'workflow' ? args.scope.workflowId : '',
        },
      },
      destination.prepared
    )
    const options: SafeSelectorOption[] = []
    if (artifacts) {
      for (const object of result.output.objects ?? [])
        options.push({
          id: object.name,
          label: object.name,
          ...(object.size === undefined ? {} : { meta: { size: object.size } }),
        })
    } else {
      for (const value of (models ? result.output.models : result.output.projects) ?? []) {
        if (models && args.context.modelType && value.modelType !== args.context.modelType) continue
        options.push({
          id: value.id,
          label: value.displayName || value.id,
          ...(models && value.modelType ? { meta: { modelType: value.modelType } } : {}),
        })
      }
    }
    return listSelectorResult(
      options,
      (artifacts ? result.output.nextStartWith : result.output.nextPage) ?? undefined
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OciClientError) throw selectorProviderStatusError(error.status ?? 502)
    throw new SelectorOptionsUnavailableError()
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oci_document_understanding'],
} as const
const integrationBlockTypes = ['oci_document_understanding'] as const

export const ociDocumentSelectorAttachments = {
  'oci_document_understanding.projects': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  }),
  'oci_document_understanding.models': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  }),
  'oci_document_understanding.artifacts': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  }),
} satisfies Partial<ServerSelectorAttachmentMap>
