'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Info,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useTranslations } from 'next-intl'
import {
  useOrganizationMemberUsageLimit,
  useUpdateOrganizationMemberUsageLimit,
} from '@/hooks/queries/organization'

export interface ManageCreditsTarget {
  userId: string
  name: string
  email: string
}

interface ManageCreditsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  member: ManageCreditsTarget | null
}

/**
 * Modal for viewing a member's credits used in the organization's workspaces and
 * setting their per-member credit limit. "Credits used" is a read-only chip;
 * "Credit limit" is editable (blank = no limit). Hosted-only feature — surfaced
 * only from the Organization tab, which already requires hosted + Team plan.
 */
export function ManageCreditsModal({
  open,
  onOpenChange,
  organizationId,
  member,
}: ManageCreditsModalProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const userId = member?.userId
  const { data, isLoading } = useOrganizationMemberUsageLimit(organizationId, userId, open)
  const updateLimit = useUpdateOrganizationMemberUsageLimit()

  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Seed the draft from server data only until the admin starts typing, so a
  // background refetch (window focus, post-save invalidation) can't clobber an
  // in-progress edit. Reset when the modal closes.
  const hasEditedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      hasEditedRef.current = false
      return
    }
    if (data && !hasEditedRef.current) {
      setDraft(data.creditLimit === null ? '' : String(data.creditLimit))
      setError(null)
    }
  }, [open, data])

  const trimmed = draft.trim()
  const parsedLimit = trimmed === '' ? null : Number(trimmed)
  const isValid =
    trimmed === '' || (parsedLimit !== null && Number.isInteger(parsedLimit) && parsedLimit >= 0)
  const currentLimit = data?.creditLimit ?? null
  const isDirty = parsedLimit !== currentLimit
  const isSaving = updateLimit.isPending

  const creditsUsed = data ? data.creditsUsed.toLocaleString() : '—'
  const creditsUsedTitle = data
    ? `Credits used this ${data.billingInterval === 'year' ? 'year' : 'month'}`
    : 'Credits used'

  const handleSave = () => {
    if (!userId) return
    if (!isValid) {
      setError('Enter a whole number of credits, or leave blank for no limit.')
      return
    }
    setError(null)
    updateLimit.mutate(
      { orgId: organizationId, userId, creditLimit: parsedLimit },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => setError(getErrorMessage(err, 'Failed to update credit limit')),
      }
    )
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={tI18n('manage_credits')}>
      <ChipModalHeader onClose={() => onOpenChange(false)}>
        {member ? `Manage credits — ${member.name || member.email}` : tI18n('manage_credits')}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='copy'
          title={creditsUsedTitle}
          value={isLoading ? 'Loading…' : creditsUsed}
          copyLabel={tI18n('copy_credits_used')}
        />
        <ChipModalField
          type='input'
          inputType='number'
          title={
            <span className='inline-flex items-center gap-1.5'>
              {t('credit_limit')}
              <Info side='top'>{tI18n('set_in_credits_sim_s_usage')}</Info>
            </span>
          }
          value={draft}
          onChange={(value) => {
            hasEditedRef.current = true
            setDraft(value)
          }}
          placeholder={t('no_limit')}
          hint={t('leave_blank_for_no_limit')}
          disabled={isLoading || isSaving}
        />
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={isSaving}
        primaryAction={{
          label: isSaving ? 'Saving…' : 'Save',
          onClick: handleSave,
          disabled: !isValid || !isDirty || isSaving || isLoading,
        }}
      />
    </ChipModal>
  )
}
