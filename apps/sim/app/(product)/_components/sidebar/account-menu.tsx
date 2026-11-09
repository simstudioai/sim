'use client'

import { type RefObject, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { IdentityButton } from '@sim/emcn/identity-button'
import { MenuItem } from '@sim/emcn/menu/action-menu'
import { AnchoredPopover } from '@sim/emcn/menu/anchored-popover'
import styles from '@/app/(product)/_components/sidebar/sidebar.module.css'

interface AccountMenuProps {
  anchor: RefObject<HTMLElement | null>
  name: string
  image?: string | null
  onSettings: () => void
  onSignOut: () => void
  onOpen?: () => void
}

export function AccountMenu({
  anchor,
  name,
  image,
  onSettings,
  onSignOut,
  onOpen,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <AnchoredPopover
      presentation='menu'
      label='Account menu'
      triggerLabel={name}
      anchor={anchor}
      open={open}
      onOpenChange={(next) => {
        if (next) onOpen?.()
        setOpen(next)
      }}
      trigger={(button) => (
        <IdentityButton
          render={button}
          label={name}
          leading={<Avatar name={name} src={image ?? undefined} size='inline' />}
        >
          {name}
        </IdentityButton>
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
        <MenuItem
          label='Sign out'
          icon='I132'
          onSelect={() => {
            setOpen(false)
            onSignOut()
          }}
        />
      </div>
    </AnchoredPopover>
  )
}
