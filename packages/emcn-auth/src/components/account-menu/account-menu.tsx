'use client'

import { Menu } from '@base-ui/react/menu'
import { Icon } from '@sim/emcn/icon'
import { clsx } from 'clsx'
import styles from '#auth/components/account-menu/account-menu.module.css'
import { AuthIdentityContent } from '#auth/components/identity/identity'
import popup from '#auth/components/popup/popup.shared.module.css'
import { useAuthPortal } from '#auth/components/root/context'

interface AuthAccountMenuProps {
  email: string
  disabled?: boolean
  pending?: boolean
  onSwitch: () => void
}

/** Keeps account actions in the Auth portal; the host performs sign-out through onSwitch. */
export function AuthAccountMenu({ email, disabled, pending, onSwitch }: AuthAccountMenuProps) {
  const portal = useAuthPortal()
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className={styles.accountTrigger} disabled={disabled}>
        <AuthIdentityContent email={email} label={pending ? 'Signing out…' : 'Signed in as'} />
        <Icon name='I051' />
      </Menu.Trigger>
      {portal && (
        <Menu.Portal container={portal}>
          <Menu.Positioner
            align='start'
            sideOffset={4}
            collisionPadding={16}
            className={popup.positioner}
          >
            <Menu.Popup className={clsx(popup.menu, styles.menu)}>
              <Menu.Group>
                <Menu.GroupLabel className={popup.menuLabel}>{email}</Menu.GroupLabel>
                <Menu.Item className={popup.menuRow} disabled={disabled} onClick={onSwitch}>
                  {pending ? 'Signing out…' : 'Use another account'}
                </Menu.Item>
              </Menu.Group>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      )}
    </Menu.Root>
  )
}
