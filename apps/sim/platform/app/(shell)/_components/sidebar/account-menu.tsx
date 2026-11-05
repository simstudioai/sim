'use client'

import { type RefObject, useState } from 'react'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar.module.css'
import { Avatar, MenuItem } from '@/platform/design-system/components'
import { IdentityButton } from '@/platform/design-system/components/identity-button/identity-button'
import { AnchoredPopover } from '@/platform/design-system/components/menu/anchored-popover'

interface AccountMenuProps {
  anchor: RefObject<HTMLElement | null>
  name: string
  image?: string | null
  onSettings: () => void
  onSignOut: () => void
}

export function AccountMenu({ anchor, name, image, onSettings, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <AnchoredPopover
      presentation='menu'
      label='Account menu'
      anchor={anchor}
      open={open}
      onOpenChange={(next) => setOpen(next)}
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
