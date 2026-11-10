'use client'

import {
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQueryState } from 'nuqs'
import {
  resolveResourceEventPresentation,
  resolveResourceSelectionUpdate,
} from '@/components/mothership-chat/resource-view-policy'
import { resourceParam, resourceUrlKeys } from '@/lib/mothership/chat/search-params'
import {
  getChatResourceSelectionId,
  type MothershipResource,
} from '@/lib/mothership/resources/types'
import {
  type ResourceEventOptions,
  shouldActivateResourceEvent,
  type useChat,
} from '@/hooks/mothership-chat/use-chat'
import { useMothershipResize } from '@/hooks/mothership-chat/use-mothership-resize'
import { useIsMobile } from '@/hooks/use-is-mobile'

/** URL selection and event attention are installed before the chat starts streaming. */
export function useResourcePanelController() {
  const isCompactLayout = useIsMobile()
  /**
   * URL is the single source of truth for the selected resource. `Home` renders
   * client-side, so nuqs reads `?resource=` from the URL on mount — the same
   * value the page previously threaded through `initialResourceId` — and writes
   * it back with `history: 'replace'`, the previous behavior, minus the banned
   * `window.history.replaceState` param-mutation effect. The page wraps `Home`
   * in Suspense for the `useSearchParams` requirement.
   */
  const [activeResourceParam, setResourceParam] = useQueryState(resourceParam.key, {
    ...resourceParam.parser,
    ...resourceUrlKeys,
  })
  const activeResourceParamRef = useRef(activeResourceParam)
  activeResourceParamRef.current = activeResourceParam
  /**
   * Strips any leftover URL fragment on selection change, preserving the old
   * effect's `url.hash = ''` (the only hash usage on this surface) without a
   * separate effect-sync mirror. This rewrites the fragment only — it never
   * mutates a query param via the History API.
   *
   * Order matters: the fragment is stripped synchronously BEFORE the nuqs write,
   * because nuqs re-appends `location.hash` on its (deferred) flush — clearing the
   * hash first ensures the param write doesn't carry the stale fragment back.
   */
  const setActiveResourceUrl = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) => {
      const nextResourceId = resolveResourceSelectionUpdate(activeResourceParamRef.current, action)
      activeResourceParamRef.current = nextResourceId
      if (typeof window !== 'undefined' && window.location.hash) {
        const { pathname, search } = window.location
        window.history.replaceState(window.history.state, '', `${pathname}${search}`)
      }
      void setResourceParam(nextResourceId)
    },
    [setResourceParam]
  )
  /**
   * Controlled binding handed to `useChat` so the URL is the sole owner of the
   * selection with no dual source.
   */
  const activeResourceState = useMemo<[string | null, Dispatch<SetStateAction<string | null>>]>(
    () => [activeResourceParam, setActiveResourceUrl],
    [activeResourceParam, setActiveResourceUrl]
  )
  const effectiveActiveResourceIdRef = useRef<string | null>(null)
  const [isResourceCollapsed, setIsResourceCollapsedState] = useState(true)
  const [skipResourceTransition, setSkipResourceTransition] = useState(false)
  const [resourceActivityIds, setResourceActivityIds] = useState<Set<string>>(new Set())
  const isResourceCollapsedRef = useRef(isResourceCollapsed)
  const setResourceCollapsed = useCallback((collapsed: boolean) => {
    isResourceCollapsedRef.current = collapsed
    setIsResourceCollapsedState(collapsed)
  }, [])
  const [resourceCollapseOwnedByUser, setResourceCollapseOwnedByUser] = useState(false)
  const resourceSelectionOwnedByUserRef = useRef(false)
  /** Bound by `useChatResourcePanel` in the same render, once the panel's resize hook exists. */
  const panelFitsBesideChatRef = useRef<() => boolean>(() => false)

  function handleResourceEvent(resourceId: string, options?: ResourceEventOptions) {
    const activeResourceId = effectiveActiveResourceIdRef.current
    const presentation = resolveResourceEventPresentation({
      activeResourceId,
      activationRequested: shouldActivateResourceEvent(activeResourceId, resourceId, options),
      panelCollapseOwnedByUser: resourceCollapseOwnedByUser,
      panelCollapsed: isResourceCollapsedRef.current,
      resourceId,
      selectionOwnedByUser: resourceSelectionOwnedByUserRef.current,
    })

    const keepChatVisible = isResourceCollapsedRef.current && !panelFitsBesideChatRef.current()
    if (presentation.revealPanel && !keepChatVisible) setResourceCollapsed(false)
    if (presentation.markActivity || keepChatVisible) {
      setResourceActivityIds((current) => new Set(current).add(resourceId))
      if (presentation.markActivity) return
    } else {
      setResourceActivityIds((current) => {
        if (!current.has(resourceId)) return current
        const next = new Set(current)
        next.delete(resourceId)
        return next
      })
    }
    if (presentation.activateResource && activeResourceId !== resourceId) {
      activeResourceParamRef.current = resourceId
      setActiveResourceUrl(resourceId)
    }
  }

  return {
    isCompactLayout,
    activeResourceParam,
    activeResourceParamRef,
    activeResourceState,
    setActiveResourceUrl,
    isResourceCollapsed,
    setResourceCollapsed,
    skipResourceTransition,
    setSkipResourceTransition,
    resourceActivityIds,
    setResourceActivityIds,
    isResourceCollapsedRef,
    resourceCollapseOwnedByUser,
    setResourceCollapseOwnedByUser,
    resourceSelectionOwnedByUserRef,
    effectiveActiveResourceIdRef,
    panelFitsBesideChatRef,
    onResourceEvent: handleResourceEvent,
  }
}

/** Binds panel interactions to this chat without duplicating its resource state. */
export function useChatResourcePanel(
  chat: Pick<
    ReturnType<typeof useChat>,
    | 'desktopScopeId'
    | 'activeResourceId'
    | 'resolvedChatId'
    | 'resources'
    | 'addResource'
    | 'removeResource'
    | 'setActiveResourceId'
  >,
  controller: ReturnType<typeof useResourcePanelController>,
  userId?: string
) {
  const {
    desktopScopeId,
    activeResourceId,
    resolvedChatId,
    resources,
    addResource,
    removeResource,
    setActiveResourceId,
  } = chat
  const {
    isCompactLayout,
    activeResourceParam,
    activeResourceParamRef,
    isResourceCollapsed,
    setResourceCollapsed,
    setSkipResourceTransition,
    setResourceActivityIds,
    isResourceCollapsedRef,
    resourceCollapseOwnedByUser,
    setResourceCollapseOwnedByUser,
    resourceSelectionOwnedByUserRef,
    effectiveActiveResourceIdRef,
    panelFitsBesideChatRef,
    onResourceEvent: handleResourceEvent,
  } = controller
  const {
    mothershipRef,
    panelFitsBesideChat,
    handleResizePointerDown,
    handleResizeKeyDown,
    handleResizeFocus,
  } = useMothershipResize(desktopScopeId, { userId, collapsed: isResourceCollapsed })
  effectiveActiveResourceIdRef.current = activeResourceId
  panelFitsBesideChatRef.current = panelFitsBesideChat
  const resourceAttentionChatIdRef = useRef(resolvedChatId)

  const collapseResource = useCallback(() => {
    setResourceCollapseOwnedByUser(true)
    resourceSelectionOwnedByUserRef.current = true
    setResourceCollapsed(true)
  }, [setResourceCollapsed, setResourceCollapseOwnedByUser])

  const clearResourceActivity = useCallback((resourceId: string) => {
    setResourceActivityIds((current) => {
      if (!current.has(resourceId)) return current
      const next = new Set(current)
      next.delete(resourceId)
      return next
    })
  }, [])

  const expandResource = () => {
    setResourceCollapseOwnedByUser(false)
    resourceSelectionOwnedByUserRef.current = true
    const activeResourceId = effectiveActiveResourceIdRef.current
    if (activeResourceId) clearResourceActivity(activeResourceId)
    setResourceCollapsed(false)
  }

  const selectResourceFromUser = useCallback(
    (resourceId: string) => {
      resourceSelectionOwnedByUserRef.current = true
      clearResourceActivity(resourceId)
      if (effectiveActiveResourceIdRef.current === resourceId) return
      effectiveActiveResourceIdRef.current = resourceId
      activeResourceParamRef.current = resourceId
      setActiveResourceId(resourceId)
    },
    [setActiveResourceId, clearResourceActivity]
  )

  const desktopTabResourceOptions = {
    scopeId: desktopScopeId,
    resources,
    activeResourceId,
    selectedResourceId: activeResourceParam,
    addResource,
    removeResource,
    selectResource: selectResourceFromUser,
    onResourceEvent: handleResourceEvent,
  }

  const addResourceFromUser = useCallback(
    (resource: MothershipResource) => {
      setResourceCollapseOwnedByUser(false)
      resourceSelectionOwnedByUserRef.current = true
      addResource(resource)
      selectResourceFromUser(getChatResourceSelectionId(resource))
      setResourceCollapsed(false)
    },
    [addResource, selectResourceFromUser, setResourceCollapsed, setResourceCollapseOwnedByUser]
  )

  const handleResourceResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      resourceSelectionOwnedByUserRef.current = true
      handleResizePointerDown(event)
    },
    [handleResizePointerDown]
  )

  const handleResourceResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      handleResizeKeyDown(event)
      if (event.defaultPrevented) resourceSelectionOwnedByUserRef.current = true
    },
    [handleResizeKeyDown]
  )

  const handleResourceInteraction = useCallback(() => {
    resourceSelectionOwnedByUserRef.current = true
  }, [])

  const prepareResourceViewForAgentTurn = useCallback(() => {
    resourceSelectionOwnedByUserRef.current = false
    setResourceActivityIds(new Set())
  }, [])

  useEffect(() => {
    const previousChatId = resourceAttentionChatIdRef.current
    resourceAttentionChatIdRef.current = resolvedChatId
    if (!resolvedChatId) {
      setResourceCollapsed(true)
    }
    if (!resolvedChatId || (previousChatId && previousChatId !== resolvedChatId)) {
      setResourceCollapseOwnedByUser(false)
      resourceSelectionOwnedByUserRef.current = false
      setResourceActivityIds(new Set())
    }
  }, [resolvedChatId, setResourceCollapsed, setResourceCollapseOwnedByUser])

  useEffect(() => {
    if (
      !(resources.length > 0 && isResourceCollapsedRef.current) ||
      resourceCollapseOwnedByUser ||
      !panelFitsBesideChat()
    ) {
      return
    }
    setResourceCollapsed(false)
    setSkipResourceTransition(true)
    const id = requestAnimationFrame(() => setSkipResourceTransition(false))
    return () => cancelAnimationFrame(id)
  }, [resources, resourceCollapseOwnedByUser, panelFitsBesideChat, setResourceCollapsed])

  useEffect(() => {
    if (resources.length === 0 && !isResourceCollapsedRef.current) {
      setResourceCollapsed(true)
    }
  }, [resources, setResourceCollapsed])

  useEffect(() => {
    const resourceIds = new Set(resources.map(getChatResourceSelectionId))
    setResourceActivityIds((current) => {
      const next = new Set([...current].filter((id) => resourceIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [resources])

  return {
    ...controller,
    initialScrollBlocked:
      resources.length > 0 &&
      !resourceCollapseOwnedByUser &&
      !isCompactLayout &&
      isResourceCollapsed,
    desktopTabResourceOptions,
    mothershipRef,
    collapseResource,
    expandResource,
    selectResourceFromUser,
    addResourceFromUser,
    handleResourceResizePointerDown,
    handleResourceResizeKeyDown,
    handleResourceResizeFocus: handleResizeFocus,
    handleResourceInteraction,
    prepareResourceViewForAgentTurn,
  }
}
