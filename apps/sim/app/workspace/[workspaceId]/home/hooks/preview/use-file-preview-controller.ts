'use client'

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useRef,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SyntheticFilePreviewPayload } from '@/lib/copilot/request/session'
import type { FilePreviewSession } from '@/lib/copilot/request/session/file-preview-session-contract'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import { deriveFilePreviewSession } from '@/app/workspace/[workspaceId]/home/hooks/preview/apply-file-preview-phase'
import {
  buildCompletedPreviewSessions,
  type FilePreviewSessionsState,
  hasRenderableFilePreviewContent,
  INITIAL_FILE_PREVIEW_SESSIONS_STATE,
  reduceFilePreviewSessions,
  useFilePreviewSessions,
} from '@/app/workspace/[workspaceId]/home/hooks/preview/use-file-preview-sessions'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

interface FilePreviewControllerDeps {
  workspaceId: string
  setResources: Dispatch<SetStateAction<MothershipResource[]>>
  setActiveResourceId: Dispatch<SetStateAction<string | null>>
  activeResourceIdRef: MutableRefObject<string | null>
}

function asPayloadRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Owns the file-preview state machine for the mothership chat: the preview-session
 * store, the streaming-to-committed resource handoff bookkeeping, and translation
 * of synthetic preview-phase events into session updates and resource chrome. The
 * viewer renders committed binaries (see `useDocPreviewBinary`); this controller
 * decides which resource is active and when a generated file is promoted from the
 * synthetic `streaming-file` placeholder to its real workspace file.
 */
export function useFilePreviewController({
  workspaceId,
  setResources,
  setActiveResourceId,
  activeResourceIdRef,
}: FilePreviewControllerDeps) {
  const queryClient = useQueryClient()

  const previewActivationOwnerRef = useRef<Map<string, string | null>>(new Map())
  const completedPreviewResourceHandoffRef = useRef<
    Map<string, { sessionId: string; suppressActivation: boolean }>
  >(new Map())

  const rememberPreviewActivationOwner = useCallback(
    (session: FilePreviewSession) => {
      if (!session.fileId || previewActivationOwnerRef.current.has(session.id)) {
        return
      }
      previewActivationOwnerRef.current.set(session.id, activeResourceIdRef.current)
    },
    [activeResourceIdRef]
  )

  const shouldAutoActivatePreviewSession = useCallback(
    (session: FilePreviewSession) => {
      if (!session.fileId) {
        return false
      }
      const currentActiveResourceId = activeResourceIdRef.current
      const activationOwnerId = previewActivationOwnerRef.current.get(session.id)
      return (
        currentActiveResourceId === null ||
        currentActiveResourceId === session.fileId ||
        currentActiveResourceId === 'streaming-file' ||
        currentActiveResourceId === activationOwnerId
      )
    },
    [activeResourceIdRef]
  )

  const seedCompletedPreviewContentCache = useCallback(
    (fileId: string, previewText: string) => {
      queryClient.setQueriesData<string>(
        { queryKey: workspaceFilesKeys.content(workspaceId, fileId, 'text') },
        previewText
      )

      const activeFiles = queryClient.getQueryData<Array<{ id: string; key: string }>>(
        workspaceFilesKeys.list(workspaceId, 'active')
      )
      const fileKey = activeFiles?.find((file) => file.id === fileId)?.key
      if (fileKey) {
        queryClient.setQueryData(
          [...workspaceFilesKeys.content(workspaceId, fileId, 'text'), fileKey],
          previewText
        )
      }
    },
    [queryClient, workspaceId]
  )

  const {
    previewSession,
    previewSessionsById,
    activePreviewSessionId,
    hydratePreviewSessions,
    upsertPreviewSession,
    completePreviewSession,
    removePreviewSession,
    resetPreviewSessions,
  } = useFilePreviewSessions()
  const previewSessionRef = useRef(previewSession)
  previewSessionRef.current = previewSession
  const previewSessionsRef = useRef(previewSessionsById)
  previewSessionsRef.current = previewSessionsById
  const activePreviewSessionIdRef = useRef(activePreviewSessionId)
  activePreviewSessionIdRef.current = activePreviewSessionId
  const latestPreviewTargetToolCallIdRef = useRef<string | null>(null)
  const previewSessionsStateRef = useRef<FilePreviewSessionsState>({
    activeSessionId: activePreviewSessionId,
    sessions: previewSessionsById,
  })
  previewSessionsStateRef.current = {
    activeSessionId: activePreviewSessionId,
    sessions: previewSessionsById,
  }

  const syncPreviewSessionRefs = useCallback((nextState: FilePreviewSessionsState) => {
    previewSessionsStateRef.current = nextState
    previewSessionsRef.current = nextState.sessions
    activePreviewSessionIdRef.current = nextState.activeSessionId
    previewSessionRef.current =
      nextState.activeSessionId !== null
        ? (nextState.sessions[nextState.activeSessionId] ?? null)
        : null
  }, [])

  const applyPreviewSessionUpdate = useCallback(
    (session: FilePreviewSession, options?: { activate?: boolean }) => {
      const nextState = reduceFilePreviewSessions(previewSessionsStateRef.current, {
        type: 'upsert',
        session,
        ...(options?.activate === false ? { activate: false } : {}),
      })
      syncPreviewSessionRefs(nextState)
      upsertPreviewSession(session, options)
      return nextState
    },
    [syncPreviewSessionRefs, upsertPreviewSession]
  )

  const applyCompletedPreviewSession = useCallback(
    (session: FilePreviewSession) => {
      const nextState = reduceFilePreviewSessions(previewSessionsStateRef.current, {
        type: 'complete',
        session,
      })
      syncPreviewSessionRefs(nextState)
      completePreviewSession(session)
      return nextState
    },
    [completePreviewSession, syncPreviewSessionRefs]
  )

  const reconcileTerminalPreviewSessions = useCallback(() => {
    const completedAt = new Date().toISOString()
    const completedSessions = buildCompletedPreviewSessions(
      previewSessionsStateRef.current.sessions,
      completedAt
    )

    for (const session of completedSessions) {
      applyCompletedPreviewSession(session)
    }
  }, [applyCompletedPreviewSession])

  const removePreviewSessionImmediate = useCallback(
    (sessionId: string) => {
      const nextState = reduceFilePreviewSessions(previewSessionsStateRef.current, {
        type: 'remove',
        sessionId,
      })
      syncPreviewSessionRefs(nextState)
      removePreviewSession(sessionId)
      return nextState
    },
    [removePreviewSession, syncPreviewSessionRefs]
  )

  const resetEphemeralPreviewState = useCallback(
    (options?: { removeStreamingResource?: boolean }) => {
      previewActivationOwnerRef.current.clear()
      completedPreviewResourceHandoffRef.current.clear()
      latestPreviewTargetToolCallIdRef.current = null
      syncPreviewSessionRefs(INITIAL_FILE_PREVIEW_SESSIONS_STATE)
      resetPreviewSessions()
      if (options?.removeStreamingResource) {
        setResources((current) => current.filter((resource) => resource.id !== 'streaming-file'))
      }
    },
    [resetPreviewSessions, setResources, syncPreviewSessionRefs]
  )

  const promoteFileResource = useCallback(
    (fileId: string, title: string) => {
      setResources((current) => {
        const withoutStreaming = current.filter((resource) => resource.id !== 'streaming-file')
        if (
          withoutStreaming.some((resource) => resource.type === 'file' && resource.id === fileId)
        ) {
          return withoutStreaming
        }
        return [...withoutStreaming, { type: 'file', id: fileId, title }]
      })
    },
    [setResources]
  )

  const syncPreviewResourceChrome = useCallback(
    (session: FilePreviewSession, options?: { activate?: boolean }) => {
      if (session.targetKind === 'new_file') {
        setResources((current) => {
          const existing = current.find((resource) => resource.id === 'streaming-file')
          if (existing) {
            return current.map((resource) =>
              resource.id === 'streaming-file'
                ? { ...resource, title: session.fileName || 'Writing file...' }
                : resource
            )
          }
          return [
            ...current,
            { type: 'file', id: 'streaming-file', title: session.fileName || 'Writing file...' },
          ]
        })
        setActiveResourceId('streaming-file')
        return
      }

      if (session.fileId && hasRenderableFilePreviewContent(session)) {
        promoteFileResource(session.fileId, session.fileName || 'File')
        if (options?.activate !== false) {
          setActiveResourceId(session.fileId)
        }
      }
    },
    [promoteFileResource, setActiveResourceId, setResources]
  )

  const seedPreviewSessions = useCallback(
    (sessions: FilePreviewSession[]) => {
      if (sessions.length === 0) {
        return
      }

      const nextState = reduceFilePreviewSessions(previewSessionsStateRef.current, {
        type: 'hydrate',
        sessions,
      })
      syncPreviewSessionRefs(nextState)
      hydratePreviewSessions(sessions)
      const active =
        nextState.activeSessionId !== null
          ? (nextState.sessions[nextState.activeSessionId] ?? null)
          : null
      if (active) {
        syncPreviewResourceChrome(active, {
          activate: active.targetKind === 'new_file' || shouldAutoActivatePreviewSession(active),
        })
      }
    },
    [
      hydratePreviewSessions,
      shouldAutoActivatePreviewSession,
      syncPreviewResourceChrome,
      syncPreviewSessionRefs,
    ]
  )

  const onPreviewPhase = useCallback(
    (payload: SyntheticFilePreviewPayload, streamId: string | undefined) => {
      const id = payload.toolCallId
      const prevSession = previewSessionsRef.current[id]
      const nextSession = deriveFilePreviewSession(
        prevSession,
        payload,
        streamId,
        new Date().toISOString()
      )

      if (payload.previewPhase === 'file_preview_start') {
        latestPreviewTargetToolCallIdRef.current = id
        applyPreviewSessionUpdate(nextSession)
        return
      }

      if (payload.previewPhase === 'file_preview_target') {
        latestPreviewTargetToolCallIdRef.current = id
        rememberPreviewActivationOwner(nextSession)
        const nextState = applyPreviewSessionUpdate(nextSession)
        const activePreview =
          nextState.activeSessionId !== null
            ? (nextState.sessions[nextState.activeSessionId] ?? null)
            : null
        if (activePreview?.id === nextSession.id) {
          syncPreviewResourceChrome(activePreview, {
            activate:
              activePreview.targetKind === 'new_file' ||
              shouldAutoActivatePreviewSession(activePreview),
          })
        }
        return
      }

      if (payload.previewPhase === 'file_preview_edit_meta') {
        applyPreviewSessionUpdate(nextSession)
        return
      }

      if (payload.previewPhase === 'file_preview_content') {
        applyPreviewSessionUpdate(nextSession)
        if (!prevSession || !hasRenderableFilePreviewContent(prevSession)) {
          syncPreviewResourceChrome(nextSession, {
            activate:
              nextSession.targetKind === 'new_file' ||
              shouldAutoActivatePreviewSession(nextSession),
          })
        }
        return
      }

      const resultData = asPayloadRecord(payload.output)
      const outputData = asPayloadRecord(resultData?.data) ?? resultData
      const wasRenderableBeforeComplete =
        prevSession !== undefined && hasRenderableFilePreviewContent(prevSession)
      const nextState = applyCompletedPreviewSession(nextSession)
      const fileId = nextSession.fileId

      if (fileId && resultData?.success === true && outputData?.id === fileId) {
        const fileName = (outputData.name as string) ?? nextSession.fileName ?? 'File'
        promoteFileResource(fileId, fileName)
        const completedExt = fileName.includes('.')
          ? (fileName.split('.').pop()?.toLowerCase() ?? '')
          : ''
        const isCompiledDocPreview = ['docx', 'pptx', 'pdf', 'xlsx'].includes(completedExt)
        const shouldActivateOnComplete =
          (isCompiledDocPreview ||
            (!wasRenderableBeforeComplete && hasRenderableFilePreviewContent(nextSession))) &&
          shouldAutoActivatePreviewSession(nextSession)
        if (shouldActivateOnComplete) {
          setActiveResourceId(fileId)
        }
        completedPreviewResourceHandoffRef.current.set(fileId, {
          sessionId: nextSession.id,
          suppressActivation: !shouldActivateOnComplete,
        })
        if (hasRenderableFilePreviewContent(nextSession)) {
          seedCompletedPreviewContentCache(fileId, nextSession.previewText)
        }
        invalidateResourceQueries(queryClient, workspaceId, 'file', fileId)
      } else {
        const activePreview =
          nextState.activeSessionId !== null
            ? (nextState.sessions[nextState.activeSessionId] ?? null)
            : null
        if (activePreview) {
          syncPreviewResourceChrome(activePreview, {
            activate:
              activePreview.targetKind === 'new_file' ||
              shouldAutoActivatePreviewSession(activePreview),
          })
        }
      }
    },
    [
      applyCompletedPreviewSession,
      applyPreviewSessionUpdate,
      promoteFileResource,
      queryClient,
      rememberPreviewActivationOwner,
      seedCompletedPreviewContentCache,
      setActiveResourceId,
      shouldAutoActivatePreviewSession,
      syncPreviewResourceChrome,
      workspaceId,
    ]
  )

  return {
    previewSession,
    previewSessionRef,
    previewSessionsRef,
    activePreviewSessionIdRef,
    latestPreviewTargetToolCallIdRef,
    previewActivationOwnerRef,
    completedPreviewResourceHandoffRef,
    shouldAutoActivatePreviewSession,
    applyPreviewSessionUpdate,
    removePreviewSessionImmediate,
    reconcileTerminalPreviewSessions,
    resetEphemeralPreviewState,
    promoteFileResource,
    seedPreviewSessions,
    onPreviewPhase,
  }
}
