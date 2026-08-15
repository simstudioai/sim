'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Info,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import {
  organizationKeys,
  useOrganizationMemberUsageLimit,
  useUpdateOrganizationMemberUsageLimit,
} from '@/hooks/queries/organization'

/** The member whose credit limit is being edited. */
export interface CreditLimitTarget {
  userId: string
  name: string
  email: string
}

interface CreditLimitModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  member: CreditLimitTarget | null
}

const INVALID_LIMIT_MESSAGE = 'Enter a whole number of credits, or leave blank for no limit.'

/**
 * Sets (or clears) one member's per-organization credit limit.
 *
 * The cap is read from and written to the org-scoped
 * `organization_member_usage_limit` record — the same value cap enforcement
 * reads — so the field always shows what is actually enforced. A blank field
 * means no cap.
 */
export function CreditLimitModal({
  open,
  onOpenChange,
  organizationId,
  member,
}: CreditLimitModalProps) {
  const queryClient = useQueryClient()
  const userId = member?.userId
  const { data, isLoading } = useOrganizationMemberUsageLimit(organizationId, userId, open)
  const updateLimit = useUpdateOrganizationMemberUsageLimit()

  const [draft, setDraft] = useState('')
  /**
   * Seed the draft from server data only until the admin starts typing, so a
   * background refetch (window focus, post-save invalidation) can't clobber an
   * in-progress edit. Reset when the modal closes.
   */
  const hasEditedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      hasEditedRef.current = false
      return
    }
    if (data && !hasEditedRef.current) {
      setDraft(data.creditLimit === null ? '' : String(data.creditLimit))
    }
  }, [open, data])

  const trimmed = draft.trim()
  const parsedLimit = trimmed === '' ? null : Number(trimmed)
  const isValid =
    trimmed === '' || (parsedLimit !== null && Number.isInteger(parsedLimit) && parsedLimit >= 0)
  const currentLimit = data?.creditLimit ?? null
  const isDirty = parsedLimit !== currentLimit
  const isSaving = updateLimit.isPending

  const handleSave = () => {
    if (!userId || !isValid) return
    updateLimit.mutate(
      { orgId: organizationId, userId, creditLimit: parsedLimit },
      {
        onSuccess: () => {
          /**
           * The roster query feeds the table's limit column, and the mutation
           * hook only invalidates the single-member key — refresh it here so
           * the row reflects the new cap without a manual reload.
           */
          queryClient.invalidateQueries({
            queryKey: organizationKeys.memberUsage(organizationId),
          })
          onOpenChange(false)
        },
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to update credit limit')),
      }
    )
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Credit limit'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>
        {member ? `Credit limit — ${member.name || member.email}` : 'Credit limit'}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          inputType='number'
          title={
            <span className='inline-flex items-center gap-1.5'>
              Credit limit
              <Info side='top'>
                {
                  "Credits are Sim's usage unit — 1,000 credits = $5. Caps this member's usage across this organization's workspaces each billing period."
                }
              </Info>
            </span>
          }
          value={draft}
          onChange={(value) => {
            hasEditedRef.current = true
            setDraft(value)
          }}
          placeholder='No limit'
          error={isValid ? undefined : INVALID_LIMIT_MESSAGE}
          disabled={isLoading || isSaving}
        />
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={isSaving}
        primaryAction={{
          label: isSaving ? 'Saving...' : 'Save',
          onClick: handleSave,
          disabled: !isValid || !isDirty || isSaving || isLoading,
        }}
      />
    </ChipModal>
  )
}
