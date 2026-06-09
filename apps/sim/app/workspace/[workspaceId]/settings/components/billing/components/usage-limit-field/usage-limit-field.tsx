'use client'

import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { ChipInput, Info, toast } from '@/components/emcn'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useUpdateOrganizationUsageLimit } from '@/hooks/queries/organization'
import { useUpdateUsageLimit } from '@/hooks/queries/subscription'
import { useDebounce } from '@/hooks/use-debounce'

/** Delay before a usage-limit edit is auto-saved once the user stops typing. */
const AUTOSAVE_DELAY_MS = 1000

interface UsageLimitFieldProps {
  /** Current monthly usage limit, in dollars. */
  currentLimit: number
  /** Lowest limit the plan allows, in dollars. */
  minimumLimit: number
  /** Whether the viewer may edit the limit (org admins / solo paid users). */
  canEdit: boolean
  /** Routes the save to the user or organization mutation. */
  context: 'user' | 'organization'
  /** Required when {@link context} is `'organization'`. */
  organizationId?: string
}

/**
 * Editable monthly usage-limit field. Seeds from the resolved limit and
 * auto-saves a debounced, validated value to either the user or the
 * organization — matching the Subscription tab's edit logic. When the viewer
 * cannot edit (e.g. a non-admin team member) the resolved value is shown
 * read-only.
 */
export function UsageLimitField({
  currentLimit,
  minimumLimit,
  canEdit,
  context,
  organizationId,
}: UsageLimitFieldProps) {
  const { mutate: saveUserLimit } = useUpdateUsageLimit()
  const { mutate: saveOrgLimit } = useUpdateOrganizationUsageLimit()

  const [draft, setDraft] = useState('')
  const debouncedDraft = useDebounce(draft, AUTOSAVE_DELAY_MS)
  const syncedRef = useRef<number | null>(null)
  /**
   * Read the latest limit inside the auto-save effect WITHOUT making it a
   * dependency. If `currentLimit` were a dep, an external change (e.g. the
   * on-demand toggle optimistically bumping the limit) would re-run the effect
   * with a stale `debouncedDraft` and save the old value, clobbering the toggle.
   */
  const currentLimitRef = useRef(currentLimit)
  currentLimitRef.current = currentLimit

  useEffect(() => {
    if (currentLimit == null || syncedRef.current === currentLimit) return
    const isClean = draft === '' || draft === String(syncedRef.current)
    syncedRef.current = currentLimit
    if (isClean) setDraft(String(currentLimit))
  }, [currentLimit, draft])

  useEffect(() => {
    if (!canEdit) return
    const currentLimit = currentLimitRef.current
    if (currentLimit == null || debouncedDraft.trim() === '') return
    const parsed = Number.parseFloat(debouncedDraft)
    if (Number.isNaN(parsed)) {
      toast.error('Usage limit must be a number')
      return
    }
    if (parsed === currentLimit) return
    if (parsed < minimumLimit) {
      toast.error(`Usage limit must be at least ${minimumLimit}`)
      return
    }

    const onError = (error: unknown) => {
      toast.error("Couldn't update usage limit", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }

    if (context === 'organization') {
      if (!organizationId) {
        toast.error("Couldn't update usage limit", {
          description: 'Organization billing context is unavailable. Please refresh and try again.',
        })
        return
      }
      saveOrgLimit({ organizationId, limit: parsed }, { onError })
      return
    }

    saveUserLimit({ limit: parsed }, { onError })
  }, [debouncedDraft, minimumLimit, canEdit, context, organizationId, saveOrgLimit, saveUserLimit])

  return (
    <SettingsSection
      label='Usage limit'
      headerAccessory={
        <Info side='top' className='text-[var(--text-muted)]'>
          {
            "Max usage to consume per month, in USD. By default, it's your plan's limit, but you can set it beyond."
          }
        </Info>
      }
    >
      <ChipInput
        type='number'
        inputMode='decimal'
        min={minimumLimit}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={currentLimit != null ? String(currentLimit) : 'Enter monthly usage limit'}
        disabled={!canEdit}
        inputClassName='[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
      />
    </SettingsSection>
  )
}
