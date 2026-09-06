import { OciClientError } from '@/lib/internal/oci/errors'
import {
  executeOciVisionOperation,
  prepareOciVisionClient,
} from '@/lib/internal/oci-vision/operations'
import { ociVisionInputSchema } from '@/lib/internal/oci-vision/schema'
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
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import type { VisionModel, VisionProject } from '@/tools/oci_vision/types'

type VisionSelectorKey =
  | 'oci_vision.projects'
  | 'oci_vision.classification_models'
  | 'oci_vision.object_detection_models'

async function prepareDestination(args: ExecuteServerSelectorArgs) {
  const credential = args.credential
  const credentialId = credential?.access?.resolvedCredentialId
  if (
    !credentialId ||
    !credential.access?.ok ||
    credential.access.credentialType !== 'service_account' ||
    credential.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  args.signal?.throwIfAborted()
  try {
    const prepared = await prepareOciVisionClient(
      { credentialId, region: args.context.region || undefined },
      args.workspaceId
    )
    args.signal?.throwIfAborted()
    return { credentialId, prepared }
  } catch {
    args.signal?.throwIfAborted()
    throw new SelectorConnectionUnavailableError()
  }
}

async function executeVisionSelector(
  args: ExecuteServerSelectorArgs,
  destination: Awaited<ReturnType<typeof prepareDestination>>
) {
  const projects = args.selectorKey === 'oci_vision.projects'
  const modelType =
    args.selectorKey === 'oci_vision.classification_models'
      ? 'IMAGE_CLASSIFICATION'
      : 'OBJECT_DETECTION'
  const detail = args.request.kind === 'detail'
  const parsed = ociVisionInputSchema.safeParse({
    credentialId: destination.credentialId,
    operation: projects
      ? detail
        ? 'get_project'
        : 'list_projects'
      : detail
        ? 'get_model'
        : 'list_models',
    region: args.context.region || undefined,
    compartmentId: args.context.compartmentId,
    projectId:
      projects && args.request.kind === 'detail'
        ? args.request.id
        : args.context.projectId || undefined,
    modelId: !projects && args.request.kind === 'detail' ? args.request.id : undefined,
    page: args.request.kind === 'list' ? args.request.cursor : undefined,
    limit: 100,
    lifecycleState: 'ACTIVE',
  })
  if (!parsed.success || !args.context.compartmentId) throw new SelectorContextUnavailableError()
  const toOption = (item: VisionProject | VisionModel): SafeSelectorOption | null => {
    if (item.compartmentId !== args.context.compartmentId || item.lifecycleState !== 'ACTIVE')
      return null
    if (
      !projects &&
      (!('modelType' in item) ||
        item.modelType !== modelType ||
        (args.context.projectId && item.projectId !== args.context.projectId))
    )
      return null
    if (!item.id || item.id.length > 255 || (item.displayName?.length ?? 0) > 255)
      throw new SelectorOptionsUnavailableError()
    return { id: item.id, label: item.displayName || item.id }
  }
  try {
    const result = await executeOciVisionOperation(
      parsed.data,
      {
        workspaceId: args.workspaceId,
        workflowId: '',
        requestId: 'oci-vision-selector',
        headers: new Headers(),
        signal: args.signal,
      },
      destination.prepared
    )
    const output = result.output
    if (args.request.kind === 'detail') {
      const item = 'project' in output ? output.project : 'model' in output ? output.model : null
      if (!item || item.id !== args.request.id) return detailSelectorResult(null)
      return detailSelectorResult(toOption(item))
    }
    const items = 'projects' in output ? output.projects : 'models' in output ? output.models : null
    if (!items || items.length > 100 || !('nextPage' in output))
      throw new SelectorOptionsUnavailableError()
    const options = new Map<string, SafeSelectorOption>()
    for (const item of items) {
      const option = toOption(item)
      if (option) options.set(option.id, option)
    }
    return listSelectorResult([...options.values()], output.nextPage ?? undefined)
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OciClientError) throw selectorProviderStatusError(error.status ?? 502)
    throw new SelectorOptionsUnavailableError()
  }
}

const attachment = {
  credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['oci_vision'] },
  integrationBlockTypes: ['oci_vision'],
  destination: { kind: 'credential-bound', prepare: prepareDestination },
  execute: executeVisionSelector,
} as const

export const ociVisionSelectorAttachments = {
  'oci_vision.projects': definePreparedSelectorAttachment(attachment),
  'oci_vision.classification_models': definePreparedSelectorAttachment(attachment),
  'oci_vision.object_detection_models': definePreparedSelectorAttachment(attachment),
} satisfies ServerSelectorAttachmentMap<VisionSelectorKey>
