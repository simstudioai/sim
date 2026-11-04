'use client'

import { type RefObject, useState } from 'react'
import { ComponentRecipe } from '@/platform/design-system/catalog/component-recipe'
import {
  Avatar,
  Button,
  Icon,
  MenuItem,
  ModalFooter,
  RecipientField,
} from '@/platform/design-system/components'
import { AnchoredPopover } from '@/platform/design-system/components/anchored-popover'
import { OverlayDialog } from '@/platform/design-system/components/overlay-dialog'
import { usePlatformTheme } from '@/platform/design-system/components/product-surface'
import styles from '@/platform/design-system/features/shell/shell.module.css'
import type { ShellData } from '@/platform/design-system/models/shell'

interface OrganizationControlProps {
  anchor: RefObject<HTMLElement | null>
  organization?: ShellData['organization']
  onSettings: () => void
}

export function OrganizationControl({
  anchor,
  organization,
  onSettings,
}: OrganizationControlProps) {
  const [open, setOpen] = useState(false)
  const light = usePlatformTheme() === 'light'
  const [invite, setInvite] = useState<'editing' | 'preview' | null>(null)
  const name = organization?.name ?? 'Organization'
  return (
    <>
      <AnchoredPopover
        presentation='menu'
        label='Organization menu'
        anchor={anchor}
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button type='button' className={styles.identity} data-type='T043'>
            {organization && <Avatar name={name} organization='small' />}
            <span className={styles.label}>{name}</span>
            <span className={styles.chevron}>
              <Icon name='I064' />
            </span>
          </button>
        }
      >
        <div className={styles.orgMenu}>
          <ComponentRecipe
            recipe={light ? 'C0799' : 'C0798'}
            slots={{
              avatar: <Avatar name={name} organization='large' />,
              organizationName: name,
              memberCount: organization
                ? `${organization.memberCount} ${organization.memberCount === 1 ? 'member' : 'members'}`
                : '',
              button: (
                <Button
                  size='compact'
                  disabled={!organization}
                  onClick={() => {
                    setOpen(false)
                    setInvite('editing')
                  }}
                >
                  Invite
                </Button>
              ),
            }}
          />
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
        open={invite !== null}
        onClose={() => setInvite(null)}
        label='Invite people'
        title='Invite people'
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            const email = event.currentTarget.querySelector('input')
            if (!email?.value.trim()) {
              email?.focus()
              return
            }
            setInvite('preview')
          }}
        >
          <RecipientField label='Email addresses' recipients={[]} placeholder='name@company.com' />
          {invite === 'preview' && (
            <p role='status' data-type='T060'>
              Email delivery is disabled in this preview.
            </p>
          )}
          <ModalFooter>
            <Button onClick={() => setInvite(null)}>Cancel</Button>
            <Button variant='primary' submit>
              Invite
            </Button>
          </ModalFooter>
        </form>
      </OverlayDialog>
    </>
  )
}
