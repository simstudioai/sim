'use client'

import { useState } from 'react'
import { FieldDivider, Label, Switch } from '@sim/emcn'
import {
  BLOCK_RETRY_DEFAULT_TRIES,
  BLOCK_RETRY_DEFAULT_WAIT_MS,
  type BlockRetryConfig,
  normalizeBlockRetryTries,
  normalizeBlockRetryWaitMs,
} from '@sim/workflow-types/workflow'
import { ShortInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input'
import type { SubBlockConfig } from '@/blocks/types'

interface RetrySettingsProps {
  blockId: string
  retry: BlockRetryConfig | undefined
  disabled: boolean
  onChange: (retry: BlockRetryConfig) => void
}

interface RetryNumberFieldProps {
  blockId: string
  config: SubBlockConfig
  value: number
  disabled: boolean
  normalize: (value: unknown) => number
  onCommit: (value: number) => void
}

const MAX_TRIES_CONFIG = {
  id: 'block-retry-max-tries',
  title: 'Max tries',
  type: 'short-input',
  connectionDroppable: false,
} as const satisfies SubBlockConfig

const WAIT_CONFIG = {
  id: 'block-retry-wait',
  title: 'Wait between tries (ms)',
  type: 'short-input',
  connectionDroppable: false,
} as const satisfies SubBlockConfig

/**
 * A bounded number field that commits on blur.
 *
 * Renders the same `ShortInput` every other sub-block text field uses, so it
 * carries the panel's field chrome. Retry values are plain numbers that never
 * resolve references, so the reference pickers are turned off. Bounds are
 * applied on commit through the same normalizer execution uses, so the field
 * cannot clamp differently from the executor.
 *
 * The draft exists only while the field is being edited; clearing it on commit
 * lets an external change — a collaborator's edit, or an undo — flow straight
 * through on the next render with no resync.
 */
function RetryNumberField({
  blockId,
  config,
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
      <div className='flex items-center justify-between gap-1.5 pl-0.5'>
        <Label className='flex items-baseline gap-1.5 whitespace-nowrap'>{config.title}</Label>
      </div>
      <ShortInput
        blockId={blockId}
        subBlockId={config.id}
        config={config}
        value={draft ?? String(value)}
        onChange={setDraft}
        onBlur={commit}
        disabled={disabled}
        allowReferences={false}
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
export function RetrySettings({ blockId, retry, disabled, onChange }: RetrySettingsProps) {
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
              blockId={blockId}
              config={MAX_TRIES_CONFIG}
              value={maxTries}
              disabled={disabled}
              normalize={normalizeBlockRetryTries}
              onCommit={(next) => setPolicy({ maxTries: next })}
            />
            <FieldDivider subblockMarker />
          </div>
          <div className='subblock-row'>
            <RetryNumberField
              blockId={blockId}
              config={WAIT_CONFIG}
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
