'use client'

import { useMemo } from 'react'
import { Table as TableIcon } from '@sim/emcn/icons'
import { ModuleResourcePicker } from '@/components/resources/interface-view/components/module-renderer/components/module-resource-picker'
import { interfaceModuleSeed } from '@/components/resources/interface-view/interface-scope'
import { ResourceEmptyState } from '@/components/resources/resource-empty-state'
import { useResourceOfKind } from '@/components/resources/resource-provider'
import { TableView } from '@/components/resources/table-view'
import type { InterfaceModule } from '@/lib/interfaces/types'
import { grantsForShare, shareSource, workspaceSource } from '@/resources'

export interface TableModuleProps {
  module: Extract<InterfaceModule, { type: 'table' }>
  /**
   * Present only where this module may bind its own table — see
   * `ModuleRenderer`. There is no `mode` here: rows are read-only in every
   * scope, so the only thing edit mode ever changed was whether the module
   * could be bound, which is exactly what this prop's presence now says.
   */
  onConfigChange?: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
}

/**
 * A workspace table inside an interface.
 *
 * This module owns exactly two things: binding itself to a table, and turning
 * the surrounding interface source into a *table* source. The table itself is
 * the canonical {@link TableView}, so a module renders every cell kind the
 * tables grid does — booleans, dates, JSON, links, currency, select pills —
 * rather than the approximation it used to carry.
 *
 * The share arm addresses the table by `(token, moduleId)` and carries no table
 * id at all: the server derives it from the stored layout on every request, so
 * there is nothing here for a visitor to forge.
 */
export function TableModule({ module, onConfigChange }: TableModuleProps) {
  const { source } = useResourceOfKind('interface')
  const { tableId } = module.config

  const seed = interfaceModuleSeed(source, module.id)
  const sharedTable = seed?.kind === 'table' ? seed.seed : null

  const tableSource = useMemo(() => {
    if (source.via === 'workspace') {
      return tableId
        ? workspaceSource({ kind: 'table', workspaceId: source.workspaceId, resourceId: tableId })
        : null
    }
    return sharedTable
      ? shareSource({ kind: 'table', token: source.token, grantId: module.id, seed: sharedTable })
      : null
  }, [source, tableId, sharedTable, module.id])

  if (!tableSource) {
    /**
     * Unbound in the editor: the module authors itself, rendering the same
     * chooser the empty cell offered a moment earlier so picking the table
     * happens where the module is rather than in the inspector.
     */
    if (source.via === 'workspace' && onConfigChange) {
      return (
        <ModuleResourcePicker
          kind='table'
          workspaceId={source.workspaceId}
          onSelect={(next) => onConfigChange(module.id, { tableId: next }, true)}
        />
      )
    }
    return <ResourceEmptyState icon={TableIcon} description='This table is not available.' />
  }

  return <TableView source={tableSource} grants={grantsForShare('table')} host='panel' />
}
