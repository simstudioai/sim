'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Duplicate, SquareArrowUpRight } from '@/components/emcn/icons'
import { useTranslations } from 'next-intl'

interface NavItemContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  onOpenInNewTab: () => void
  onCopyLink: () => void
}

export function NavItemContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onCopyLink,
}: NavItemContextMenuProps) {
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
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={menuRef}
        align='start'
        side='bottom'
        sideOffset={4}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem
          onSelect={() => {
            onOpenInNewTab()
            onClose()
          }}
        >
          <SquareArrowUpRight />
          {t('open_in_new_tab')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onCopyLink()
            onClose()
          }}
        >
          <Duplicate />
          {t('copy_link')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
