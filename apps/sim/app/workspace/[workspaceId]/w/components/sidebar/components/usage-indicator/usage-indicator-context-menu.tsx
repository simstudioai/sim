'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'

interface UsageIndicatorContextMenuProps {
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
   * Menu items configuration based on plan and permissions
   */
  menuItems: UsageMenuItems
}

interface UsageMenuItems {
  /**
   * Show "Set usage limit" option
   */
  showSetLimit: boolean
  /**
   * Show "Upgrade to Pro" option (free users)
   */
  showUpgradeToPro: boolean
  /**
   * Show "Upgrade to Team" option (free or pro users)
   */
  showUpgradeToTeam: boolean
  /**
   * Show "Manage seats" option (team admins)
   */
  showManageSeats: boolean
  /**
   * Show "Upgrade to Enterprise" option
   */
  showUpgradeToEnterprise: boolean
  /**
   * Show "Contact support" option (enterprise users)
   */
  showContactSupport: boolean
  /**
   * Callbacks
   */
  onSetLimit?: () => void
  onUpgradeToPro?: () => void
  onUpgradeToTeam?: () => void
  onManageSeats?: () => void
  onUpgradeToEnterprise?: () => void
  onContactSupport?: () => void
}

/**
 * Context menu component for usage indicator.
 * Displays plan-appropriate options in a popover at the right-click position.
 */
export function UsageIndicatorContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  menuItems,
}: UsageIndicatorContextMenuProps) {
  const {
    showSetLimit,
    showUpgradeToPro,
    showUpgradeToTeam,
    showManageSeats,
    showUpgradeToEnterprise,
    showContactSupport,
    onSetLimit,
    onUpgradeToPro,
    onUpgradeToTeam,
    onManageSeats,
    onUpgradeToEnterprise,
    onContactSupport,
  } = menuItems

  const hasLimitSection = showSetLimit
  const hasUpgradeSection =
    showUpgradeToPro || showUpgradeToTeam || showUpgradeToEnterprise || showContactSupport
  const hasTeamSection = showManageSeats

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
      <PopoverContent ref={menuRef} align='start' side='top' sideOffset={4}>
        {/* Limit management section */}
        {showSetLimit && onSetLimit && (
          <PopoverItem
            onClick={() => {
              onSetLimit()
              onClose()
            }}
          >
            Set usage limit
          </PopoverItem>
        )}

        {/* Team management section */}
        {hasLimitSection && hasTeamSection && <PopoverDivider />}
        {showManageSeats && onManageSeats && (
          <PopoverItem
            onClick={() => {
              onManageSeats()
              onClose()
            }}
          >
            Manage seats
          </PopoverItem>
        )}

        {/* Upgrade section */}
        {(hasLimitSection || hasTeamSection) && hasUpgradeSection && <PopoverDivider />}
        {showUpgradeToPro && onUpgradeToPro && (
          <PopoverItem
            onClick={() => {
              onUpgradeToPro()
              onClose()
            }}
          >
            Upgrade to Pro
          </PopoverItem>
        )}
        {showUpgradeToTeam && onUpgradeToTeam && (
          <PopoverItem
            onClick={() => {
              onUpgradeToTeam()
              onClose()
            }}
          >
            Upgrade to Team
          </PopoverItem>
        )}
        {showUpgradeToEnterprise && onUpgradeToEnterprise && (
          <PopoverItem
            onClick={() => {
              onUpgradeToEnterprise()
              onClose()
            }}
          >
            Upgrade to Enterprise
          </PopoverItem>
        )}
        {showContactSupport && onContactSupport && (
          <PopoverItem
            onClick={() => {
              onContactSupport()
              onClose()
            }}
          >
            Contact support
          </PopoverItem>
        )}
      </PopoverContent>
    </Popover>
  )
}
