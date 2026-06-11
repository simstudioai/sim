'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { format } from 'date-fns'
import {
  Calendar,
  ChipDatePicker,
  ChipDropdown,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@/components/emcn'
import type { CalendarSlot } from '@/app/workspace/[workspaceId]/scheduled-tasks/hooks/use-calendar'

const logger = createLogger('CreateTaskModal')

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const DEFAULT_TIME = '09:00'

/** Half-hour launch times across the day (`HH:mm` values, `h:mm a` labels). */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2)
  const minute = index % 2 === 0 ? 0 : 30
  return {
    value: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
    label: format(new Date(2000, 0, 1, hour, minute), 'h:mm a'),
  }
})

/** The data a calendar create captures. Persistence is wired in a later phase. */
export interface CreateTaskDraft {
  prompt: string
  launchDate: string
  launchTime: string
  timezone: string
}

interface CreateTaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The clicked slot, or `null` when opened from the header action. */
  slot: CalendarSlot | null
  /** Receives the draft on submit. When omitted, the draft is logged (stub). */
  onSubmit?: (draft: CreateTaskDraft) => void
}

/**
 * Lightweight "schedule a task" modal opened from a calendar day or time slot.
 * Seeds its launch date/time from `slot`; remount it with a slot-derived `key`
 * to re-seed on a new selection. Submit is a UI-only stub this phase — it does
 * not persist (the create API requires a recurring cron; one-time launches at an
 * exact datetime are not yet supported).
 */
export function CreateTaskModal({ open, onOpenChange, slot, onSubmit }: CreateTaskModalProps) {
  const [prompt, setPrompt] = useState('')
  const [launchDate, setLaunchDate] = useState(() => format(slot?.date ?? new Date(), 'yyyy-MM-dd'))
  const [launchTime, setLaunchTime] = useState(slot?.time ?? DEFAULT_TIME)

  const close = () => onOpenChange(false)

  const handleSubmit = () => {
    const draft: CreateTaskDraft = {
      prompt: prompt.trim(),
      launchDate,
      launchTime,
      timezone: DEFAULT_TIMEZONE,
    }
    if (onSubmit) onSubmit(draft)
    else logger.info('Scheduled task draft captured (not persisted this phase)', draft)
    close()
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} size='md' srTitle='New scheduled task'>
      <ChipModalHeader icon={Calendar} onClose={close}>
        New scheduled task
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='textarea'
          title='What you want this agent to do'
          value={prompt}
          onChange={setPrompt}
          placeholder='Describe what this agent should do…'
          minHeight={120}
          required
        />
        <ChipModalField type='custom' title='When it will launch'>
          <div className='flex items-center gap-2'>
            <div className='min-w-0 flex-1'>
              <ChipDatePicker value={launchDate} onChange={setLaunchDate} fullWidth flush />
            </div>
            <div className='min-w-0 flex-1'>
              <ChipDropdown
                value={launchTime}
                onChange={setLaunchTime}
                options={TIME_OPTIONS}
                fullWidth
                flush
              />
            </div>
          </div>
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        primaryAction={{ label: 'Schedule', onClick: handleSubmit, disabled: !prompt.trim() }}
      />
    </ChipModal>
  )
}
