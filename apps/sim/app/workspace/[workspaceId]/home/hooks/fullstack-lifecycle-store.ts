'use client'

import { useSyncExternalStore } from 'react'
import type { CredentialSelectionRequest } from '@/lib/apps/credential-binding-types'
import { buildAppPreviewUrl } from '@/lib/apps/preview-url'

export type FullstackPanelDestination = 'backend' | 'preview'

export type FullstackCredentialSelectionState = {
  projectId: string
  chatId?: string
  selections: CredentialSelectionRequest[]
}

export type FullstackPreviewState = {
  projectId: string
  revisionId: string
  sessionId: string
  channelNonce: string
  buildId?: string
  appPublicOrigin?: string
  artifactPreview?: boolean
  previewSrc: string
}

export type FullstackLifecycleState = {
  chatId: string | null
  projectId: string | null
  phase:
    | 'idle'
    | 'building_backend'
    | 'generating_interface'
    | 'building_app'
    | 'updating'
    | 'preview_ready'
    | 'credential_selection_required'
    | 'failed'
  destination: FullstackPanelDestination
  revisionId: string | null
  buildId: string | null
  preview: FullstackPreviewState | null
  credentialSelection: FullstackCredentialSelectionState | null
  statusMessage: string | null
  deployStatus: 'idle' | 'deploying' | 'deployed' | 'failed'
  deployError: string | null
}

const EMPTY_STATE: FullstackLifecycleState = {
  chatId: null,
  projectId: null,
  phase: 'idle',
  destination: 'backend',
  revisionId: null,
  buildId: null,
  preview: null,
  credentialSelection: null,
  statusMessage: null,
  deployStatus: 'idle',
  deployError: null,
}

let state: FullstackLifecycleState = EMPTY_STATE
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function getFullstackLifecycleState(): FullstackLifecycleState {
  return state
}

export function subscribeFullstackLifecycle(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useFullstackLifecycleState(): FullstackLifecycleState {
  return useSyncExternalStore(
    subscribeFullstackLifecycle,
    getFullstackLifecycleState,
    () => EMPTY_STATE
  )
}

export function resetFullstackLifecycleForChat(chatId: string | null): void {
  if (state.chatId === chatId) return
  state = {
    ...EMPTY_STATE,
    chatId,
  }
  emit()
}

export function setFullstackDestination(destination: FullstackPanelDestination): void {
  if (state.destination === destination) return
  state = { ...state, destination }
  emit()
}

export function prepareFullstackPreviewForDeploy(): void {
  state = {
    ...state,
    preview: null,
    phase: state.preview ? 'updating' : state.phase,
    statusMessage: state.preview ? 'Updating preview after deploy…' : state.statusMessage,
  }
  emit()
}

export function clearFullstackPreviewSession(sessionId: string): void {
  if (state.preview?.sessionId !== sessionId) return
  state = {
    ...state,
    preview: null,
    phase: 'building_app',
    destination: 'preview',
    statusMessage: 'Opening a fresh preview…',
  }
  emit()
}

export function applyFullstackAppLifecycleEvent(params: {
  eventName: string
  payload?: Record<string, unknown>
  chatId?: string
}): void {
  const nested = params.payload
  const projectId = typeof nested?.projectId === 'string' ? nested.projectId : undefined
  const phase = typeof nested?.phase === 'string' ? nested.phase : undefined

  if (params.eventName === 'app.generation.started') {
    const generatingInterface = phase === 'generating_frontend' || phase === 'building_app'
    state = {
      ...state,
      chatId: params.chatId ?? state.chatId,
      projectId: projectId ?? state.projectId,
      phase: generatingInterface
        ? phase === 'building_app'
          ? 'building_app'
          : 'generating_interface'
        : 'building_backend',
      destination: generatingInterface ? 'preview' : 'backend',
      statusMessage:
        phase === 'building_app'
          ? 'Building App…'
          : generatingInterface
            ? 'Generating interface…'
            : 'Building backend…',
      credentialSelection: null,
    }
    emit()
    return
  }

  if (params.eventName === 'app.generation.failed') {
    state = {
      ...state,
      chatId: params.chatId ?? state.chatId,
      projectId: projectId ?? state.projectId,
      phase: 'failed',
      statusMessage:
        typeof nested?.message === 'string' ? nested.message : 'Full-stack generation failed',
    }
    emit()
    return
  }

  if (params.eventName === 'app.frontend.generated') {
    state = {
      ...state,
      chatId: params.chatId ?? state.chatId,
      projectId: projectId ?? state.projectId,
      phase: 'building_app',
      destination: 'preview',
      statusMessage: 'Interface source ready; building preview…',
    }
    emit()
    return
  }

  if (params.eventName === 'app.revision.created') {
    const generating = phase === 'generating_frontend' || phase === 'generating_interface'
    const buildingBackend = phase === 'building_backend'
    state = {
      ...state,
      chatId: params.chatId ?? state.chatId,
      projectId: projectId ?? state.projectId,
      phase: generating
        ? 'generating_interface'
        : buildingBackend
          ? 'building_backend'
          : state.preview
            ? 'updating'
            : 'building_backend',
      destination: generating ? 'preview' : 'backend',
      statusMessage: generating
        ? 'Generating interface…'
        : buildingBackend
          ? 'Building backend…'
          : state.statusMessage,
      credentialSelection: null,
    }
    emit()
    return
  }

  if (params.eventName === 'app.build.finished') {
    state = {
      ...state,
      chatId: params.chatId ?? state.chatId,
      projectId: projectId ?? state.projectId,
      revisionId: typeof nested?.revisionId === 'string' ? nested.revisionId : state.revisionId,
      buildId: typeof nested?.buildId === 'string' ? nested.buildId : state.buildId,
      phase: state.preview ? 'updating' : 'building_app',
      destination: 'preview',
      statusMessage: 'Building App…',
    }
    emit()
    return
  }

  if (params.eventName === 'app.preview.ready') {
    const sessionId = typeof nested?.sessionId === 'string' ? nested.sessionId : null
    const channelNonce = typeof nested?.channelNonce === 'string' ? nested.channelNonce : null
    const revisionId = typeof nested?.revisionId === 'string' ? nested.revisionId : null
    const appPublicOrigin =
      typeof nested?.appPublicOrigin === 'string' ? nested.appPublicOrigin : null
    if (!projectId || !sessionId || !channelNonce || !revisionId || !appPublicOrigin) {
      return
    }
    const nextPreview: FullstackPreviewState = {
      projectId,
      revisionId,
      sessionId,
      channelNonce,
      buildId: typeof nested?.buildId === 'string' ? nested.buildId : undefined,
      appPublicOrigin,
      artifactPreview:
        typeof nested?.artifactPreview === 'boolean' ? nested.artifactPreview : undefined,
      previewSrc: buildAppPreviewUrl({
        appPublicOrigin,
        sessionId,
        channelNonce,
        parentOrigin: typeof window !== 'undefined' ? window.location.origin : '',
      }),
    }
    state = {
      ...state,
      chatId: params.chatId ?? state.chatId,
      projectId,
      revisionId,
      buildId: nextPreview.buildId ?? state.buildId,
      phase: 'preview_ready',
      destination: 'preview',
      preview: nextPreview,
      statusMessage: null,
      credentialSelection: null,
    }
    emit()
    return
  }

  if (params.eventName === 'app.binding.drift' && phase === 'credential_selection_required') {
    const selections = Array.isArray(nested?.credentialSelections)
      ? (nested.credentialSelections as CredentialSelectionRequest[])
      : []
    if (!projectId || selections.length === 0) return
    state = {
      ...state,
      chatId: params.chatId ?? state.chatId,
      projectId,
      phase: 'credential_selection_required',
      destination: 'backend',
      credentialSelection: {
        projectId,
        chatId: typeof nested?.chatId === 'string' ? nested.chatId : params.chatId,
        selections,
      },
      statusMessage: 'Select which connected account to use',
    }
    emit()
    return
  }

  if (params.eventName === 'app.binding.drift') {
    state = {
      ...state,
      projectId: projectId ?? state.projectId,
      phase: state.preview ? 'updating' : state.phase,
      statusMessage: 'Backend bindings changed; rebuilding preview…',
    }
    emit()
    return
  }

  if (params.eventName === 'app.release.prepared') {
    state = {
      ...state,
      projectId: projectId ?? state.projectId,
      statusMessage: 'Release prepared',
    }
    emit()
    return
  }

  if (params.eventName === 'app.release.revoked') {
    state = {
      ...state,
      projectId: projectId ?? state.projectId,
      deployStatus: 'idle',
      deployError: null,
      statusMessage: 'Public release revoked',
    }
    emit()
    return
  }

  if (params.eventName === 'app.release.published') {
    state = {
      ...state,
      deployStatus: 'deployed',
      deployError: null,
    }
    emit()
    return
  }

  if (params.eventName === 'app.deploy.started') {
    state = {
      ...state,
      deployStatus: 'deploying',
      deployError: null,
    }
    emit()
    return
  }

  if (params.eventName === 'app.deploy.failed') {
    state = {
      ...state,
      deployStatus: 'failed',
      deployError: typeof nested?.message === 'string' ? nested.message : 'Deploy failed',
    }
    emit()
  }
}
