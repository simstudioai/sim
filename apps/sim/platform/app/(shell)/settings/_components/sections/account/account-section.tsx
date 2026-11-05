'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { AuthorizedApps } from '@/platform/app/(shell)/settings/_components/sections/account/authorized-apps'
import { DeleteAccount } from '@/platform/app/(shell)/settings/_components/sections/account/delete-account'
import { OrganizationAccounts } from '@/platform/app/(shell)/settings/_components/sections/account/organization-accounts'
import { Button, Modal } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { useAccountEmail, useResetPasswordAction } from '@/platform/lib/data/account'
import { signOutAndLeave } from '@/platform/lib/data/session'
import { toast } from '@/platform/lib/data/toast'

export default function AccountSection({ organization }: SettingsSectionProps) {
  const { legacyOrigin, deployment } = organization
  const email = useAccountEmail()
  const resetPassword = useResetPasswordAction()
  const [resetting, setResetting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  return (
    <>
      <SettingsSection title='Session'>
        {deployment.hosted && (
          <SettingsRow label='Home page' description='Open Sim’s public home page'>
            <Button
              render={
                <Link href={`${legacyOrigin}/?home`} target='_blank' rel='noopener noreferrer' />
              }
              size='compact'
            >
              Open
            </Button>
          </SettingsRow>
        )}
        <SettingsRow label='Sign out' description='End your session on this device'>
          <Button
            size='compact'
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true)
              void signOutAndLeave(`${legacyOrigin}/login?fromLogout=true`).then((left) => {
                if (left) return
                setSigningOut(false)
                toast.error('Failed to sign out. Please try again.')
              })
            }}
          >
            Sign out
          </Button>
        </SettingsRow>
        <SettingsRow label='Reset password' description='Email yourself a password reset link'>
          <Button size='compact' disabled={!email} onClick={() => setResetting(true)}>
            Reset password
          </Button>
          <Modal
            open={resetting}
            onOpenChange={setResetting}
            variant='confirm'
            title='Reset password'
            confirmLabel='Send reset email'
            description={`A password reset link will be sent to ${email}. Click the link in the email to create a new password.`}
            onConfirm={() => (email ? resetPassword(email) : undefined)}
          />
        </SettingsRow>
      </SettingsSection>
      <AuthorizedApps />
      <OrganizationAccounts />
      <SettingsSection title='Delete account'>
        <SettingsRow
          label='Delete account'
          description='Permanently delete your account and everything it owns'
        >
          <Button
            variant='destructive'
            size='compact'
            disabled={!email}
            onClick={() => setDeleting(true)}
          >
            Delete account
          </Button>
        </SettingsRow>
      </SettingsSection>
      {deleting && email && (
        <DeleteAccount
          email={email}
          legacyOrigin={legacyOrigin}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  )
}
