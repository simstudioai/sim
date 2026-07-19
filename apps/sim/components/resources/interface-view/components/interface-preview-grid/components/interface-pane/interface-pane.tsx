'use client'

import type { CSSProperties } from 'react'
import { ModuleRenderer } from '@/components/resources/interface-view/components/module-renderer'
import type { InterfaceModule } from '@/lib/interfaces'

export interface InterfacePaneProps {
  module: InterfaceModule
  /**
   * Collapsed grid placement from `collapseLayout`, carried as the
   * `--pane-row` / `--pane-col` custom properties the classes below consume.
   * Custom properties rather than `gridRow`/`gridColumn` directly: an inline
   * `style` outranks every media query, so a literal placement could not be
   * dropped for the stacked phone layout.
   */
  style: CSSProperties
  /** Whether this surface is live for the viewer — the interactive modules need it to run. */
  canRun: boolean
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
 *
 * Below `sm` the pane leaves the authored grid entirely and flows in DOM order
 * at a readable height: two columns on a 390px phone would give a chat
 * composer, a form row, or a table header roughly 180px, which is unusable.
 */
export function InterfacePane({ module, style, canRun }: InterfacePaneProps) {
  return (
    <div
      style={style}
      className='flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)] [grid-column:var(--pane-col)] [grid-row:var(--pane-row)] max-sm:min-h-[70dvh] max-sm:[grid-column:auto] max-sm:[grid-row:auto]'
    >
      <div className='min-h-0 flex-1 overflow-auto'>
        <ModuleRenderer module={module} mode='preview' canRun={canRun} />
      </div>
    </div>
  )
}
