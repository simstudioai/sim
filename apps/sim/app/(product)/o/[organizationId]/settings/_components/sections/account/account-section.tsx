'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Modal } from '@sim/emcn/modal'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import Link from 'next/link'
import { toast } from '@/lib/toast/sink'
import { DetailHeader } from '@/app/(product)/_components/settings-parts/settings-parts'
import { AuthorizedApps } from '@/app/(product)/o/[organizationId]/settings/_components/sections/account/authorized-apps'
import { DeleteAccount } from '@/app/(product)/o/[organizationId]/settings/_components/sections/account/delete-account'
import { OrganizationAccounts } from '@/app/(product)/o/[organizationId]/settings/_components/sections/account/organization-accounts'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { signOutAndLeave } from '@/platform/lib/data/session'
import { useAccountEmail, useResetPasswordAction } from '@/platform/shared/account'

interface AccountSettingsRowsProps {
  organization: PlatformOrganization
  /** Leaves Reset password, Sign out and Delete account unavailable, where nothing could run them. */
  actionsUnavailable?: boolean
  authorizedAppsHref: string
  organizationAccountsHref: string
}

type AccountView = 'authorized-apps' | 'organization-accounts'

interface AccountSettingsSubviewProps {
  organization: PlatformOrganization
  view: AccountView
  backHref: string
}

const VIEWS = {
  'authorized-apps': { title: 'Authorized apps' },
  'organization-accounts': { title: 'Connected organization accounts' },
} as const

export function AccountSettingsSubview({
  organization,
  view,
  backHref,
}: AccountSettingsSubviewProps) {
  if (organization.navFlags.anonymous) return null
  return (
    <>
      <DetailHeader backLabel='General' backHref={backHref} title={VIEWS[view].title} />
      {view === 'authorized-apps' ? <AuthorizedApps /> : <OrganizationAccounts />}
    </>
  )
}

function SignedInRows({
  actionsUnavailable,
  authorizedAppsHref,
  organizationAccountsHref,
}: AccountSettingsRowsProps) {
  const email = useAccountEmail()
  const resetPassword = useResetPasswordAction()
  const [dialog, setDialog] = useState<'reset' | 'delete' | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  return (
    <>
      <SettingsRow label={VIEWS['authorized-apps'].title}>
        <Button size='compact' render={<Link href={authorizedAppsHref} />}>
          Manage
        </Button>
      </SettingsRow>
      <SettingsRow label={VIEWS['organization-accounts'].title}>
        <Button size='compact' render={<Link href={organizationAccountsHref} />}>
          Manage
        </Button>
      </SettingsRow>
      <SettingsRow label='Reset password'>
        <Button
          size='compact'
          disabled={!email || actionsUnavailable}
          onClick={() => setDialog('reset')}
        >
          Reset password
        </Button>
      </SettingsRow>
      <SettingsRow label='Sign out'>
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
      <Modal
        open={dialog === 'reset'}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        variant='confirm'
        title='Reset password'
        confirmLabel='Send reset email'
        description={`A password reset link will be sent to ${email ?? 'your account email'}. Click the link in the email to create a new password.`}
        onConfirm={() => (email ? resetPassword(email) : undefined)}
      />
      {dialog === 'delete' && email && (
        <DeleteAccount email={email} onClose={() => setDialog(null)} />
      )}
    </>
  )
}

export function AccountSettingsRows(props: AccountSettingsRowsProps) {
  const { organization } = props
  if (organization.navFlags.anonymous && !organization.deployment.hosted) return null
  return (
    <SettingsSection title='Account'>
      {organization.deployment.hosted && (
        <SettingsRow label='Home page'>
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
      {!organization.navFlags.anonymous && (
        <SignedInRows
          organization={organization}
          actionsUnavailable={props.actionsUnavailable}
          authorizedAppsHref={props.authorizedAppsHref}
          organizationAccountsHref={props.organizationAccountsHref}
        />
      )}
    </SettingsSection>
  )
}
