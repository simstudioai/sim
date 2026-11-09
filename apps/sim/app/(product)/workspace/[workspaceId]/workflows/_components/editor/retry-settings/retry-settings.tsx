'use client'

import { useState } from 'react'
import { FieldFrame, SwitchField } from '@sim/emcn/field'
import { ShortInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/short-input/short-input'
import {
  BLOCK_RETRY_DEFAULT_TRIES,
  BLOCK_RETRY_DEFAULT_WAIT_MS,
  type BlockRetryConfig,
  normalizeBlockRetryTries,
  normalizeBlockRetryWaitMs,
  type SubBlockConfig,
} from '@/platform/lib/data/workflow-editor'

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
 * A bounded number that commits on blur through the executor's own normalizer. The draft exists
 * only while the field is edited, so a collaborator's change or an undo flows straight through.
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
    if (draft === null) return
    const next = normalize(draft)
    setDraft(null)
    if (next !== value) onCommit(next)
  }
  return (
    <FieldFrame label={config.title ?? ''}>
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
    </FieldFrame>
  )
}

/**
 * Per-block retry among the additional fields. Turning it off writes `enabled: false` and keeps
 * the numbers, so turning it back on restores them.
 */
export function RetrySettings({ blockId, retry, disabled, onChange }: RetrySettingsProps) {
  const enabled = retry?.enabled === true
  const maxTries = retry?.maxTries ?? BLOCK_RETRY_DEFAULT_TRIES
  const waitBetweenTriesMs = retry?.waitBetweenTriesMs ?? BLOCK_RETRY_DEFAULT_WAIT_MS
  const setPolicy = (next: Partial<BlockRetryConfig>) =>
    onChange({ enabled, maxTries, waitBetweenTriesMs, ...next })

  return (
    <>
      <SwitchField
        label='Retry on fail'
        checked={enabled}
        disabled={disabled}
        onCheckedChange={(next) => setPolicy({ enabled: next })}
      />
      {enabled && (
        <>
          <RetryNumberField
            blockId={blockId}
            config={MAX_TRIES_CONFIG}
            value={maxTries}
            disabled={disabled}
            normalize={normalizeBlockRetryTries}
            onCommit={(next) => setPolicy({ maxTries: next })}
          />
          <RetryNumberField
            blockId={blockId}
            config={WAIT_CONFIG}
            value={waitBetweenTriesMs}
            disabled={disabled}
            normalize={normalizeBlockRetryWaitMs}
            onCommit={(next) => setPolicy({ waitBetweenTriesMs: next })}
          />
        </>
      )}
    </>
  )
}
