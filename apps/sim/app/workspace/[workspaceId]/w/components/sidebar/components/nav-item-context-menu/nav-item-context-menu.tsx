'use client'

import { useTranslations } from 'next-intl'
import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'

interface NavItemContextMenuProps {
  /**
   * Whether the context menu is open
   */
  isOpen: boolean
  /**
   * Position of the context menu
   */
  position: { x: number; y: number }
  /**
   * Ref for the menu element
   */
  menuRef: React.RefObject<HTMLDivElement | null>
  /**
   * Callback when menu should close
   */
  onClose: () => void
  /**
   * Callback when open in new tab is clicked
   */
  onOpenInNewTab: () => void
  /**
   * Callback when copy link is clicked
   */
  onCopyLink: () => void
}

/**
 * Context menu component for sidebar navigation items.
 * Displays navigation-appropriate options (open in new tab, copy link) in a popover at the right-click position.
 */
export function NavItemContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onCopyLink,
}: NavItemContextMenuProps) {
  const t = useTranslations('workflows.context_menu.buttons')
  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant='secondary'
      size='sm'
      colorScheme='inverted'
    >
      <PopoverAnchor
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: '1px',
          height: '1px',
        }}
      />
      <PopoverContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
        <PopoverItem
          onClick={() => {
            onOpenInNewTab()
            onClose()
          }}
        >
          {t('open_in_new_tab')}
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onCopyLink()
            onClose()
          }}
        >
          {t('copy_link')}
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
