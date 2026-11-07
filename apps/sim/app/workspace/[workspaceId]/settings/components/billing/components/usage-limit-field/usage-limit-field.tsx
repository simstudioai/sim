'use client'

import { useEffect, useRef, useState } from 'react'
import { ChipInput, Info, toast } from '@sim/emcn-legacy'
import { getErrorMessage } from '@sim/utils/errors'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { isUsageLimitDraftDirty, resolveUsageLimitDraft } from '@/lib/billing/usage-limit-draft'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useUpdateOrganizationUsageLimit } from '@/hooks/queries/organization'
import { useUpdateUsageLimit } from '@/hooks/queries/subscription'
import { useDebounce } from '@/hooks/use-debounce'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'

/** Delay before a usage-limit edit is auto-saved once the user stops typing. */
const AUTOSAVE_DELAY_MS = 1000

/** Static help accessory for the usage-limit header; hoisted so it's a stable reference. */
const USAGE_LIMIT_INFO = (
  <Info side='top' className='text-[var(--text-muted)]'>
    {
      "Max usage to consume per month, set in credits — Sim's usage unit (1,000 credits = $5). By default, it's your plan's included usage, but you can set it beyond."
    }
  </Info>
)

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
  const userUpdate = useUpdateUsageLimit()
  const orgUpdate = useUpdateOrganizationUsageLimit()
  const saveUserLimit = userUpdate.mutate
  const saveOrgLimit = orgUpdate.mutate

  const [draft, setDraft] = useState<string | null>(null)
  const debouncedDraft = useDebounce(draft, AUTOSAVE_DELAY_MS)
  const value =
    draft ?? (currentLimit >= ON_DEMAND_UNLIMITED ? '' : String(dollarsToCredits(currentLimit)))
  const currentLimitRef = useRef(currentLimit)
  const draftRef = useRef(draft)
  const pendingRef = useRef(false)
  const pending = userUpdate.isPending || orgUpdate.isPending
  useEffect(() => {
    currentLimitRef.current = currentLimit
    draftRef.current = draft
    pendingRef.current = pending
  }, [currentLimit, draft, pending])

  useSettingsUnsavedGuard({
    isDirty: canEdit && draft !== null && isUsageLimitDraftDirty(draft, currentLimit),
    navigationBlocked: pending,
    onDiscard: () => setDraft(null),
  })

  useEffect(() => {
    if (
      !canEdit ||
      debouncedDraft === null ||
      draftRef.current !== debouncedDraft ||
      pendingRef.current
    )
      return
    const currentLimit = currentLimitRef.current
    if (currentLimit == null) return
    const decision = resolveUsageLimitDraft(debouncedDraft, currentLimit, minimumLimit)
    if (decision.kind === 'wait') return
    if (decision.kind === 'settled') {
      setDraft((current) => (current === debouncedDraft ? null : current))
      return
    }
    if (decision.kind === 'invalid') {
      toast.error(decision.message)
      return
    }
    const { limitDollars } = decision
    const onError = (error: unknown) => {
      toast.error("Couldn't update usage limit", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }

    const onSuccess = () => setDraft((current) => (current === debouncedDraft ? null : current))

    if (context === 'organization') {
      if (!organizationId) {
        toast.error("Couldn't update usage limit", {
          description: 'Organization billing context is unavailable. Please refresh and try again.',
        })
        return
      }
      saveOrgLimit({ organizationId, limit: limitDollars }, { onError, onSuccess })
      return
    }

    saveUserLimit({ limit: limitDollars }, { onError, onSuccess })
  }, [debouncedDraft, minimumLimit, canEdit, context, organizationId, saveOrgLimit, saveUserLimit])

  return (
    <SettingsSection label='Usage limit' headerAccessory={USAGE_LIMIT_INFO}>
      {/*
        Text with a numeric input mode rather than `type='number'`: the native stepper
        is all that type buys and it does not fit the chip chrome. The minimum is
        enforced on commit below, where it can explain itself, rather than by a `min`
        attribute the browser enforces silently.
      */}
      <ChipInput
        inputMode='numeric'
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={
          currentLimit == null
            ? 'Enter monthly usage limit'
            : currentLimit >= ON_DEMAND_UNLIMITED
              ? 'No Usage Limit'
              : String(dollarsToCredits(currentLimit))
        }
        disabled={!canEdit || pending}
      />
    </SettingsSection>
  )
}
