'use client'

import { useState } from 'react'
import { ChipInput, FieldDivider, Label, Switch } from '@sim/emcn'
import {
  BLOCK_RETRY_DEFAULT_TRIES,
  BLOCK_RETRY_DEFAULT_WAIT_MS,
  type BlockRetryConfig,
  normalizeBlockRetryTries,
  normalizeBlockRetryWaitMs,
} from '@sim/workflow-types/workflow'

interface RetrySettingsProps {
  retry: BlockRetryConfig | undefined
  disabled: boolean
  onChange: (retry: BlockRetryConfig) => void
}

interface RetryNumberFieldProps {
  id: string
  title: string
  value: number
  disabled: boolean
  normalize: (value: unknown) => number
  onCommit: (value: number) => void
}

/**
 * A bounded number field that commits on blur.
 *
 * Typed as text with a numeric input mode rather than `type='number'`: the
 * native spinner is all that buys, and it does not fit the field chrome the rest
 * of the panel uses. Bounds are applied on commit through the same normalizer
 * execution uses, so the field cannot clamp differently from the executor.
 *
 * The draft exists only while the field is being edited; clearing it on commit
 * lets an external change — a collaborator's edit, or an undo — flow straight
 * through on the next render with no resync.
 */
function RetryNumberField({
  id,
  title,
  value,
  disabled,
  normalize,
  onCommit,
}: RetryNumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    /** Untouched field: nothing was typed, so there is nothing to normalize or write. */
    if (draft === null) return
    const next = normalize(draft)
    setDraft(null)
    if (next !== value) onCommit(next)
  }

  return (
    <div className='subblock-content flex flex-col gap-2.5'>
      <Label htmlFor={id}>{title}</Label>
      <ChipInput
        id={id}
        type='text'
        inputMode='numeric'
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        disabled={disabled}
      />
    </div>
  )
}

/**
 * Per-block retry, rendered as ordinary rows among the block's other additional
 * fields so it carries the same label, spacing, and dividers.
 *
 * The numbers stay mounted only while retry is on, but the policy is written
 * with `enabled: false` when it is switched off, so turning it back on restores
 * what was configured rather than snapping to the defaults.
 */
export function RetrySettings({ retry, disabled, onChange }: RetrySettingsProps) {
  const enabled = retry?.enabled === true
  const maxTries = retry?.maxTries ?? BLOCK_RETRY_DEFAULT_TRIES
  const waitBetweenTriesMs = retry?.waitBetweenTriesMs ?? BLOCK_RETRY_DEFAULT_WAIT_MS

  const setPolicy = (next: Partial<BlockRetryConfig>) =>
    onChange({ enabled, maxTries, waitBetweenTriesMs, ...next })

  return (
    <>
      <div className='subblock-row'>
        <div className='subblock-content flex items-center gap-x-3'>
          <Switch
            id='block-retry-enabled'
            checked={enabled}
            onCheckedChange={(next) => setPolicy({ enabled: next })}
            disabled={disabled}
          />
          <Label htmlFor='block-retry-enabled'>Retry on fail</Label>
        </div>
        {enabled && <FieldDivider subblockMarker />}
      </div>

      {enabled && (
        <>
          <div className='subblock-row'>
            <RetryNumberField
              id='block-retry-max-tries'
              title='Max tries'
              value={maxTries}
              disabled={disabled}
              normalize={normalizeBlockRetryTries}
              onCommit={(next) => setPolicy({ maxTries: next })}
            />
            <FieldDivider subblockMarker />
          </div>
          <div className='subblock-row'>
            <RetryNumberField
              id='block-retry-wait'
              title='Wait between tries (ms)'
              value={waitBetweenTriesMs}
              disabled={disabled}
              normalize={normalizeBlockRetryWaitMs}
              onCommit={(next) => setPolicy({ waitBetweenTriesMs: next })}
            />
          </div>
        </>
      )}
    </>
  )
}
