'use client'

import { useCallback, useEffect, useRef } from 'react'
import { generateId } from '@sim/utils/id'
import { createInterfaceModule } from '@/lib/interfaces/constants'
import type {
  InterfaceCell,
  InterfaceLayout,
  InterfaceModule,
  InterfaceModuleType,
} from '@/lib/interfaces/types'
import { swapModuleCells } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/utils'
import { useUpdateInterface } from '@/hooks/queries/interfaces'

/**
 * Trailing debounce for config edits. The inspector reports every keystroke;
 * structural edits (add/move/remove) bypass the debounce and fold any pending
 * config edit into the same write.
 */
const MODULE_CONFIG_SAVE_DEBOUNCE_MS = 400

export interface UseInterfaceLayoutArgs {
  workspaceId: string
  interfaceId: string
  /** The server layout from `useInterface(...)`. Reads always come from here. */
  layout: InterfaceLayout
  /**
   * `updatedAt` of the same record, sent as the optimistic-concurrency
   * precondition on every write so a stale editor 409s instead of clobbering a
   * teammate's (or the agent's) modules. `undefined` while the record loads,
   * which simply leaves the write unguarded.
   */
  updatedAt?: string
  /**
   * Invoked with the new module's id as soon as `addModule` commits, so the
   * caller can select it. `addModule` returns `void` by contract, and the id is
   * minted inside the hook, so this callback is the only way out.
   */
  onModuleAdded?: (moduleId: string) => void
}

export interface UseInterfaceLayoutResult {
  addModule: (type: InterfaceModuleType, cell: InterfaceCell) => void
  moveModule: (moduleId: string, cell: InterfaceCell) => void
  removeModule: (moduleId: string) => void
  /**
   * Debounced (400ms trailing), flushed on moduleId change and on unmount.
   *
   * `isValid` is the inspector's verdict on the emitted config. An invalid edit
   * is held, not sent: the contract would reject it, the optimistic patch would
   * roll back, and the user would get a toast repeating the inline error they
   * are already looking at. The held edit is folded into the next valid write.
   */
  updateModuleConfig: (
    moduleId: string,
    config: InterfaceModule['config'],
    isValid: boolean
  ) => void
  isSaving: boolean
}

interface PendingConfigWrite {
  moduleId: string
  layout: InterfaceLayout
  /** `false` leaves the write unarmed until a later edit makes the config valid. */
  isValid: boolean
}

/**
 * The single choke point for interface layout writes. Every mutation — add,
 * move, remove, config edit — is applied to the current layout with the pure
 * helpers in `utils/layout` and PATCHed as a whole-layout replace, which is
 * what the update contract expects (the granular service operations exist for
 * the Sim agent, not the editor).
 *
 * Reads come from the React Query detail cache, which `useUpdateInterface`
 * patches optimistically in `onMutate`, so the canvas re-renders from the new
 * layout before the request resolves and rolls back on failure.
 */
export function useInterfaceLayout({
  workspaceId,
  interfaceId,
  layout,
  updatedAt,
  onModuleAdded,
}: UseInterfaceLayoutArgs): UseInterfaceLayoutResult {
  const { mutate, isPending } = useUpdateInterface(workspaceId)

  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const updatedAtRef = useRef(updatedAt)
  updatedAtRef.current = updatedAt
  const interfaceIdRef = useRef(interfaceId)
  interfaceIdRef.current = interfaceId
  const onModuleAddedRef = useRef(onModuleAdded)
  onModuleAddedRef.current = onModuleAdded

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<PendingConfigWrite | null>(null)
  const inFlightRef = useRef(0)

  const write = useCallback(
    (next: InterfaceLayout) => {
      /**
       * The precondition detects *other* writers, so it is withheld while one
       * of this editor's own writes is still in flight: `updatedAt` cannot have
       * caught up yet, and every queued layout is derived from the one before
       * it, so a rapid second drag would 409 against our own first one.
       */
      const expectedUpdatedAt = inFlightRef.current === 0 ? updatedAtRef.current : undefined
      inFlightRef.current += 1
      mutate(
        { interfaceId: interfaceIdRef.current, layout: next, expectedUpdatedAt },
        {
          onSettled: () => {
            inFlightRef.current -= 1
          },
        }
      )
    },
    [mutate]
  )

  /** Sends `next` immediately and drops any queued config write it supersedes. */
  const commit = useCallback(
    (next: InterfaceLayout) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      pendingRef.current = null
      write(next)
    },
    [write]
  )

  /**
   * The layout including a debounced config edit that has not been sent yet.
   * An invalid held edit is skipped: a structural write must not carry a config
   * the contract would reject, which would fail the drag or removal too. The
   * inspector keeps its own draft, so nothing the user typed disappears.
   */
  const currentLayout = useCallback(() => {
    const pending = pendingRef.current
    return pending?.isValid ? pending.layout : layoutRef.current
  }, [])

  const addModule = useCallback(
    (type: InterfaceModuleType, cell: InterfaceCell) => {
      const base = currentLayout()
      const occupied = base.modules.some(
        (module) => module.cell.row === cell.row && module.cell.col === cell.col
      )
      if (occupied) return
      const module = createInterfaceModule(generateId(), type, cell)
      commit({ ...base, modules: [...base.modules, module] })
      onModuleAddedRef.current?.(module.id)
    },
    [commit, currentLayout]
  )

  const moveModule = useCallback(
    (moduleId: string, cell: InterfaceCell) => {
      const base = currentLayout()
      const next = swapModuleCells(base, moduleId, cell)
      if (next === base) return
      commit(next)
    },
    [commit, currentLayout]
  )

  const removeModule = useCallback(
    (moduleId: string) => {
      const base = currentLayout()
      if (!base.modules.some((module) => module.id === moduleId)) return
      commit({ ...base, modules: base.modules.filter((module) => module.id !== moduleId) })
    },
    [commit, currentLayout]
  )

  const updateModuleConfig = useCallback(
    (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => {
      const pending = pendingRef.current
      const base = currentLayout()
      if (pending && pending.moduleId !== moduleId) {
        /**
         * Selection moved to another module mid-debounce. A valid queued edit
         * is sent now and kept as the base — the detail cache has not been
         * patched yet, so `layoutRef` would still be missing it. An invalid one
         * can never be sent, so it is simply dropped.
         */
        if (pending.isValid) commit(pending.layout)
        else pendingRef.current = null
      }

      if (!base.modules.some((module) => module.id === moduleId)) return

      const next: InterfaceLayout = {
        ...base,
        modules: base.modules.map((module) =>
          /**
           * The inspector renders per `module.type`, so the config it emits
           * always matches; `validateLayout` rejects a mismatch server-side.
           */
          module.id === moduleId ? ({ ...module, config } as InterfaceModule) : module
        ),
      }

      pendingRef.current = { moduleId, layout: next, isValid }
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (!isValid) return

      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const queued = pendingRef.current
        if (!queued?.isValid) return
        pendingRef.current = null
        write(queued.layout)
      }, MODULE_CONFIG_SAVE_DEBOUNCE_MS)
    },
    [commit, currentLayout, write]
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const queued = pendingRef.current
      pendingRef.current = null
      if (!queued?.isValid) return
      /**
       * Mutations outlive the component that started them, so navigating away
       * mid-edit still persists the last keystroke.
       */
      write(queued.layout)
    }
  }, [write])

  return {
    addModule,
    moveModule,
    removeModule,
    updateModuleConfig,
    isSaving: isPending,
  }
}
