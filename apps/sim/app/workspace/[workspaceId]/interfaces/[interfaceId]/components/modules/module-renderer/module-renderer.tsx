'use client'

import { memo } from 'react'
import type { InterfaceModule } from '@/lib/interfaces'
import { ChatModule } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/chat-module'
import { FileModule } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/file-module'
import { FormModule } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/form-module'
import { TableModule } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/table-module'
import type { InterfaceMode } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/search-params'

export interface ModuleRendererProps {
  workspaceId: string
  interfaceId: string
  module: InterfaceModule
  mode: InterfaceMode
  /**
   * Workspace write permission. The interactive modules (chat, form) both write
   * through endpoints that require it, so a viewer must never be offered a
   * control that can only 403.
   */
  canEdit: boolean
}

/**
 * Dispatches a placed module to its renderer — the single boundary the canvas
 * cell crosses into the module implementations.
 *
 * Renderers draw the module's **interior only**: the cell owns the frame
 * (border, radius, selection ring, drag handle, title bar), so every branch
 * here fills the space it is given without adding chrome of its own.
 *
 * The switch is exhaustive over `InterfaceModule['type']`, so adding a module
 * type to the domain union surfaces here as a compile error rather than a blank
 * cell at runtime.
 *
 * Memoized: every prop is a pure pass-through with no closure, and module
 * identity is preserved across layout writes, so a drag tick, a selection
 * click, or an autosave settling never re-reconciles a hundred-row table.
 */
function ModuleRendererComponent({
  workspaceId,
  interfaceId,
  module,
  mode,
  canEdit,
}: ModuleRendererProps) {
  switch (module.type) {
    case 'chat':
      return (
        <ChatModule
          workspaceId={workspaceId}
          interfaceId={interfaceId}
          module={module}
          mode={mode}
          canEdit={canEdit}
        />
      )
    case 'form':
      return (
        <FormModule
          workspaceId={workspaceId}
          interfaceId={interfaceId}
          module={module}
          mode={mode}
          canEdit={canEdit}
        />
      )
    case 'table':
      return (
        <TableModule
          workspaceId={workspaceId}
          interfaceId={interfaceId}
          module={module}
          mode={mode}
        />
      )
    case 'file':
      return (
        <FileModule
          workspaceId={workspaceId}
          interfaceId={interfaceId}
          module={module}
          mode={mode}
        />
      )
  }
}

export const ModuleRenderer = memo(ModuleRendererComponent)
