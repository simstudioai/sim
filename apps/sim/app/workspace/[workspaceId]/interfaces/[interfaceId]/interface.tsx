'use client'

import { useCallback, useMemo } from 'react'
import { Eye, Panels, Pencil } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { InterfaceLayout } from '@/lib/interfaces'
import {
  type BreadcrumbItem,
  Resource,
  type ResourceAction,
} from '@/app/workspace/[workspaceId]/components'
import { InterfaceCanvas } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/interface-canvas'
import { ModuleInspector } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector'
import { useInterfaceLayout } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/hooks/use-interface-layout'
import {
  interfaceDetailParsers,
  interfaceDetailUrlKeys,
} from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/search-params'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useInterface, useRenameInterface } from '@/hooks/queries/interfaces'
import { useInlineRename } from '@/hooks/use-inline-rename'

/** Stable empty layout so the canvas never re-renders on an identity change while loading. */
const EMPTY_LAYOUT: InterfaceLayout = { version: 1, modules: [] }

interface InterfaceProps {
  /** When set, the editor renders without its page header / breadcrumbs. Used
   *  by the mothership chat panel to embed an interface inline. */
  embedded?: boolean
  /** Identifiers — only set in embedded mode. Page mode reads from `useParams()`. */
  workspaceId?: string
  interfaceId?: string
}

/**
 * Interface editor. A thin orchestrator: it owns the URL view-state (mode and
 * selected module), resolves permissions, and wires the canvas to the single
 * layout-write choke point in `useInterfaceLayout`. The canvas paints the grid;
 * the inspector edits the selected module's config.
 *
 * The inspector is a flex sibling with `shrink-0`, not an overlay — it is
 * always present, exactly like the workflow editor's right panel.
 *
 * Embedded mode skips the page header but otherwise renders the same surface.
 */
export function Interface({
  embedded,
  workspaceId: propWorkspaceId,
  interfaceId: propInterfaceId,
}: InterfaceProps = {}) {
  const params = useParams()
  const workspaceId = propWorkspaceId || (params.workspaceId as string)
  const interfaceId = propInterfaceId || (params.interfaceId as string)
  const router = useRouter()

  const [{ mode, module: selectedModuleId }, setParams] = useQueryStates(
    interfaceDetailParsers,
    interfaceDetailUrlKeys
  )

  const { data: definition } = useInterface(workspaceId, interfaceId)
  const layout = definition?.layout ?? EMPTY_LAYOUT

  const userPermissions = useUserPermissionsContext()
  const canEdit = userPermissions.canEdit === true

  const handleModuleAdded = useCallback(
    (moduleId: string) => {
      setParams({ module: moduleId })
    },
    [setParams]
  )

  const { addModule, moveModule, removeModule, updateModuleConfig } = useInterfaceLayout({
    workspaceId,
    interfaceId,
    layout,
    updatedAt: definition?.updatedAt,
    onModuleAdded: handleModuleAdded,
  })

  const selectedModule = selectedModuleId
    ? (layout.modules.find((module) => module.id === selectedModuleId) ?? null)
    : null

  const handleSelectModule = useCallback(
    (moduleId: string | null) => {
      setParams({ module: moduleId })
    },
    [setParams]
  )

  const handleRemoveModule = useCallback(
    (moduleId: string) => {
      removeModule(moduleId)
      if (selectedModuleId === moduleId) setParams({ module: null })
    },
    [removeModule, selectedModuleId, setParams]
  )

  const renameInterface = useRenameInterface(workspaceId)
  const headerRename = useInlineRename({
    onSave: (id, name) => renameInterface.mutateAsync({ interfaceId: id, name }),
  })

  const handleNavigateBack = useCallback(() => {
    router.push(`/workspace/${workspaceId}/interfaces`)
  }, [router, workspaceId])

  const handleStartRename = useCallback(() => {
    if (definition) headerRename.startRename(interfaceId, definition.name)
  }, [definition, headerRename.startRename, interfaceId])

  const breadcrumbs = useMemo(
    (): BreadcrumbItem[] => [
      { label: 'Interfaces', icon: Panels, onClick: handleNavigateBack },
      /**
       * While the interface loads, mirror this route's loading.tsx (terminal
       * "…" crumb) so no empty-label frame renders in between.
       */
      definition
        ? {
            label: definition.name,
            editing: headerRename.editingId
              ? {
                  isEditing: true,
                  value: headerRename.editValue,
                  onChange: headerRename.setEditValue,
                  onSubmit: headerRename.submitRename,
                  onCancel: headerRename.cancelRename,
                  disabled: headerRename.isSaving,
                }
              : undefined,
            dropdownItems: canEdit
              ? [{ label: 'Rename', icon: Pencil, onClick: handleStartRename }]
              : undefined,
          }
        : { label: '…', terminal: true },
    ],
    [
      handleNavigateBack,
      definition,
      canEdit,
      headerRename.editingId,
      headerRename.editValue,
      headerRename.setEditValue,
      headerRename.submitRename,
      headerRename.cancelRename,
      headerRename.isSaving,
      handleStartRename,
    ]
  )

  /**
   * View toggle as two `active` action chips — the sanctioned pattern for a
   * selected/toggle state in `Resource.Header`. The selection survives the
   * toggle, so the inspector keeps showing the module's (disabled) properties
   * in preview and switching back to edit lands where the user left off.
   */
  const headerActions = useMemo(
    (): ResourceAction[] => [
      {
        text: 'Edit',
        icon: Pencil,
        active: mode === 'edit',
        onSelect: () => setParams({ mode: 'edit' }),
      },
      {
        text: 'Preview',
        icon: Eye,
        active: mode === 'preview',
        onSelect: () => setParams({ mode: 'preview' }),
      },
    ],
    [mode, setParams]
  )

  return (
    <Resource>
      {!embedded && <Resource.Header breadcrumbs={breadcrumbs} actions={headerActions} />}
      <div className='flex min-h-0 flex-1'>
        {definition ? (
          <InterfaceCanvas
            workspaceId={workspaceId}
            interfaceId={interfaceId}
            layout={layout}
            mode={mode}
            selectedModuleId={selectedModuleId}
            onSelectModule={handleSelectModule}
            onAddModule={addModule}
            onMoveModule={moveModule}
            onRemoveModule={handleRemoveModule}
            canEdit={canEdit}
          />
        ) : (
          <div className='min-w-0 flex-1' />
        )}
        <ModuleInspector
          workspaceId={workspaceId}
          interfaceId={interfaceId}
          module={selectedModule}
          mode={mode}
          canEdit={canEdit}
          onConfigChange={updateModuleConfig}
          onRemoveModule={handleRemoveModule}
        />
      </div>
    </Resource>
  )
}
