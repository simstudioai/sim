'use client'

import type { CSSProperties } from 'react'
import { Panels } from '@sim/emcn/icons'
import { InterfacePane } from '@/components/resources/interface-view/components/interface-preview-grid/components/interface-pane'
import { ResourceEmptyState } from '@/components/resources/resource-empty-state'
import { collapseLayout } from '@/lib/interfaces/geometry'
import type { InterfaceLayout } from '@/lib/interfaces/types'

export interface InterfacePreviewGridProps {
  layout: InterfaceLayout
  /**
   * Whether the modules are live for the viewer. The editor passes its
   * workspace write permission; a public share passes `true`.
   */
  canRun: boolean
}

/**
 * The interface exactly as it ships — the one component both the editor's
 * Preview mode and the public share page render, so the preview cannot lie
 * about the page and the two cannot drift.
 *
 * `collapseLayout` drops empty tracks and spans a row's lone module across it,
 * so a two-module interface whose second module was un-wired collapses into a
 * clean full-page surface rather than leaving a hole. The collapsed grid is
 * whatever that pass produces, so this component never assumes a track count.
 *
 * Geometry lives in CSS custom properties rather than inline `grid-template-*`
 * values: a phone must stack the panes, and an inline `style` outranks every
 * media query, so a literal template could not be overridden. The variables are
 * SSR-safe and need no JS, so there is no hydration flash and no layout jump.
 */
export function InterfacePreviewGrid({ layout, canRun }: InterfacePreviewGridProps) {
  const preview = collapseLayout(layout)

  if (preview.modules.length === 0) {
    return (
      <div className='relative min-w-0 flex-1 overflow-auto p-4'>
        <ResourceEmptyState icon={Panels} description='This interface has no modules yet.' />
      </div>
    )
  }

  return (
    <div className='relative min-w-0 flex-1 overflow-auto p-4'>
      <div
        style={
          {
            '--interface-cols': preview.grid.cols,
            '--interface-rows': preview.grid.rows,
          } as CSSProperties
        }
        className='grid h-full min-h-0 gap-2 [grid-template-columns:repeat(var(--interface-cols),minmax(0,1fr))] [grid-template-rows:repeat(var(--interface-rows),minmax(0,1fr))] max-sm:h-auto max-sm:[grid-template-columns:minmax(0,1fr)] max-sm:[grid-template-rows:none]'
      >
        {preview.modules.map(({ module, placement }) => (
          <InterfacePane
            key={module.id}
            module={module}
            style={
              {
                '--pane-row': `${placement.row + 1} / span ${placement.rowSpan}`,
                '--pane-col': `${placement.col + 1} / span ${placement.colSpan}`,
              } as CSSProperties
            }
            canRun={canRun}
          />
        ))}
      </div>
    </div>
  )
}
