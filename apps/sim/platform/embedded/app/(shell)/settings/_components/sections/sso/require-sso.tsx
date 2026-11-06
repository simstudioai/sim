'use client'

import { useState } from 'react'
import { describeSsoPolicy, SSO_POLICY_OPTIONS } from '@/ee/sso/lib/provider-form'
import {
  ConfirmDialog,
  errorMessageOr,
  QueryBoundary,
  SegmentedControl,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  FieldStack,
  Muted,
} from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'
import { useSsoRequirement } from '@/platform/embedded/lib/data/sso-settings'

/**
 * Whether members must sign in through the organization's identity provider. Read when a session is
 * created, so turning it on ends no session. Owners keep password sign-in either way, so a broken
 * identity provider never locks the organization out of its own settings.
 */
export function RequireSso({ organizationId }: { organizationId: string }) {
  const { policy, disabled, turnOn, turnOff } = useSsoRequirement(organizationId)
  const [confirmingEnable, setConfirmingEnable] = useState(false)

  return (
    <SettingsSection title='Sign-in requirement'>
      <FieldStack>
        <QueryBoundary
          query={policy}
          failure={errorMessageOr('Failed to load the sign-in requirement')}
          loadingLabel='Loading sign-in requirement…'
        >
          {(data) => (
            <>
              <SegmentedControl
                label='Allowed sign-in methods'
                options={SSO_POLICY_OPTIONS.map((option) => ({ ...option, disabled }))}
                value={data.requireSso ? 'sso-only' : 'any'}
                onSelect={(value) => {
                  if (value === 'sso-only') setConfirmingEnable(true)
                  else void turnOff()
                }}
              />
              <Muted>{describeSsoPolicy(data)}</Muted>
              <Muted>
                Owners can always sign in with a password, so a misconfigured identity provider
                never locks the organization out.
              </Muted>
            </>
          )}
        </QueryBoundary>
      </FieldStack>
      <ConfirmDialog
        target={confirmingEnable}
        onClose={() => setConfirmingEnable(false)}
        title='Require single sign-on'
        description='Members will have to sign in through your identity provider from their next sign-in. Nobody is signed out, and owners keep password sign-in so you can undo this if the provider breaks.'
        confirmLabel='Require SSO'
        pendingLabel='Saving…'
        onConfirm={turnOn}
        safe
      />
    </SettingsSection>
  )
}
