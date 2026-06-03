'use client'

import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { Info, toast } from '@/components/emcn'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useUpdateUsageLimit, useUsageLimitData } from '@/hooks/queries/subscription'
import { useDebounce } from '@/hooks/use-debounce'

/** Delay before a usage-limit edit is auto-saved once the user stops typing. */
const AUTOSAVE_DELAY_MS = 1000

/**
 * Editable monthly usage-limit field. Seeds from the user's saved limit and
 * auto-saves a debounced, validated value. Renders nothing for plans that
 * cannot edit their limit (e.g. the free plan), so the whole section is hidden.
 */
export function UsageLimitField() {
  const { data: usageLimit } = useUsageLimitData()
  const { mutate: saveLimit } = useUpdateUsageLimit()

  const currentLimit = usageLimit?.data?.currentLimit
  const minimumLimit = usageLimit?.data?.minimumLimit ?? 0
  const canEdit = usageLimit?.data?.canEdit ?? false

  const [draft, setDraft] = useState('')
  const debouncedDraft = useDebounce(draft, AUTOSAVE_DELAY_MS)
  const syncedRef = useRef<number | null>(null)

  useEffect(() => {
    if (currentLimit == null || syncedRef.current === currentLimit) return
    const isClean = draft === '' || draft === String(syncedRef.current)
    syncedRef.current = currentLimit
    if (isClean) setDraft(String(currentLimit))
  }, [currentLimit, draft])

  useEffect(() => {
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
    saveLimit(
      { limit: parsed },
      {
        onError: (error) => {
          toast.error("Couldn't update usage limit", {
            description: getErrorMessage(error, 'Please try again in a moment.'),
          })
        },
      }
    )
  }, [debouncedDraft, currentLimit, minimumLimit, saveLimit])

  if (!canEdit) return null

  return (
    <SettingsSection
      label='Usage limit'
      headerAccessory={
        <Info side='top' className='text-[var(--text-muted)]'>
          {
            "Max usage to consume per month. By default, it's your plan's limit, but you can set it beyond."
          }
        </Info>
      }
    >
      <div className='flex h-[30px] items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 dark:bg-[var(--surface-4)]'>
        <input
          type='number'
          inputMode='decimal'
          min={minimumLimit}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={currentLimit != null ? String(currentLimit) : 'Enter monthly usage limit'}
          className='h-full w-full bg-transparent text-[var(--text-body)] text-sm outline-none [appearance:textfield] placeholder:text-[var(--text-muted)] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
        />
      </div>
    </SettingsSection>
  )
}
