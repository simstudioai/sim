'use client'

import { type RefObject, useState } from 'react'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar.module.css'
import { Avatar } from '@/platform/design-system/components/avatar/avatar'
import { IdentityButton } from '@/platform/design-system/components/identity-button/identity-button'
import { MenuItem } from '@/platform/design-system/components/menu/action-menu'
import { AnchoredPopover } from '@/platform/design-system/components/menu/anchored-popover'
import { Tooltip } from '@/platform/design-system/components/tooltip/tooltip'

interface AccountMenuProps {
  anchor: RefObject<HTMLElement | null>
  name: string
  image: string | null
  /** The rail shows the photo alone, and names the account in a tooltip. */
  iconOnly: boolean
  canSignOut: boolean
  onOpen: () => void
  onSettings: () => void
  onSignOut: () => void
}

export function AccountMenu({
  anchor,
  name,
  image,
  iconOnly,
  canSignOut,
  onOpen,
  onSettings,
  onSignOut,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const accountLabel = `${name}, account menu`
  return (
    <AnchoredPopover
      presentation='menu'
      label='Account menu'
      triggerLabel={accountLabel}
      anchor={anchor}
      open={open}
      onOpenChange={(next) => {
        if (next) onOpen()
        setOpen(next)
      }}
      trigger={(button) => (
        <Tooltip label={name} enabled={iconOnly}>
          <IdentityButton
            render={button}
            label={accountLabel}
            leading={<Avatar name={name} src={image ?? undefined} size='inline' decorative />}
          >
            {iconOnly ? undefined : name}
          </IdentityButton>
        </Tooltip>
      )}
    >
      <div className={styles.accountMenu}>
        <MenuItem
          label='Settings'
          icon='I116'
          onSelect={() => {
            setOpen(false)
            onSettings()
          }}
        />
        {canSignOut && (
          <MenuItem
            label='Sign out'
            icon='I132'
            onSelect={() => {
              setOpen(false)
              onSignOut()
            }}
          />
        )}
      </div>
    </AnchoredPopover>
  )
}
