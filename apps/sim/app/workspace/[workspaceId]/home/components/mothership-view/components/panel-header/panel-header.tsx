'use client'

import { type ComponentProps, type ReactNode, useMemo } from 'react'
import { Button, chipGeometryClass, Tooltip } from '@/components/emcn'
import { Columns3, Eye, Pencil } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import {
  PANEL_HEADER_GAP_CLASS,
  PANEL_ICON_BUTTON_CLASS,
  PANEL_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/panel-header/panel-controls'
import { PanelTrailingControls } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/panel-header/panel-trailing-controls'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

const PREVIEW_MODE_ICONS = {
  editor: Columns3,
  split: Eye,
  preview: Pencil,
} satisfies Record<PreviewMode, (props: ComponentProps<typeof Eye>) => ReactNode>

const PREVIEW_MODE_LABELS: Record<PreviewMode, string> = {
  editor: 'Split Mode',
  split: 'Preview Mode',
  preview: 'Edit Mode',
}

/**
 * Builds a `type:id` -> current name lookup from live query data so the panel
 * title always reflects the latest name even after a rename.
 */
function useResourceNameLookup(workspaceId: string): Map<string, string> {
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases } = useKnowledgeBasesQuery(workspaceId)
  const { data: folders = [] } = useFolders(workspaceId)

  return useMemo(() => {
    const map = new Map<string, string>()
    for (const w of workflows) map.set(`workflow:${w.id}`, w.name)
    for (const t of tables) map.set(`table:${t.id}`, t.name)
    for (const f of files) map.set(`file:${f.id}`, f.name)
    for (const kb of knowledgeBases ?? []) map.set(`knowledgebase:${kb.id}`, kb.name)
    for (const folder of folders) map.set(`folder:${folder.id}`, folder.name)
    return map
  }, [workflows, tables, files, knowledgeBases, folders])
}

interface PanelHeaderProps {
  workspaceId: string
  /** The staged resource the panel is showing. */
  resource: MothershipResource
  /** Per-type panel actions (run, export, download). */
  actions?: ReactNode
  previewMode?: PreviewMode
  onCyclePreviewMode?: () => void
  /**
   * Controls rendered before the title (e.g. the sidebar toggle and compact
   * chat switcher while the chat pane is hidden).
   */
  leading?: ReactNode
}

/**
 * The resource panel's title bar. There is no tab strip — the panel shows one
 * resource at a time, following the Mothership conversation — so the header
 * carries the staged resource's identity (icon + live name) plus its actions
 * and the close control.
 */
export function PanelHeader({
  workspaceId,
  resource,
  actions,
  previewMode,
  onCyclePreviewMode,
  leading,
}: PanelHeaderProps) {
  const PreviewModeIcon = PREVIEW_MODE_ICONS[previewMode ?? 'split']
  const nameLookup = useResourceNameLookup(workspaceId)
  const config = getResourceConfig(resource.type)
  const displayName = nameLookup.get(`${resource.type}:${resource.id}`) ?? resource.title

  return (
    <div
      className={cn(
        'flex h-[44px] shrink-0 items-center border-[var(--border)] border-b px-4',
        PANEL_HEADER_GAP_CLASS
      )}
    >
      {leading}
      <div className='flex min-w-0 flex-1 items-center overflow-hidden'>
        {/* Same title treatment as Resource.Header (chip geometry, 14px icon,
            body text) so every staged view's header reads identically. */}
        <span className={cn(chipGeometryClass, 'inline-flex min-w-0 cursor-default justify-start')}>
          {config.renderTabIcon(resource, 'size-[14px] shrink-0')}
          <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>{displayName}</span>
        </span>
      </div>
      <div className={cn('ml-auto flex shrink-0 items-center', PANEL_HEADER_GAP_CLASS)}>
        {actions}
        {previewMode && onCyclePreviewMode && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='subtle'
                onClick={onCyclePreviewMode}
                className={PANEL_ICON_BUTTON_CLASS}
                aria-label='Cycle preview mode'
              >
                <PreviewModeIcon className={PANEL_ICON_CLASS} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='bottom'>
              <p>{PREVIEW_MODE_LABELS[previewMode]}</p>
            </Tooltip.Content>
          </Tooltip.Root>
        )}
        <PanelTrailingControls closeLabel={`Close ${displayName}`} />
      </div>
    </div>
  )
}
