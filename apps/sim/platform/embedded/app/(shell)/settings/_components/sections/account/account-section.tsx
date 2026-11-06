'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signOutAndRedirect } from '@/lib/auth/sign-out'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { Button, ConfirmDialog } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { DetailHeader } from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { AuthorizedApps } from '@/platform/embedded/app/(shell)/settings/_components/sections/account/authorized-apps'
import { DeleteAccount } from '@/platform/embedded/app/(shell)/settings/_components/sections/account/delete-account'
import { OrganizationAccounts } from '@/platform/embedded/app/(shell)/settings/_components/sections/account/organization-accounts'
import { useAccountEmail, useResetPasswordAction } from '@/platform/embedded/lib/data/account'
import { useAnonymousViewer } from '@/platform/embedded/lib/data/organization'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface AccountSettingsRowsProps {
  organization: OrganizationSurfaceContext
  privacyHref: string
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
    description: 'Review and revoke apps that can act on your account.',
  },
  'organization-accounts': {
    title: 'Connected organization accounts',
    description:
      'Disconnect accounts you connected for an organization, including ones you have left.',
  },
} as const

export function AccountSettingsSubview({ view, backHref }: AccountSettingsSubviewProps) {
  const anonymous = useAnonymousViewer()
  if (anonymous) return null
  return (
    <>
      <DetailHeader
        backLabel='General'
        backHref={backHref}
        title={VIEWS[view].title}
        description={VIEWS[view].description}
      />
      {view === 'authorized-apps' ? <AuthorizedApps /> : <OrganizationAccounts />}
    </>
  )
}

function SignedInRows({
  authorizedAppsHref,
  organizationAccountsHref,
}: Omit<AccountSettingsRowsProps, 'organization' | 'privacyHref'>) {
  const email = useAccountEmail()
  const resetPassword = useResetPasswordAction()
  const [dialog, setDialog] = useState<'reset' | 'delete' | null>(null)
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  return (
    <>
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
        <Button size='compact' disabled={!email} onClick={() => setDialog('reset')}>
          Reset password
        </Button>
      </SettingsRow>
      <SettingsRow label='Sign out' description='End your session on this device'>
        <Button
          size='compact'
          disabled={signingOut}
          onClick={() => {
            useSettingsDirtyStore.getState().requestLeave(() => {
              setSigningOut(true)
              void signOutAndRedirect(router.push)
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
          variant='destructive'
          size='compact'
          disabled={!email}
          onClick={() => setDialog('delete')}
        >
          Delete account
        </Button>
      </SettingsRow>
      <ConfirmDialog
        target={dialog === 'reset'}
        onClose={() => setDialog(null)}
        title='Reset password'
        confirmLabel='Send reset email'
        pendingLabel='Sending…'
        description={`A password reset link will be sent to ${email ?? 'your account email'}. Click the link in the email to create a new password.`}
        onConfirm={() => (email ? resetPassword(email) : undefined)}
        safe
      />
      {dialog === 'delete' && email && (
        <DeleteAccount email={email} onClose={() => setDialog(null)} />
      )}
    </>
  )
}

export function AccountSettingsRows(props: AccountSettingsRowsProps) {
  const { organization } = props
  const anonymous = useAnonymousViewer()
  return (
    <SettingsSection title='Account'>
      <SettingsRow label='Privacy' description='Control what Sim collects about how you use it.'>
        <Button size='compact' render={<Link href={props.privacyHref} />}>
          Manage
        </Button>
      </SettingsRow>
      {organization.deployment.hosted && (
        <SettingsRow label='Home page' description='Open Sim’s public home page'>
          <Button
            size='compact'
            render={
              <a
                href='/?home'
                aria-label='Open home page'
                target='_blank'
                rel='noopener noreferrer'
              >
                Open
              </a>
            }
          >
            Open
          </Button>
        </SettingsRow>
      )}
      {!anonymous && (
        <SignedInRows
          authorizedAppsHref={props.authorizedAppsHref}
          organizationAccountsHref={props.organizationAccountsHref}
        />
      )}
    </SettingsSection>
  )
}
