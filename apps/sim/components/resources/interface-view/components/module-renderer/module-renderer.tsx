'use client'

import { memo } from 'react'
import { ChatModule } from '@/components/resources/interface-view/components/module-renderer/components/chat-module'
import { FileModule } from '@/components/resources/interface-view/components/module-renderer/components/file-module'
import { FormModule } from '@/components/resources/interface-view/components/module-renderer/components/form-module'
import { TableModule } from '@/components/resources/interface-view/components/module-renderer/components/table-module'
import type { InterfaceMode, InterfaceModule } from '@/lib/interfaces/types'

export interface ModuleRendererProps {
  module: InterfaceModule
  mode: InterfaceMode
  /**
   * Whether this surface is live for the viewer. In the workspace this is the
   * workspace write permission; on a public share it is the share's run grant —
   * the token routes are the authority, and a permanently-disabled composer on
   * a public page is nonsense. Named `canRun` rather than `canEdit` so it stops
   * reading as a permission claim.
   */
  canRun: boolean
  /**
   * Present only where the module may author itself: the canvas in edit mode,
   * for a viewer who can write. Absent everywhere else, so a renderer's
   * authoring affordances are not mounted rather than mounted and switched off
   * — the same rule `InterfaceEditing` follows one level up.
   *
   * Takes `moduleId` rather than arriving pre-bound so it keeps a stable
   * identity across renders and this component's memo holds.
   */
  onConfigChange?: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
}

/**
 * Dispatches a placed module to its renderer — the single boundary the canvas
 * cell crosses into the module implementations.
 *
 * Renderers draw the module's **interior only**: the cell owns the frame
 * (border, radius, selection ring, drag handle, title bar), so every branch
 * here fills the space it is given without adding chrome of its own.
 *
 * Nothing here carries a workspace or interface id: each renderer reads its
 * data source from the surrounding `ResourceProvider`, so the same tree serves
 * the authenticated editor and an anonymous public share without forking.
 *
 * The switch is exhaustive over `InterfaceModule['type']`, so adding a module
 * type to the domain union surfaces here as a compile error rather than a blank
 * cell at runtime.
 *
 * Memoized: every prop is a pure pass-through with no closure, and module
 * identity is preserved across layout writes, so a drag tick, a selection
 * click, or an autosave settling never re-reconciles a hundred-row table.
 */
function ModuleRendererComponent({ module, mode, canRun, onConfigChange }: ModuleRendererProps) {
  switch (module.type) {
    case 'chat':
      return (
        <ChatModule module={module} mode={mode} canRun={canRun} onConfigChange={onConfigChange} />
      )
    case 'form':
      return (
        <FormModule module={module} mode={mode} canRun={canRun} onConfigChange={onConfigChange} />
      )
    /**
     * No `mode`: a table and a file render identically in edit and preview, so
     * the only thing the mode ever decided was whether they could be bound —
     * which `onConfigChange`'s presence now says directly.
     */
    case 'table':
      return <TableModule module={module} onConfigChange={onConfigChange} />
    case 'file':
      return <FileModule module={module} onConfigChange={onConfigChange} />
  }
}

export const ModuleRenderer = memo(ModuleRendererComponent)
