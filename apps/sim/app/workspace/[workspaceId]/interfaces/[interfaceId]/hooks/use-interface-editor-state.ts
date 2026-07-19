'use client'

import { useCallback, useState } from 'react'
import { useQueryStates } from 'nuqs'
import type { InterfaceMode } from '@/lib/interfaces/types'
import {
  interfaceDetailParsers,
  interfaceDetailUrlKeys,
} from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/search-params'
import { hostOwnsUrl, type ResourceHost } from '@/resources'

export interface InterfaceEditorState {
  mode: InterfaceMode
  /** `null` = nothing selected; the inspector shows its empty state. */
  selectedModuleId: string | null
  isShareOpen: boolean
  setMode: (mode: InterfaceMode) => void
  selectModule: (moduleId: string | null) => void
  setShareOpen: (open: boolean) => void
}

interface LocalEditorState {
  mode: InterfaceMode
  selectedModuleId: string | null
  isShareOpen: boolean
}

const INITIAL_LOCAL_STATE: LocalEditorState = {
  mode: 'edit',
  selectedModuleId: null,
  isShareOpen: false,
}

/**
 * The editor's view-state, stored wherever this host allows.
 *
 * A `page` host owns the URL, so mode, selection, and the share dialog live in
 * nuqs params and survive reload, back/forward, and a shared link. Any other
 * host is embedded inside a surface that owns the URL — writing `?mode` /
 * `?module` / `?share` there would rewrite *its* address bar with keys that
 * mean nothing to it — so the same state is held locally instead. That is the
 * whole of the "embedded views do not own the URL" rule for this surface, in
 * one place, keyed off {@link hostOwnsUrl} rather than a bespoke flag.
 *
 * Both stores are always constructed — hook order cannot be conditional — but
 * only the host's own is ever read or written.
 */
export function useInterfaceEditorState(host: ResourceHost): InterfaceEditorState {
  const [urlState, setUrlState] = useQueryStates(interfaceDetailParsers, interfaceDetailUrlKeys)
  const [localState, setLocalState] = useState<LocalEditorState>(INITIAL_LOCAL_STATE)

  const ownsUrl = hostOwnsUrl(host)

  const setMode = useCallback(
    (mode: InterfaceMode) => {
      if (ownsUrl) setUrlState({ mode })
      else setLocalState((previous) => ({ ...previous, mode }))
    },
    [ownsUrl, setUrlState]
  )

  const selectModule = useCallback(
    (moduleId: string | null) => {
      if (ownsUrl) setUrlState({ module: moduleId })
      else setLocalState((previous) => ({ ...previous, selectedModuleId: moduleId }))
    },
    [ownsUrl, setUrlState]
  )

  const setShareOpen = useCallback(
    (open: boolean) => {
      if (ownsUrl) setUrlState({ share: open }, { history: 'replace' })
      else setLocalState((previous) => ({ ...previous, isShareOpen: open }))
    },
    [ownsUrl, setUrlState]
  )

  return {
    mode: ownsUrl ? urlState.mode : localState.mode,
    selectedModuleId: ownsUrl ? urlState.module : localState.selectedModuleId,
    isShareOpen: ownsUrl ? urlState.share : localState.isShareOpen,
    setMode,
    selectModule,
    setShareOpen,
  }
}
