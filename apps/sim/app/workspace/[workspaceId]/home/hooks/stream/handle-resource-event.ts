import {
  type MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { FilePreviewSession } from '@/lib/mothership/request/session'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { canonicalizeDesktopSessionResource } from '@/lib/mothership/resources/types'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
  hasRenderableFilePreviewContent,
  shouldReplaceSession,
} from '@/app/workspace/[workspaceId]/home/hooks/preview'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'
import { removeWorkflowFromActiveCache } from '@/hooks/queries/utils/workflow-cache'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

type ResourceEvent = Extract<
  PersistedStreamEventEnvelope,
  { type: typeof MothershipStreamV1EventType.resource }
>

/**
 * Applies a streamed resource upsert/remove to the mothership resource list,
 * reconciling it with any in-flight or just-completed file-preview handoff so a
 * generated file is not activated out from under the user while its preview is
 * still streaming. Workflow resources are mirrored into the workflow registry.
 */
export function handleResourceEvent(ctx: StreamLoopContext, parsed: ResourceEvent): void {
  const {
    workspaceId,
    queryClient,
    addResource,
    removeResource,
    setResources,
    resourcesRef,
    activeResourceIdRef,
    previewSessionsRef,
    completedPreviewResourceHandoffRef,
    previewActivationOwnerRef,
    shouldAutoActivatePreviewSession,
    ensureWorkflowInRegistry,
    onResourceEventRef,
  } = ctx.deps
  const onResourceEvent = onResourceEventRef.current
  const payload = parsed.payload
  const resource = canonicalizeDesktopSessionResource({
    type: payload.resource.type as MothershipResourceType,
    id: payload.resource.id,
    title:
      typeof payload.resource.title === 'string' ? payload.resource.title : payload.resource.id,
  })

  if (payload.op === MothershipStreamV1ResourceOp.remove) {
    const resourceType = resource.type
    removeResource(resourceType, resource.id)
    if (resourceType === 'workflow') {
      removeWorkflowFromActiveCache(queryClient, workspaceId, resource.id)
    }
    invalidateResourceQueries(queryClient, workspaceId, resourceType, resource.id)
    return
  }

  const completedPreviewHandoff =
    resource.type === 'file'
      ? completedPreviewResourceHandoffRef.current.get(resource.id)
      : undefined
  const matchingPreviewSessions =
    resource.type === 'file'
      ? Object.values(previewSessionsRef.current).filter(
          (session) => session.fileId === resource.id
        )
      : []
  const latestPreviewForResource = (
    sessions: FilePreviewSession[]
  ): FilePreviewSession | undefined =>
    sessions.reduce<FilePreviewSession | undefined>(
      (latest, session) => (shouldReplaceSession(latest, session) ? session : latest),
      undefined
    )
  const latestActivePreviewForResource = latestPreviewForResource(
    matchingPreviewSessions.filter((session) => session.status !== 'complete')
  )
  const previewForResource =
    latestActivePreviewForResource ?? latestPreviewForResource(matchingPreviewSessions)
  const isCompletedPreviewHandoffCurrent =
    completedPreviewHandoff !== undefined &&
    (!latestActivePreviewForResource ||
      latestActivePreviewForResource.id === completedPreviewHandoff.sessionId)
  if (completedPreviewHandoff && !isCompletedPreviewHandoffCurrent) {
    completedPreviewResourceHandoffRef.current.delete(resource.id)
    previewActivationOwnerRef.current.delete(completedPreviewHandoff.sessionId)
  }
  const shouldSuppressFileResourceActivation =
    (isCompletedPreviewHandoffCurrent && completedPreviewHandoff?.suppressActivation === true) ||
    (previewForResource !== undefined &&
      previewForResource.status !== 'complete' &&
      (!hasRenderableFilePreviewContent(previewForResource) ||
        !shouldAutoActivatePreviewSession(previewForResource)))
  const wasAdded = shouldSuppressFileResourceActivation
    ? !resourcesRef.current.some((r) => r.type === resource.type && r.id === resource.id)
    : addResource(resource)
  if (shouldSuppressFileResourceActivation && wasAdded) {
    setResources((current) =>
      current.some((r) => r.type === resource.type && r.id === resource.id)
        ? current
        : [...current, resource]
    )
  }
  if (completedPreviewHandoff && isCompletedPreviewHandoffCurrent) {
    completedPreviewResourceHandoffRef.current.delete(resource.id)
    previewActivationOwnerRef.current.delete(completedPreviewHandoff.sessionId)
  }
  invalidateResourceQueries(queryClient, workspaceId, resource.type, resource.id)

  if (!shouldSuppressFileResourceActivation) onResourceEvent?.(resource.id)

  if (resource.type === 'workflow') {
    const wasRegistered = ensureWorkflowInRegistry(resource.id, resource.title, workspaceId)
    if (wasAdded && wasRegistered) {
      useWorkflowRegistry.getState().setActiveWorkflow(resource.id)
    } else {
      useWorkflowRegistry.getState().loadWorkflowState(resource.id)
    }
  }
}
