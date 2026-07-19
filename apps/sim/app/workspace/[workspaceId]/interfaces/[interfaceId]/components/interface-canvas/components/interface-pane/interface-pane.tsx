'use client'

import type { CSSProperties } from 'react'
import type { InterfaceModule } from '@/lib/interfaces'
import { ModuleRenderer } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/module-renderer'

export interface InterfacePaneProps {
  module: InterfaceModule
  /** Collapsed grid placement from `computePreviewLayout`. */
  style: CSSProperties
  workspaceId: string
  interfaceId: string
  /** Workspace write permission — the interactive modules need it to run. */
  canEdit: boolean
}

/**
 * One module of the interface as an end user sees it.
 *
 * Deliberately *not* a disabled `InterfaceCell`: a visitor has nothing to
 * select, drag, remove, or add, so none of that wiring exists here rather than
 * existing and being switched off. The pane is a border and a scroll well — no
 * type bar, no selection ring, no hover chrome — and the module it mounts is the
 * same live renderer the editor mounts, so toggling modes never tears down an
 * in-flight chat stream or a half-filled form.
 */
export function InterfacePane({
  module,
  style,
  workspaceId,
  interfaceId,
  canEdit,
}: InterfacePaneProps) {
  return (
    <div
      style={style}
      className='flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)]'
    >
      <div className='min-h-0 flex-1 overflow-auto'>
        <ModuleRenderer
          workspaceId={workspaceId}
          interfaceId={interfaceId}
          module={module}
          mode='preview'
          canEdit={canEdit}
        />
      </div>
    </div>
  )
}
