'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Upload,
} from '@sim/emcn'
import { Database, Download, Duplicate, Pencil, Trash } from '@sim/emcn/icons'
import { useTranslations } from 'next-intl'

interface TableContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCopyId?: () => void
  onDelete?: () => void
  onViewSchema?: () => void
  onRename?: () => void
  onImportCsv?: () => void
  onExportCsv?: () => void
  disableDelete?: boolean
  disableRename?: boolean
  disableImport?: boolean
  disableExport?: boolean
  menuRef?: React.RefObject<HTMLDivElement | null>
}

export function TableContextMenu({
  isOpen,
  position,
  onClose,
  onCopyId,
  onDelete,
  onViewSchema,
  onRename,
  onImportCsv,
  onExportCsv,
  disableDelete = false,
  disableRename = false,
  disableImport = false,
  disableExport = false,
}: TableContextMenuProps) {
  const t = useTranslations('auto')
  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
          tabIndex={-1}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={4}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {onViewSchema && (
          <DropdownMenuItem onSelect={onViewSchema}>
            <Database />
            {t('view_schema')}
          </DropdownMenuItem>
        )}
        {onRename && (
          <DropdownMenuItem disabled={disableRename} onSelect={onRename}>
            <Pencil />
            {t('rename')}
          </DropdownMenuItem>
        )}
        {onImportCsv && (
          <DropdownMenuItem disabled={disableImport} onSelect={onImportCsv}>
            <Upload />
            {t('import_csv')}
          </DropdownMenuItem>
        )}
        {onExportCsv && (
          <DropdownMenuItem disabled={disableExport} onSelect={onExportCsv}>
            <Download />
            {t('export_csv')}
          </DropdownMenuItem>
        )}
        {(onViewSchema || onRename || onImportCsv || onExportCsv) && (onCopyId || onDelete) && (
          <DropdownMenuSeparator />
        )}
        {onCopyId && (
          <DropdownMenuItem onSelect={onCopyId}>
            <Duplicate />
            {t('copy_id')}
          </DropdownMenuItem>
        )}
        {onCopyId && onDelete && <DropdownMenuSeparator />}
        {onDelete && (
          <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
            <Trash />
            {t('delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
