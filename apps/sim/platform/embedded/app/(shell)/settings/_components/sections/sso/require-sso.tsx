'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useOrganizationSsoPolicy, useUpdateOrganizationSsoPolicy } from '@/ee/sso/hooks/sso-policy'
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

/**
 * Whether members must sign in through the organization's identity provider. Read when a session is
 * created, so turning it on ends no session. Owners keep password sign-in either way, so a broken
 * identity provider never locks the organization out of its own settings.
 */
export function RequireSso({ organizationId }: { organizationId: string }) {
  const policy = useOrganizationSsoPolicy(organizationId)
  const { data } = policy
  const updatePolicy = useUpdateOrganizationSsoPolicy()
  const [confirmingEnable, setConfirmingEnable] = useState(false)

  async function turnOff() {
    try {
      await updatePolicy.mutateAsync({ organizationId, requireSso: false })
      toast.success('Members can sign in with any method')
    } catch (failure) {
      toast.error(getErrorMessage(failure, 'Failed to update the sign-in requirement'))
    }
  }

  // Turning it off stays available: losing the provider must not strand the setting.
  const disabled =
    !data || updatePolicy.isPending || (!data.hasVerifiedProvider && !data.requireSso)

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
        onConfirm={async () => {
          await updatePolicy.mutateAsync({ organizationId, requireSso: true })
          toast.success('Members must now sign in through SSO')
        }}
        safe
      />
    </SettingsSection>
  )
}
