'use client'

import { useState } from 'react'
import { Modal } from '@sim/emcn/modal'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import {
  FieldStack,
  LoadingState,
  Muted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  describeSsoPolicy,
  SSO_POLICY_OPTIONS,
  useOrganizationSsoPolicy,
  useUpdateOrganizationSsoPolicy,
} from '@/platform/lib/data/sso'
import { toast } from '@/platform/lib/data/toast'

/**
 * Whether members must sign in through the organization's identity provider. Read when a session is
 * created, so turning it on ends no session. Owners keep password sign-in either way, so a broken
 * identity provider never locks the organization out of its own settings.
 */
export function RequireSso({ organizationId }: { organizationId: string }) {
  const { data, error, isFetching, refetch } = useOrganizationSsoPolicy(organizationId)
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
        {data ? (
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
              Owners can always sign in with a password, so a misconfigured identity provider never
              locks the organization out.
            </Muted>
          </>
        ) : error ? (
          <FailureNotice
            message={getErrorMessage(error, 'Failed to load the sign-in requirement')}
            retrying={isFetching}
            onRetry={() => void refetch()}
          />
        ) : (
          <LoadingState label='Loading sign-in requirement…' />
        )}
      </FieldStack>
      <Modal
        variant='confirm'
        open={confirmingEnable}
        onOpenChange={setConfirmingEnable}
        title='Require single sign-on'
        description='Members will have to sign in through your identity provider from their next sign-in. Nobody is signed out, and owners keep password sign-in so you can undo this if the provider breaks.'
        confirmLabel={updatePolicy.isPending ? 'Saving…' : 'Require SSO'}
        onConfirm={async () => {
          await updatePolicy.mutateAsync({ organizationId, requireSso: true })
          toast.success('Members must now sign in through SSO')
        }}
      />
    </SettingsSection>
  )
}
