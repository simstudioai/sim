'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import Link from 'next/link'
import { toast } from '@/lib/toast/sink'
import { DetailHeader } from '@/app/(product)/_components/settings-parts/settings-parts'
import { AuthorizedApps } from '@/app/(product)/o/[organizationId]/settings/_components/sections/account/authorized-apps'
import { DeleteAccount } from '@/app/(product)/o/[organizationId]/settings/_components/sections/account/delete-account'
import { OrganizationAccounts } from '@/app/(product)/o/[organizationId]/settings/_components/sections/account/organization-accounts'
import { signOutAndLeave } from '@/platform/lib/data/session'
import { useAccountEmail, useResetPasswordAction } from '@/platform/shared/account'

interface AccountSettingsRowsProps {
  /** Leaves Reset password, Sign out and Delete account unavailable, where nothing could run them. */
  actionsUnavailable?: boolean
  authorizedAppsHref: string
  organizationAccountsHref: string
}

type AccountView = 'authorized-apps' | 'organization-accounts'

interface AccountSettingsSubviewProps {
  view: AccountView
  backHref: string
}

const VIEWS = {
  'authorized-apps': {
    title: 'Authorized apps',
    description: 'Review and revoke apps that can act on your account',
  },
  'organization-accounts': {
    title: 'Connected organization accounts',
    description: 'Disconnect accounts you connected for an organization, including ones you left',
  },
} as const

/** A signed-in viewer's account sub-view; the route opens it only for a signed-in viewer. */
export function AccountSettingsSubview({ view, backHref }: AccountSettingsSubviewProps) {
  return (
    <>
      <DetailHeader
        backLabel='Preferences'
        backHref={backHref}
        title={VIEWS[view].title}
        description={VIEWS[view].description}
      />
      {view === 'authorized-apps' ? <AuthorizedApps /> : <OrganizationAccounts />}
    </>
  )
}

/** A signed-in viewer's account rows; the route renders them only for a signed-in viewer. */
export function AccountSettingsRows({
  actionsUnavailable,
  authorizedAppsHref,
  organizationAccountsHref,
}: AccountSettingsRowsProps) {
  const email = useAccountEmail()
  const resetPassword = useResetPasswordAction()
  const [dialog, setDialog] = useState<'reset' | 'delete' | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  return (
    <SettingsSection title='Account'>
      <SettingsRow
        label={VIEWS['authorized-apps'].title}
        description={VIEWS['authorized-apps'].description}
      >
        <Button size='compact' render={<Link href={authorizedAppsHref} />}>
          Manage
        </Button>
      </SettingsRow>
      <SettingsRow
        label={VIEWS['organization-accounts'].title}
        description={VIEWS['organization-accounts'].description}
      >
        <Button size='compact' render={<Link href={organizationAccountsHref} />}>
          Manage
        </Button>
      </SettingsRow>
      <SettingsRow label='Reset password' description='Email yourself a password reset link'>
        <Button
          size='compact'
          disabled={!email || actionsUnavailable}
          onClick={() => setDialog('reset')}
        >
          Reset password
        </Button>
      </SettingsRow>
      <SettingsRow label='Sign out' description='End your session on this device'>
        <Button
          size='compact'
          disabled={actionsUnavailable || signingOut}
          onClick={() => {
            setSigningOut(true)
            void signOutAndLeave('/login?fromLogout=true').then((left) => {
              if (!left) {
                setSigningOut(false)
                toast.error('Failed to sign out. Please try again.')
              }
            })
          }}
        >
          Sign out
        </Button>
      </SettingsRow>
      <SettingsRow
        label='Delete account'
        description='Permanently delete your account and everything it owns'
      >
        <Button
          variant='quiet'
          destructive
          size='compact'
          disabled={!email || actionsUnavailable}
          onClick={() => setDialog('delete')}
        >
          Delete account
        </Button>
      </SettingsRow>
      <ConfirmDialog
        target={dialog === 'reset'}
        onClose={() => setDialog(null)}
        safe
        title='Reset password'
        confirmLabel='Send reset email'
        pendingLabel='Sending…'
        description={`A password reset link will be sent to ${email ?? 'your account email'}. Click the link in the email to create a new password.`}
        onConfirm={() => (email ? resetPassword(email) : undefined)}
      />
      {dialog === 'delete' && email && (
        <DeleteAccount email={email} onClose={() => setDialog(null)} />
      )}
    </SettingsSection>
  )
}
