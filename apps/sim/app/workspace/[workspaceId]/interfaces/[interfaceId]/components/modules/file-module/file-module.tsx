'use client'

import { lazy, Suspense } from 'react'
import { Skeleton } from '@sim/emcn'
import { File as FileIcon } from '@sim/emcn/icons'
import type { InterfaceModule } from '@/lib/interfaces'
import { ModuleEmptyState } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/module-empty-state'
import type { InterfaceMode } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/search-params'
import { useWorkspaceFileRecord } from '@/hooks/queries/workspace-files'

/**
 * The viewer pulls in pdf.js, the docx renderer, the xlsx parser, and the pptx
 * sandbox host — none of which this route needs until a file module actually
 * resolves a file. Imported by its deep path rather than the Files barrel so
 * webpack cannot re-attach those to the interfaces chunk
 * (`.claude/rules/sim-imports.md`, "Code-splitting through barrels").
 */
const FileViewer = lazy(() =>
  import('@/app/workspace/[workspaceId]/files/components/file-viewer/file-viewer').then(
    (module) => ({ default: module.FileViewer })
  )
)

export interface FileModuleProps {
  workspaceId: string
  /** Part of the uniform module contract; the viewer reads by file id alone. */
  interfaceId: string
  module: Extract<InterfaceModule, { type: 'file' }>
  /** A file renders identically in both modes; only the unconfigured copy differs. */
  mode: InterfaceMode
}

/** Placeholder for both the record fetch and the viewer's own code-split load. */
function FileModuleSkeleton() {
  return (
    <div className='flex h-full flex-col gap-2 p-3'>
      <Skeleton className='h-[14px] w-[160px]' />
      <Skeleton className='h-full w-full' />
    </div>
  )
}

/**
 * Renders one workspace file with the same viewer the Files surface uses —
 * PDFs, images, docx, xlsx, pptx, markdown, CSV, and code all paint their real
 * contents rather than a card standing in for them.
 *
 * `readOnly` selects the viewer's non-editing path (the one the public share
 * page uses), so nothing here offers to change the file: no autosave, no
 * toolbar, no editor affordances in either mode.
 */
export function FileModule({ workspaceId, module, mode }: FileModuleProps) {
  const { fileId } = module.config
  /**
   * Selects the one record out of the shared active-files query, so an
   * unrelated upload or rename elsewhere in the workspace does not re-render
   * this module.
   */
  const fileQuery = useWorkspaceFileRecord(workspaceId, fileId ?? '')

  if (!fileId) {
    return (
      <ModuleEmptyState
        icon={FileIcon}
        message={
          mode === 'edit' ? 'Pick a file in the properties panel.' : 'This file is not available.'
        }
      />
    )
  }

  if (fileQuery.isError) {
    return <ModuleEmptyState icon={FileIcon} message='This file could not be loaded.' />
  }

  if (fileQuery.isPending) {
    return <FileModuleSkeleton />
  }

  const file = fileQuery.data
  if (!file) {
    return <ModuleEmptyState icon={FileIcon} message='This file is no longer in the workspace.' />
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <Suspense fallback={<FileModuleSkeleton />}>
        <FileViewer key={file.id} file={file} workspaceId={workspaceId} canEdit={false} readOnly />
      </Suspense>
    </div>
  )
}
