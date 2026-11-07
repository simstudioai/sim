'use client'

import { type RefObject, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { IdentityButton } from '@sim/emcn/identity-button'
import { MenuItem } from '@sim/emcn/menu/action-menu'
import { AnchoredPopover } from '@sim/emcn/menu/anchored-popover'
import { Tooltip } from '@sim/emcn/tooltip'
import styles from '@/platform/embedded/app/(shell)/_components/sidebar/sidebar.module.css'

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
