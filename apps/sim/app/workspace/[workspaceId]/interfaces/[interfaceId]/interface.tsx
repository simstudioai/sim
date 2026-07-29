'use client'

import { useCallback, useMemo } from 'react'
import { Eye, Panels, Pencil, Send } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { type InterfaceEditing, InterfaceView } from '@/components/resources/interface-view'
import { createEmptyLayout } from '@/lib/interfaces/constants'
import type { InterfaceLayout } from '@/lib/interfaces/types'
import {
  type BreadcrumbItem,
  Resource,
  type ResourceAction,
  ShareModal,
} from '@/app/workspace/[workspaceId]/components'
import { ModuleInspector } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector'
import { useInterfaceEditorState } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/hooks/use-interface-editor-state'
import { useInterfaceLayout } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/hooks/use-interface-layout'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useInterface, useRenameInterface } from '@/hooks/queries/interfaces'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { grantsFromPermissions, type ResourceHost, workspaceSource } from '@/resources'

/** Stable empty layout so the write hook never sees a fresh identity while loading. */
const EMPTY_LAYOUT: InterfaceLayout = createEmptyLayout()

export interface InterfaceProps {
  workspaceId: string
  interfaceId: string
  /**
   * `page` draws the header and owns the URL. `panel` embeds the same editor
   * inside a host that owns the URL — no header, no share dialog, and the view
   * state stays local so the host's address bar is never rewritten.
   */
  host: Extract<ResourceHost, 'page' | 'panel'>
}

/**
 * Interface editor. A thin orchestrator: it resolves the three axes, owns the
 * editor's view-state and the single layout-write choke point in
 * `useInterfaceLayout`, and hands both to {@link InterfaceView}. The view paints
 * the grid; the inspector edits the selected module's config.
 *
 * The split is deliberate. `InterfaceView` is the interface — the grid, the
 * panes, the four module renderers — and is mounted identically by a public
 * share, which has no editor at all. Everything here is authoring: breadcrumbs,
 * rename, share, the properties panel, and the mutations the canvas calls back
 * into. None of it can reach a visitor because none of it is in the view.
 *
 * The inspector is a flex sibling with `shrink-0`, not an overlay — it is
 * always present, exactly like the workflow editor's right panel.
 */
export function Interface({ workspaceId, interfaceId, host }: InterfaceProps) {
  const router = useRouter()

  const { mode, selectedModuleId, isShareOpen, setMode, selectModule, setShareOpen } =
    useInterfaceEditorState(host)

  const { data: definition } = useInterface(workspaceId, interfaceId)

  const userPermissions = useUserPermissionsContext()
  const grants = useMemo(() => grantsFromPermissions(userPermissions), [userPermissions])
  const canEdit = grants.write

  const source = useMemo(
    () => workspaceSource({ kind: 'interface', workspaceId, resourceId: interfaceId }),
    [workspaceId, interfaceId]
  )

  const { addModule, moveModule, removeModule, updateModuleConfig } = useInterfaceLayout({
    workspaceId,
    interfaceId,
    layout: definition?.layout ?? EMPTY_LAYOUT,
    updatedAt: definition?.updatedAt,
    onModuleAdded: selectModule,
  })

  const selectedModule = selectedModuleId
    ? (definition?.layout.modules.find((module) => module.id === selectedModuleId) ?? null)
    : null

  const handleRemoveModule = useCallback(
    (moduleId: string) => {
      removeModule(moduleId)
      if (selectedModuleId === moduleId) selectModule(null)
    },
    [removeModule, selectedModuleId, selectModule]
  )

  const editing = useMemo(
    (): InterfaceEditing => ({
      mode,
      selectedModuleId,
      onSelectModule: selectModule,
      onAddModule: addModule,
      onMoveModule: moveModule,
      onRemoveModule: handleRemoveModule,
      onUpdateModuleConfig: updateModuleConfig,
    }),
    [
      mode,
      selectedModuleId,
      selectModule,
      addModule,
      moveModule,
      handleRemoveModule,
      updateModuleConfig,
    ]
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

  const handleOpenShare = useCallback(() => setShareOpen(true), [setShareOpen])

  const handleShareOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setShareOpen(false)
    },
    [setShareOpen]
  )

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
   * The view toggle as two `active` action chips — the sanctioned pattern for a
   * selected/toggle state in `Resource.Header` — then Share as the primary CTA
   * on the far right. The selection survives the toggle, so the inspector keeps
   * showing the module's (disabled) properties in preview and switching back to
   * edit lands where the user left off.
   */
  const headerActions = useMemo(
    (): ResourceAction[] => [
      { text: 'Edit', icon: Pencil, active: mode === 'edit', onSelect: () => setMode('edit') },
      {
        text: 'Preview',
        icon: Eye,
        active: mode === 'preview',
        onSelect: () => setMode('preview'),
      },
      {
        text: 'Share',
        icon: Send,
        variant: 'primary',
        onSelect: handleOpenShare,
        disabled: !canEdit,
      },
    ],
    [mode, setMode, handleOpenShare, canEdit]
  )

  const isPage = host === 'page'

  return (
    <>
      <Resource>
        {isPage && <Resource.Header breadcrumbs={breadcrumbs} actions={headerActions} />}
        <div className='flex min-h-0 flex-1'>
          <InterfaceView source={source} grants={grants} host={host} editing={editing} />
          <ModuleInspector
            workspaceId={workspaceId}
            module={selectedModule}
            mode={mode}
            canEdit={canEdit}
            onConfigChange={updateModuleConfig}
            onRemoveModule={handleRemoveModule}
          />
        </div>
      </Resource>

      {isPage && isShareOpen && definition ? (
        <ShareModal
          open
          onOpenChange={handleShareOpenChange}
          workspaceId={workspaceId}
          resourceType='interface'
          resourceId={interfaceId}
          resourceName={definition.name}
        />
      ) : null}
    </>
  )
}
