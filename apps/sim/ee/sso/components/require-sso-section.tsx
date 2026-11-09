'use client'

import { useState } from 'react'
import { ChipConfirmModal, ChipSwitch, toast } from '@sim/emcn-legacy'
import { getErrorMessage } from '@sim/utils/errors'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/components/settings/primitives/settings-empty-state'
import { SettingsSection } from '@/components/settings/primitives/settings-section/settings-section'
import { SettingRow } from '@/ee/components/setting-row'
import { useOrganizationSsoPolicy, useUpdateOrganizationSsoPolicy } from '@/ee/sso/hooks/sso-policy'
import { describeSsoPolicy, SSO_POLICY_OPTIONS } from '@/ee/sso/lib/provider-form'

interface RequireSsoSectionProps {
  organizationId: string
}

/**
 * Whether members must sign in through the organization's identity provider.
 *
 * The requirement is read when a session is created, so turning it on ends no
 * session that already exists — signing everyone out stays the separate action
 * under Session policies. Owners keep password sign-in either way, so a broken
 * identity provider never locks the organization out of its own settings.
 */
export function RequireSsoSection({ organizationId }: RequireSsoSectionProps) {
  const { data, error, isFetching, refetch } = useOrganizationSsoPolicy(organizationId)
  const updatePolicy = useUpdateOrganizationSsoPolicy()
  const [showEnableConfirm, setShowEnableConfirm] = useState(false)

  if (!data) {
    /** A failed read must say so rather than leaving the requirement looking absent. */
    if (error) {
      return (
        <SettingsSection label='Sign-in requirement'>
          <SettingsQueryErrorState
            error={error}
            fallback='Failed to load the sign-in requirement'
            isRetrying={isFetching}
            onRetry={() => void refetch()}
            variant='inline'
          />
        </SettingsSection>
      )
    }
    return (
      <SettingsSection label='Sign-in requirement'>
        <SettingsEmptyState variant='inline'>Loading sign-in requirement...</SettingsEmptyState>
      </SettingsSection>
    )
  }

  const save = async (requireSso: boolean) => {
    try {
      await updatePolicy.mutateAsync({ organizationId, requireSso })
      setShowEnableConfirm(false)
      toast.success(
        requireSso ? 'Members must now sign in through SSO' : 'Members can sign in with any method'
      )
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update the sign-in requirement'))
    }
  }

  return (
    <>
      <SettingsSection label='Sign-in requirement'>
        <SettingRow
          label='Allowed sign-in methods'
          labelTooltip='Owners can always sign in with a password, so a misconfigured identity provider never locks the organization out.'
        >
          <ChipSwitch
            value={data.requireSso ? 'sso-only' : 'any'}
            onChange={(value) => {
              if (value === 'sso-only') {
                setShowEnableConfirm(true)
                return
              }
              void save(false)
            }}
            /** Turning it off stays available: losing the provider must not strand the setting. */
            disabled={updatePolicy.isPending || (!data.hasVerifiedProvider && !data.requireSso)}
            aria-label='Allowed sign-in methods'
            options={SSO_POLICY_OPTIONS}
          />
          <p className='text-[var(--text-muted)] text-caption'>{describeSsoPolicy(data)}</p>
        </SettingRow>
      </SettingsSection>

      <ChipConfirmModal
        open={showEnableConfirm}
        onOpenChange={(open) => !open && setShowEnableConfirm(false)}
        title='Require single sign-on'
        text={[
          'Members will have to sign in through your identity provider from their next sign-in. ',
          { text: 'Nobody is signed out', bold: true },
          ', and owners keep password sign-in so you can undo this if the provider breaks.',
        ]}
        confirm={{
          label: 'Require SSO',
          variant: 'primary',
          onClick: () => void save(true),
          pending: updatePolicy.isPending,
          pendingLabel: 'Saving...',
        }}
      />
    </>
  )
}
