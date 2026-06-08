import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  MothershipStreamV1ResourceOp,
  type MothershipStreamV1ResourceRemovePayload,
  type MothershipStreamV1ResourceUpsertPayload,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
  hasRenderableFilePreviewContent,
  shouldReplaceSession,
} from '@/app/workspace/[workspaceId]/home/hooks/preview'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

type ResourceEventPayload =
  | MothershipStreamV1ResourceUpsertPayload
  | MothershipStreamV1ResourceRemovePayload

export interface ResourceEventContext {
  workspaceId: string
  queryClient: QueryClient
  addResource: (resource: MothershipResource) => boolean
  removeResource: (resourceType: MothershipResourceType, resourceId: string) => void
  setResources: Dispatch<SetStateAction<MothershipResource[]>>
  setActiveResourceId: Dispatch<SetStateAction<string | null>>
  resourcesRef: MutableRefObject<MothershipResource[]>
  activeResourceIdRef: MutableRefObject<string | null>
  previewSessionsRef: MutableRefObject<Record<string, FilePreviewSession>>
  completedPreviewResourceHandoffRef: MutableRefObject<
    Map<string, { sessionId: string; suppressActivation: boolean }>
  >
  previewActivationOwnerRef: MutableRefObject<Map<string, string | null>>
  shouldAutoActivatePreviewSession: (session: FilePreviewSession) => boolean
  ensureWorkflowInRegistry: (resourceId: string, title: string, workspaceId: string) => boolean
  onResourceEvent?: () => void
}

/**
 * Applies a streamed resource upsert/remove to the mothership resource list,
 * reconciling it with any in-flight or just-completed file-preview handoff so a
 * generated file is not activated out from under the user while its preview is
 * still streaming. Workflow resources are mirrored into the workflow registry.
 */
export function handleResourceEvent(
  ctx: ResourceEventContext,
  payload: ResourceEventPayload
): void {
  const {
    workspaceId,
    queryClient,
    addResource,
    removeResource,
    setResources,
    setActiveResourceId,
    resourcesRef,
    activeResourceIdRef,
    previewSessionsRef,
    completedPreviewResourceHandoffRef,
    previewActivationOwnerRef,
    shouldAutoActivatePreviewSession,
    ensureWorkflowInRegistry,
    onResourceEvent,
  } = ctx
  const resource = payload.resource

  if (payload.op === MothershipStreamV1ResourceOp.remove) {
    removeResource(resource.type as MothershipResourceType, resource.id)
    invalidateResourceQueries(
      queryClient,
      workspaceId,
      resource.type as MothershipResourceType,
      resource.id
    )
    onResourceEvent?.()
    return
  }

  const nextResource = {
    type: resource.type as MothershipResourceType,
    id: resource.id,
    title: typeof resource.title === 'string' ? resource.title : resource.id,
  }
  const completedPreviewHandoff =
    nextResource.type === 'file'
      ? completedPreviewResourceHandoffRef.current.get(nextResource.id)
      : undefined
  const matchingPreviewSessions =
    nextResource.type === 'file'
      ? Object.values(previewSessionsRef.current).filter(
          (session) => session.fileId === nextResource.id
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
    completedPreviewResourceHandoffRef.current.delete(nextResource.id)
    previewActivationOwnerRef.current.delete(completedPreviewHandoff.sessionId)
  }
  const shouldSuppressFileResourceActivation =
    (isCompletedPreviewHandoffCurrent && completedPreviewHandoff?.suppressActivation === true) ||
    (previewForResource !== undefined &&
      previewForResource.status !== 'complete' &&
      (!hasRenderableFilePreviewContent(previewForResource) ||
        !shouldAutoActivatePreviewSession(previewForResource)))
  const wasAdded = shouldSuppressFileResourceActivation
    ? !resourcesRef.current.some((r) => r.type === nextResource.type && r.id === nextResource.id)
    : addResource(nextResource)
  if (shouldSuppressFileResourceActivation && wasAdded) {
    setResources((current) =>
      current.some((r) => r.type === nextResource.type && r.id === nextResource.id)
        ? current
        : [...current, nextResource]
    )
  }
  if (completedPreviewHandoff && isCompletedPreviewHandoffCurrent) {
    completedPreviewResourceHandoffRef.current.delete(nextResource.id)
    previewActivationOwnerRef.current.delete(completedPreviewHandoff.sessionId)
  }
  invalidateResourceQueries(queryClient, workspaceId, nextResource.type, nextResource.id)

  if (
    !shouldSuppressFileResourceActivation &&
    !wasAdded &&
    activeResourceIdRef.current !== nextResource.id
  ) {
    setActiveResourceId(nextResource.id)
  }
  onResourceEvent?.()

  if (nextResource.type === 'workflow') {
    const wasRegistered = ensureWorkflowInRegistry(nextResource.id, nextResource.title, workspaceId)
    if (wasAdded && wasRegistered) {
      useWorkflowRegistry.getState().setActiveWorkflow(nextResource.id)
    } else {
      useWorkflowRegistry.getState().loadWorkflowState(nextResource.id)
    }
  }
}
