import { workspaceKnowledgeSearchDataSchema } from '@/lib/api/contracts/knowledge/search'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import {
  type MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { FilePreviewSession } from '@/lib/mothership/request/session'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { searchResourceMatchesOwner } from '@/lib/mothership/resources/search'
import {
  chatResourceKeyFor,
  getChatResourceSelectionId,
  isFileResourceType,
  mergeChatResource,
} from '@/lib/mothership/resources/types'
import { notifyWorkflowExternalUpdate } from '@/lib/workflows/external-update'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
  hasRenderableFilePreviewContent,
  shouldReplaceSession,
} from '@/app/workspace/[workspaceId]/home/hooks/preview'
import { refreshSettings } from '@/app/workspace/[workspaceId]/home/hooks/stream/refresh-settings'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import {
  type MothershipChatHistory,
  mothershipChatKeys,
  refreshMothershipChatDetail,
} from '@/hooks/queries/mothership-chats'
import { invalidateProjectFileQueries } from '@/hooks/queries/projects'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { removeWorkflowFromActiveCache } from '@/hooks/queries/utils/workflow-cache'
import { useTableViewPinStore } from '@/stores/table/view-pin/store'

type ResourceEvent = Extract<
  PersistedStreamEventEnvelope,
  { type: typeof MothershipStreamV1EventType.resource }
>

/**
 * Applies a resource effect the server already wrote into the chat's stored
 * resources to both the tab strip and the cached chat detail. Mirroring it
 * keeps a later hydration from restoring the pre-effect list without reloading
 * the whole transcript; only a detail read already in flight, which may predate
 * the effect, is restarted.
 */
function applyResourceEffect(
  ctx: StreamLoopContext,
  update: (resources: MothershipResource[]) => MothershipResource[]
): void {
  const { queryClient, setResources, chatIdRef } = ctx.deps
  setResources(update)
  const chatId = chatIdRef.current
  if (!chatId) return
  const queryKey = mothershipChatKeys.detail(chatId)
  queryClient.setQueryData<MothershipChatHistory>(
    queryKey,
    (current) => current && { ...current, resources: update(current.resources) }
  )
  if (queryClient.isFetching({ queryKey, exact: true }) > 0) {
    // A read with no cached data yet would dedupe a refetch onto itself, so it
    // is cancelled first; `revert: false` keeps the effect written above.
    void queryClient
      .cancelQueries({ queryKey, exact: true }, { revert: false })
      .then(() => queryClient.refetchQueries({ queryKey, exact: true }))
  }
}

/**
 * Recovery reloads the current panel state from the stored chat instead of
 * repeating historical focus commands. A batch replay reloads once at its
 * terminal flush; a reconnected live tail coalesces its reloads.
 */
function refreshRecoveredChatResources(ctx: StreamLoopContext): void {
  const chatId = ctx.deps.chatIdRef.current
  if (!chatId) return
  if (ctx.deps.options.deferFlushes) ctx.state.deferredChatDetailRefreshes.add(chatId)
  else refreshMothershipChatDetail(ctx.deps.queryClient, chatId)
}

/**
 * Applies a streamed resource upsert/remove to the mothership resource list,
 * reconciling it with any in-flight or just-completed file-preview handoff so a
 * generated file is not activated out from under the user while its preview is
 * still streaming. Workflow resources are mirrored into the workflow registry.
 */
export function handleResourceEvent(ctx: StreamLoopContext, parsed: ResourceEvent): void {
  const {
    workspaceId: chatWorkspaceId,
    queryClient,
    addResource,
    removeResource,
    setResources,
    resourcesRef,
    previewSessionsRef,
    completedPreviewResourceHandoffRef,
    previewActivationOwnerRef,
    shouldAutoActivatePreviewSession,
    ensureWorkflowInRegistry,
    onResourceEventRef,
  } = ctx.deps
  const onResourceEvent = onResourceEventRef.current
  const payload = parsed.payload
  const keyOf = chatResourceKeyFor(chatWorkspaceId)
  if (payload.op === 'upsert' && payload.readOnly) return
  if (payload.resource.type === 'settings') {
    const settings = payload.resource
    if (
      settings.scope === 'organization' &&
      (!settings.organizationId || settings.organizationId !== ctx.deps.organizationId)
    )
      return
    if (
      settings.scope === 'workspace' &&
      (!settings.workspaceId || (chatWorkspaceId && settings.workspaceId !== chatWorkspaceId))
    )
      return
    refreshSettings(queryClient, settings)
    if (settings.scope !== 'account' || settings.id === 'profile') ctx.deps.refreshRoute?.()
    return
  }
  if (payload.resource.type === 'search') {
    if (payload.op === 'refresh' || payload.op === 'clear_view') return
    const search = payload.resource.search
    if (!search) return
    const validScope = searchResourceMatchesOwner(search, {
      organizationId: ctx.deps.organizationId,
      workspaceId: chatWorkspaceId,
    })
    if (!validScope) return
    const resource: MothershipResource = {
      ...payload.resource,
      type: 'search',
      title: payload.resource.title ?? 'Search results',
      search,
    }
    if (payload.op === 'remove') {
      setResources((current) => current.filter((item) => keyOf(item) !== keyOf(resource)))
      return
    }
    const scopeKey =
      search.scope.kind === 'workspace' ? search.scope.workspaceId : resourceScopeKey(search.scope)
    const queryKey = [
      ...knowledgeKeys.search(
        scopeKey,
        search.query,
        search.filters,
        search.topK,
        ctx.deps.viewerId,
        search.nativeQueries
      ),
      ctx.deps.citedSourcesEnabled ? 'live' : 'indexed',
    ]
    const preview =
      payload.op === 'upsert' &&
      !payload.replay &&
      !ctx.deps.options.deferFlushes &&
      Boolean(ctx.deps.viewerId) &&
      payload.searchResult?.actorUserId === ctx.deps.viewerId
        ? workspaceKnowledgeSearchDataSchema.safeParse(payload.searchResult?.data)
        : undefined
    if (preview?.success && preview.data.query === search.query) {
      void queryClient.cancelQueries({ queryKey, exact: true }, { revert: false })
      queryClient.setQueryData(queryKey, preview.data)
    } else {
      void queryClient.invalidateQueries({ queryKey })
    }
    if (ctx.deps.citedSourcesEnabled) {
      ctx.state.liveSearchResource = {
        type: 'search',
        id: resource.id,
        workspaceId: resource.workspaceId,
      }
    }
    if (payload.replay || ctx.deps.options.deferFlushes) {
      refreshRecoveredChatResources(ctx)
      return
    }
    if (ctx.deps.citedSourcesEnabled) return
    if (payload.effectId)
      setResources((current) => {
        const found = current.find((item) => keyOf(item) === keyOf(resource))
        return found
          ? current.map((item) => (item === found ? mergeChatResource(item, resource) : item))
          : [...current, resource]
      })
    else addResource(resource)
    onResourceEvent?.(getChatResourceSelectionId(resource))
    return
  }
  const owner = 'owner' in payload.resource ? payload.resource.owner : undefined
  if (owner?.entityType === 'project' && payload.resource.type === 'file' && payload.resource.id)
    invalidateProjectFileQueries(queryClient, owner.entityId, payload.resource.id)
  const workspaceId = payload.resource.workspaceId ?? chatWorkspaceId
  /** A Project file names no workspace, so an organization chat has none to check it against. */
  if (
    workspaceId
      ? chatWorkspaceId && workspaceId !== chatWorkspaceId
      : !(owner?.entityType === 'project' && isFileResourceType(payload.resource.type))
  )
    return
  // Browser and terminal tabs are projected from the desktop app's live
  // lists, never from the stream; older servers announced them as resources.
  if (payload.resource.type === 'browser' || payload.resource.type === 'terminal') return
  const resourceType = payload.resource.type
  if (workspaceId)
    invalidateResourceQueries(queryClient, workspaceId, resourceType, payload.resource.id)
  if (resourceType === 'workflow' && payload.op !== 'remove' && payload.resource.id) {
    notifyWorkflowExternalUpdate(payload.resource.id)
  }
  if (payload.op === 'refresh') return
  if (payload.op === 'remove' && payload.effectId) {
    // The server applied this removal before publishing it, so a client add
    // still queued for the resource must not restore it, live or on recovery.
    const { type, id, workspaceId: resourceWorkspaceId, owner } = payload.resource
    ctx.deps.discardPendingResourceUpsert({ type, id, workspaceId: resourceWorkspaceId, owner })
  }
  if (payload.replay || ctx.deps.options.deferFlushes) {
    refreshRecoveredChatResources(ctx)
    return
  }
  if (payload.op === 'clear_view') {
    const pinStore = useTableViewPinStore.getState()
    const pendingPin = pinStore.pins[payload.resource.id]
    if (pendingPin?.viewId === payload.resource.viewId) {
      pinStore.consume(payload.resource.id, pendingPin.seq)
    }
    const unpin = (current: MothershipResource[]) =>
      current.map((resource) => {
        if (
          (resource.workspaceId ?? chatWorkspaceId) !== workspaceId ||
          resource.type !== 'table' ||
          resource.id !== payload.resource.id ||
          resource.viewId !== payload.resource.viewId
        )
          return resource
        const { viewId: _view, ...unpinned } = resource
        return unpinned
      })
    if (payload.effectId) applyResourceEffect(ctx, unpin)
    else setResources(unpin)
    return
  }
  // A saved view the agent just created or edited: the table opens on it, and
  // an already-open table switches to it.
  const pinnedViewId =
    payload.resource.type === 'table' &&
    typeof payload.resource.viewId === 'string' &&
    payload.resource.viewId.trim()
      ? payload.resource.viewId
      : undefined
  const resource: MothershipResource = {
    ...payload.resource,
    ...(!chatWorkspaceId && workspaceId ? { workspaceId } : {}),
    type: payload.resource.type as MothershipResourceType,
    title:
      typeof payload.resource.title === 'string' ? payload.resource.title : payload.resource.id,
    ...(pinnedViewId ? { viewId: pinnedViewId } : {}),
  }
  const resourceUpdate = resource

  if (payload.op === MothershipStreamV1ResourceOp.remove) {
    const resourceType = resource.type
    if (payload.effectId) {
      applyResourceEffect(ctx, (current) =>
        current.filter((item) => keyOf(item) !== keyOf(resource))
      )
      ctx.deps.setActiveResourceId((current) =>
        current === getChatResourceSelectionId(resource) ? null : current
      )
    } else removeResource(resource)
    if (resourceType === 'workflow' && workspaceId) {
      removeWorkflowFromActiveCache(queryClient, workspaceId, resource.id)
    }
    return
  }

  const completedPreviewHandoff =
    resource.type === 'file'
      ? completedPreviewResourceHandoffRef.current?.get(resource.id)
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
    completedPreviewResourceHandoffRef.current?.delete(resource.id)
    previewActivationOwnerRef.current?.delete(completedPreviewHandoff.sessionId)
  }
  const shouldSuppressFileResourceActivation =
    (isCompletedPreviewHandoffCurrent && completedPreviewHandoff?.suppressActivation === true) ||
    (previewForResource !== undefined &&
      previewForResource.status !== 'complete' &&
      (!hasRenderableFilePreviewContent(previewForResource) ||
        !shouldAutoActivatePreviewSession(previewForResource)))
  const wasAdded =
    shouldSuppressFileResourceActivation || payload.effectId
      ? !resourcesRef.current.some((r) => keyOf(r) === keyOf(resource))
      : addResource(resourceUpdate)
  if (payload.effectId) {
    applyResourceEffect(ctx, (current) => {
      const previous = current.find((item) => keyOf(item) === keyOf(resource))
      const next = {
        ...previous,
        ...resource,
        title: payload.resource.title || previous?.title || resource.title,
      }
      return previous
        ? current.map((item) => (item === previous ? next : item))
        : [...current, next]
    })
  } else if (shouldSuppressFileResourceActivation && wasAdded) {
    setResources((current) =>
      current.some((r) => keyOf(r) === keyOf(resource)) ? current : [...current, resource]
    )
  }
  if (completedPreviewHandoff && isCompletedPreviewHandoffCurrent) {
    completedPreviewResourceHandoffRef.current?.delete(resource.id)
    previewActivationOwnerRef.current?.delete(completedPreviewHandoff.sessionId)
  }
  if (pinnedViewId) {
    // Carry the newest pin on an existing tab so a remount adopts it. Not gated
    // on `wasAdded`: two upserts in one render both read the stale ref and both
    // report "added", while only the first updater actually inserted — the
    // updater is idempotent, so it simply runs every time.
    setResources((current) =>
      current.some((r) => keyOf(r) === keyOf(resource) && r.viewId !== pinnedViewId)
        ? current.map((r) => (keyOf(r) === keyOf(resource) ? { ...r, viewId: pinnedViewId } : r))
        : current
    )
    // Consumed by the embedded table once its views list carries the view —
    // which may be after the refetch below lands, or after the tab first opens.
    useTableViewPinStore.getState().pin(resource.id, pinnedViewId)
  }

  if (!shouldSuppressFileResourceActivation) {
    if (resource.type === 'table' && resource.viewId) {
      onResourceEvent?.(getChatResourceSelectionId(resource), { tableViewId: resource.viewId })
    } else onResourceEvent?.(getChatResourceSelectionId(resource))
  }

  if (resource.type === 'workflow' && workspaceId) {
    ensureWorkflowInRegistry(resource.id, resource.title, workspaceId)
  }
}
