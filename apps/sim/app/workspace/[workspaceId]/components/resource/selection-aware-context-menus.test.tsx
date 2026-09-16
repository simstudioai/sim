import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  DropdownMenu: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => (
    <span aria-disabled={disabled}>{children}</span>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  Upload: () => null,
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Content: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
}))

vi.mock('@sim/emcn/icons', () => ({
  Database: () => null,
  Download: () => null,
  Duplicate: () => null,
  Eye: () => null,
  FolderInput: () => null,
  Pencil: () => null,
  Pin: () => null,
  Plus: () => null,
  SquareArrowUpRight: () => null,
  TagIcon: () => null,
  Trash: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/components/folders', () => ({
  renderMoveOptions: () => <span>Destination</span>,
}))

vi.mock('@/app/workspace/[workspaceId]/components/folders/move-options', () => ({
  renderMoveOptions: () => <span>Destination</span>,
}))

import { FolderContextMenu } from '@/app/workspace/[workspaceId]/components/folders/folder-context-menu'
import { ChunkContextMenu } from '@/app/workspace/[workspaceId]/knowledge/[id]/[documentId]/components/chunk-context-menu/chunk-context-menu'
import { DocumentContextMenu } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/document-context-menu/document-context-menu'
import { KnowledgeBaseContextMenu } from '@/app/workspace/[workspaceId]/knowledge/components/knowledge-base-context-menu/knowledge-base-context-menu'
import { TableContextMenu } from '@/app/workspace/[workspaceId]/tables/components/table-context-menu/table-context-menu'

const POSITION = { x: 0, y: 0 }
const MOVE_OPTIONS = [{ value: '__root__', label: 'Root', children: [] }]

describe('selection-aware resource context menus', () => {
  it('hides a protected mixed-folder delete while retaining movement', () => {
    const menu = renderToStaticMarkup(
      <FolderContextMenu
        isOpen
        position={POSITION}
        onClose={() => {}}
        onOpen={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onMove={() => {}}
        onTogglePin={() => {}}
        pinned={false}
        canEdit
        canDelete={false}
        moveOptions={MOVE_OPTIONS}
        selectedCount={2}
      />
    )
    expect(menu).toContain('Move 2 items')
    expect(menu).not.toContain('Delete')
  })

  it('explains a blocked folder cascade while retaining ordinary folder actions', () => {
    const menu = renderToStaticMarkup(
      <FolderContextMenu
        isOpen
        position={POSITION}
        onClose={() => {}}
        onOpen={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onTogglePin={() => {}}
        pinned={false}
        canEdit
        deleteDisabledReason='Delete the search knowledge base first'
        selectedCount={1}
      />
    )
    expect(menu).toContain('Rename')
    expect(menu).toContain('Delete the search knowledge base first')
    expect(menu).toContain('aria-disabled="true"')
  })
  it('limits a multi-table menu to actions that can target the selection', () => {
    const menu = renderToStaticMarkup(
      <TableContextMenu
        isOpen
        position={POSITION}
        onClose={() => {}}
        onCopyId={() => {}}
        onTogglePin={() => {}}
        onDelete={() => {}}
        onViewSchema={() => {}}
        onRename={() => {}}
        onImportCsv={() => {}}
        onExportCsv={() => {}}
        onMove={() => {}}
        moveOptions={MOVE_OPTIONS}
        selectedCount={3}
      />
    )

    expect(menu).toContain('Move 3 items')
    expect(menu).toContain('Delete 3 items')
    expect(menu).not.toContain('View Schema')
    expect(menu).not.toContain('Rename')
    expect(menu).not.toContain('Copy ID')
    expect(menu).not.toContain('Pin')
  })

  it('limits a multi-base menu to actions that can target the selection', () => {
    const menu = renderToStaticMarkup(
      <KnowledgeBaseContextMenu
        isOpen
        position={POSITION}
        onClose={() => {}}
        onOpenInNewTab={() => {}}
        onViewTags={() => {}}
        onCopyId={() => {}}
        onTogglePin={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onMove={() => {}}
        moveOptions={MOVE_OPTIONS}
        selectedCount={2}
      />
    )

    expect(menu).toContain('Move 2 items')
    expect(menu).toContain('Delete 2 items')
    expect(menu).not.toContain('Open in new tab')
    expect(menu).not.toContain('View tags')
    expect(menu).not.toContain('Copy ID')
    expect(menu).not.toContain('Pin')
    expect(menu).not.toContain('Edit')
  })

  it('uses the same group-action contract when a selected folder opens the menu', () => {
    const menu = renderToStaticMarkup(
      <FolderContextMenu
        isOpen
        position={POSITION}
        onClose={() => {}}
        onOpen={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onCopyId={() => {}}
        onMove={() => {}}
        onTogglePin={() => {}}
        pinned={false}
        moveOptions={MOVE_OPTIONS}
        canEdit
        selectedCount={4}
      />
    )

    expect(menu).toContain('Move 4 items')
    expect(menu).toContain('Delete 4 items')
    expect(menu).not.toContain('Open')
    expect(menu).not.toContain('Rename')
    expect(menu).not.toContain('Copy ID')
    expect(menu).not.toContain('Pin')
  })

  it('explains when a read-only multi-folder selection has no actions', () => {
    const menu = renderToStaticMarkup(
      <FolderContextMenu
        isOpen
        position={POSITION}
        onClose={() => {}}
        onOpen={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onTogglePin={() => {}}
        pinned={false}
        canEdit={false}
        selectedCount={2}
      />
    )

    expect(menu).toContain('No actions available')
    expect(menu).not.toContain('Open')
    expect(menu).not.toContain('Delete')
  })

  it('counts only the documents affected by a mixed-selection toggle', () => {
    const menu = renderToStaticMarkup(
      <DocumentContextMenu
        isOpen
        position={POSITION}
        onClose={() => {}}
        hasDocument
        selectedCount={25}
        enabledCount={7}
        disabledCount={18}
        onToggleEnabled={() => {}}
        onDelete={() => {}}
      />
    )

    expect(menu).toContain('Enable 18 items')
    expect(menu).toContain('Delete 25 items')
  })

  it('does not overstate an unknown select-all toggle count', () => {
    const menu = renderToStaticMarkup(
      <DocumentContextMenu
        isOpen
        position={POSITION}
        onClose={() => {}}
        hasDocument
        selectedCount={25}
        enabledCount={25}
        disabledCount={25}
        hasExactToggleCount={false}
        onToggleEnabled={() => {}}
      />
    )

    expect(menu).toContain('Enable selected items')
    expect(menu).not.toContain('Enable 25 items')
  })

  it('counts only the chunks affected by a multi-selection toggle', () => {
    const menu = renderToStaticMarkup(
      <ChunkContextMenu
        isOpen
        position={POSITION}
        onClose={() => {}}
        hasChunk
        selectedCount={3}
        enabledCount={3}
        onToggleEnabled={() => {}}
        onDelete={() => {}}
      />
    )

    expect(menu).toContain('Disable 3 items')
    expect(menu).toContain('Delete 3 items')
  })
})
