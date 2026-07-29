'use client'

import { InterfaceCanvas } from '@/components/resources/interface-view/components/interface-canvas'
import { InterfacePreviewGrid } from '@/components/resources/interface-view/components/interface-preview-grid'
import { ResourceProvider } from '@/components/resources/resource-provider'
import type {
  InterfaceCell,
  InterfaceLayout,
  InterfaceMode,
  InterfaceModule,
  InterfaceModuleType,
} from '@/lib/interfaces/types'
import { useInterface } from '@/hooks/queries/interfaces'
import type { ResourceGrants, ResourceHost, ResourceSource } from '@/resources'

/**
 * Everything the surrounding editor wires into the authoring grid.
 *
 * Present only where the mounting surface draws an editor — the interface
 * detail page and the mothership panel. Absent means the view renders the page
 * as it ships: nothing to select, drag, add, or remove, because none of that
 * chrome is mounted rather than mounted and switched off.
 *
 * One optional object rather than six loose props, so "is this authorable" is a
 * single presence check instead of a convention about which props travel
 * together.
 */
export interface InterfaceEditing {
  mode: InterfaceMode
  /** `null` = nothing selected. */
  selectedModuleId: string | null
  onSelectModule: (moduleId: string | null) => void
  onAddModule: (type: InterfaceModuleType, cell: InterfaceCell) => void
  onMoveModule: (moduleId: string, cell: InterfaceCell) => void
  onRemoveModule: (moduleId: string) => void
  /**
   * Applies a config edit a module made about itself — binding its resource,
   * renaming a form field — so the first edits a builder reaches for happen on
   * the module rather than only in the inspector. Same choke point the
   * inspector writes through, so both paths debounce and validate identically.
   */
  onUpdateModuleConfig: (
    moduleId: string,
    config: InterfaceModule['config'],
    isValid: boolean
  ) => void
}

export interface InterfaceViewProps {
  source: ResourceSource<'interface'>
  grants: ResourceGrants
  host: ResourceHost
  editing?: InterfaceEditing
}

/**
 * One interface, wherever it is mounted: the editor page, the mothership panel,
 * or a public share.
 *
 * The layout is resolved from the source and nowhere else — a share carries the
 * server-pruned layout in its seed (the page proved every module before it
 * rendered anything), a workspace source reads the interface detail query. Both
 * arms then render the identical grid, so the preview a builder sees is the
 * page a visitor gets.
 */
export function InterfaceView({ source, grants, host, editing }: InterfaceViewProps) {
  const workspaceDefinition = useInterface(
    source.via === 'workspace' ? source.workspaceId : undefined,
    source.via === 'workspace' ? source.resourceId : undefined
  )

  const layout: InterfaceLayout | null =
    source.via === 'share' ? source.seed.layout : (workspaceDefinition.data?.layout ?? null)

  /**
   * Whether the interactive modules are live for this viewer.
   *
   * One expression for both scopes: every interface run — workspace or share —
   * executes the deployed workflow through a route that authorizes at `read`,
   * so the grant alone decides. Anything narrower made a workspace reader less
   * capable than an anonymous visitor holding a link to the same interface.
   */
  const canRun = grants.run

  return (
    <ResourceProvider source={source} grants={grants} host={host}>
      {layout === null ? (
        <div className='min-w-0 flex-1' />
      ) : editing ? (
        <InterfaceCanvas layout={layout} canEdit={grants.write} canRun={canRun} {...editing} />
      ) : (
        <InterfacePreviewGrid layout={layout} canRun={canRun} />
      )}
    </ResourceProvider>
  )
}
