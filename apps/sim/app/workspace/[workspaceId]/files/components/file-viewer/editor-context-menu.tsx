'use client'

import { Scissors } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Clipboard, Duplicate, Search, SelectAll } from '@/components/emcn/icons'
import { useTranslations } from 'next-intl'

interface EditorContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  hasSelection: boolean
  canEdit: boolean
  onCut: () => void
  onCopy: () => void
  onCopyAll: () => void
  onPaste: () => void
  onSelectAll: () => void
  onFind: () => void
}

export function EditorContextMenu({
  isOpen,
  position,
  onClose,
  hasSelection,
  canEdit,
  onCut,
  onCopy,
  onCopyAll,
  onPaste,
  onSelectAll,
  onFind,
}: EditorContextMenuProps) {
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
        sideOffset={2}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {canEdit && (
          <DropdownMenuItem disabled={!hasSelection} onSelect={onCut}>
            <Scissors />
            {t('cut')}
            <DropdownMenuShortcut>{t('x')}</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={!hasSelection} onSelect={onCopy}>
          <Duplicate />
          {t('copy')}
          <DropdownMenuShortcut>{t('c')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyAll}>
          <Duplicate />
          {t('copy_all')}
        </DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onPaste}>
              <Clipboard />
              {t('paste')}
              <DropdownMenuShortcut>{t('v')}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSelectAll}>
          <SelectAll />
          {t('select_all')}
          <DropdownMenuShortcut>{t('a')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onFind}>
          <Search />
          {t('find')}
          <DropdownMenuShortcut>{t('f')}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
