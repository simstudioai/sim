'use client'

import { type RefObject, useState } from 'react'
import type { ShellData } from '@/platform/app/(shell)/_components/model'
import styles from '@/platform/app/(shell)/_components/organization-menu/organization-menu.module.css'
import {
  Avatar,
  Button,
  MenuItem,
  ModalFooter,
  RecipientField,
} from '@/platform/design-system/components'
import { IdentityButton } from '@/platform/design-system/components/identity-button/identity-button'
import { AnchoredPopover } from '@/platform/design-system/components/menu/anchored-popover'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'

interface OrganizationMenuProps {
  anchor: RefObject<HTMLElement | null>
  organization?: ShellData['organization']
  onSettings: () => void
}

export function OrganizationMenu({ anchor, organization, onSettings }: OrganizationMenuProps) {
  const [open, setOpen] = useState(false)
  const [invite, setInvite] = useState(false)
  const name = organization?.name ?? 'Organization'
  return (
    <>
      <AnchoredPopover
        presentation='menu'
        label='Organization menu'
        anchor={anchor}
        open={open}
        onOpenChange={setOpen}
        trigger={(button) => (
          <IdentityButton
            render={button}
            label='Organization menu'
            leading={organization && <Avatar name={name} organization size='inline' />}
            trailingIcon='I064'
          >
            {name}
          </IdentityButton>
        )}
      >
        <div className={styles.menu}>
          <div className={styles.overview}>
            <Avatar name={name} organization size='inline' />
            <div className={styles.copy}>
              <span data-type='T059'>{name}</span>
              {organization && (
                <span data-type='T050'>
                  {organization.memberCount} {organization.memberCount === 1 ? 'member' : 'members'}
                </span>
              )}
            </div>
            <Button
              size='compact'
              disabled={!organization}
              onClick={() => {
                setOpen(false)
                setInvite(true)
              }}
            >
              Invite
            </Button>
          </div>
          <MenuItem
            label='Settings'
            icon='I116'
            onSelect={() => {
              setOpen(false)
              onSettings()
            }}
          />
        </div>
      </AnchoredPopover>
      <OverlayDialog
        open={invite}
        onClose={() => setInvite(false)}
        label='Invite people'
        title='Invite people'
      >
        <RecipientField label='Email addresses' recipients={[]} placeholder='name@company.com' />
        <ModalFooter>
          <Button onClick={() => setInvite(false)}>Cancel</Button>
          <Button variant='primary' disabled>
            Invite
          </Button>
        </ModalFooter>
      </OverlayDialog>
    </>
  )
}
