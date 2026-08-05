'use client'

import { lazy, Suspense, useMemo } from 'react'
import { Skeleton } from '@sim/emcn'
import { File as FileIcon } from '@sim/emcn/icons'
import { ModuleResourcePicker } from '@/components/resources/interface-view/components/module-renderer/components/module-resource-picker'
import { interfaceModuleSeed } from '@/components/resources/interface-view/interface-scope'
import { ResourceEmptyState } from '@/components/resources/resource-empty-state'
import { useResourceOfKind } from '@/components/resources/resource-provider'
import type { InterfaceModule } from '@/lib/interfaces/types'
import { type ResourceGrants, type ResourceSource, shareSource, workspaceSource } from '@/resources'

/**
 * The view pulls in pdf.js, the docx renderer, the xlsx parser, and the pptx
 * sandbox host — none of which this route needs until a file module actually
 * resolves a file. Imported by its deep path rather than the file-view barrel so
 * webpack cannot re-attach those to the interfaces chunk
 * (`.claude/rules/sim-imports.md`, "Code-splitting through barrels").
 */
const FileView = lazy(() =>
  import('@/components/resources/file-view/file-view').then((module) => ({
    default: module.FileView,
  }))
)

/** A file module presents its file. It never offers to change it, in any scope. */
const FILE_MODULE_GRANTS: ResourceGrants = { write: false, run: false }

export interface FileModuleProps {
  module: Extract<InterfaceModule, { type: 'file' }>
  /**
   * Present only where this module may bind its own file — see
   * `ModuleRenderer`. There is no `mode` here: a file renders identically in
   * every scope, so the only thing edit mode ever changed was whether the
   * module could be bound, which is exactly what this prop's presence says.
   */
  onConfigChange?: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
}

/** Placeholder for the view's code-split load. */
function FileModuleSkeleton() {
  return (
    <div className='flex h-full flex-col gap-2 p-3'>
      <Skeleton className='h-[14px] w-[160px]' />
      <Skeleton className='h-full w-full' />
    </div>
  )
}

/**
 * Renders one workspace file with the same view the Files surface uses — PDFs,
 * images, docx, xlsx, pptx, markdown, CSV, and code all paint their real
 * contents rather than a card standing in for them.
 *
 * On a public share the interface's own share source already carries the file's
 * server-resolved, server-authorized metadata, so the module mints a child file
 * share source addressed by `(token, moduleId)` — the identical view works
 * anonymously without ever touching a workspace-authenticated URL. `fileId` is
 * read only on the workspace arm; the share page strips it from every module
 * config before the layout crosses to the browser, so there is no file id in
 * scope to leak.
 *
 * An unbound module authors itself: given `onConfigChange` it renders the same
 * chooser column the empty cell offered a moment earlier, so picking the file
 * happens where the module is rather than in the inspector.
 */
export function FileModule({ module, onConfigChange }: FileModuleProps) {
  const { source: interfaceSource } = useResourceOfKind('interface')
  const { fileId } = module.config
  const moduleId = module.id

  const workspaceId = interfaceSource.via === 'workspace' ? interfaceSource.workspaceId : null
  const token = interfaceSource.via === 'share' ? interfaceSource.token : null
  const moduleSeed = interfaceModuleSeed(interfaceSource, moduleId)
  const fileSeed = moduleSeed?.kind === 'file' ? moduleSeed.seed : null

  const source = useMemo<ResourceSource<'file'> | null>(() => {
    if (token !== null) {
      if (!fileSeed) return null
      return shareSource({ kind: 'file', token, grantId: moduleId, seed: fileSeed })
    }
    if (!workspaceId || !fileId) return null
    return workspaceSource({ kind: 'file', workspaceId, resourceId: fileId })
  }, [token, fileSeed, moduleId, workspaceId, fileId])

  if (!source) {
    if (workspaceId && onConfigChange) {
      return (
        <ModuleResourcePicker
          kind='file'
          workspaceId={workspaceId}
          onSelect={(next) => onConfigChange(moduleId, { fileId: next }, true)}
        />
      )
    }
    return (
      <ResourceEmptyState
        icon={FileIcon}
        description={
          workspaceId ? 'This file is not available.' : 'This file is no longer available.'
        }
      />
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <Suspense fallback={<FileModuleSkeleton />}>
        <FileView
          key={source.cacheScope}
          source={source}
          grants={FILE_MODULE_GRANTS}
          host='panel'
          readOnly
        />
      </Suspense>
    </div>
  )
}
