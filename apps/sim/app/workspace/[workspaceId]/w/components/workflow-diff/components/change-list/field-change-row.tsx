'use client'

import { ChipModalField, ChipTag, cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import { isContainerType } from '@/lib/workflows/autolayout'
import { resolveFieldLabel } from '@/lib/workflows/comparison/resolve-values'
import {
  InlineDiff,
  TextDiff,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/text-diff'
import {
  classifyChange,
  containerFieldLabel,
  ENGINE_FIELD_LABELS,
  formatScalar,
  isBlankValue,
  isSentenceLike,
  toDiffText,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'
import { formatParameterLabel } from '@/tools/params'

interface FieldChangeRowProps {
  blockType: string
  field: string
  oldValue: unknown
  newValue: unknown
}

/**
 * One changed field. The value kind decides the shape: prose and code get a
 * folded line diff, short strings a word diff on one line, toggles and
 * selections an old → new pair, secrets only the fact. A field with one side
 * empty (a block that exists on one side only, or a value first set or
 * cleared) shows that one side alone, in that side's colour.
 */
export function FieldChangeRow({ blockType, field, oldValue, newValue }: FieldChangeRowProps) {
  const kind = classifyChange(blockType, field, oldValue, newValue)
  const oneSided = isBlankValue(oldValue) !== isBlankValue(newValue)
  const wordDiff = kind === 'scalar' && isSentenceLike(oldValue) && isSentenceLike(newValue)
  const resolvedLabel = isContainerType(blockType)
    ? containerFieldLabel(field)
    : (ENGINE_FIELD_LABELS[field] ?? resolveFieldLabel(blockType, field))
  const label = resolvedLabel === field ? formatParameterLabel(field) : resolvedLabel
  const textual = kind === 'text' || kind === 'json'
  const scalar = kind === 'scalar' || kind === 'toggle'
  const text = (value: unknown) => {
    const formatted = toDiffText(value, blockType, field)
    return kind === 'json' && typeof value === 'string' ? JSON.stringify(formatted) : formatted
  }
  const oldText = textual ? text(oldValue) : scalar ? formatScalar(blockType, field, oldValue) : ''
  const newText = textual ? text(newValue) : scalar ? formatScalar(blockType, field, newValue) : ''
  // The summary saw a change the masked text cannot show, so the change is inside a secret.
  const maskedOnly = (textual || (scalar && !oneSided)) && oldText === newText

  return (
    <ChipModalField type='custom' title={label} flush>
      {kind === 'secret' && (
        <span className='text-[var(--text-secondary)] text-small'>
          {isBlankValue(oldValue) ? 'Set' : isBlankValue(newValue) ? 'Cleared' : 'Value changed'}
        </span>
      )}
      {maskedOnly && (
        <span className='text-[var(--text-secondary)] text-small'>A masked value changed</span>
      )}
      {textual && !maskedOnly && <TextDiff oldText={oldText} newText={newText} />}
      {scalar &&
        !maskedOnly &&
        (oneSided ? (
          <ValueChip
            tone={isBlankValue(oldValue) ? 'added' : 'removed'}
            text={formatScalar(blockType, field, isBlankValue(oldValue) ? newValue : oldValue)}
          />
        ) : wordDiff ? (
          <InlineDiff oldText={oldText} newText={newText} />
        ) : (
          <OldNewPair oldText={oldText} newText={newText} />
        ))}
    </ChipModalField>
  )
}

interface ValueChipProps {
  tone: 'removed' | 'added'
  text: string
}

function ValueChip({ tone, text }: ValueChipProps) {
  return (
    <div className='flex min-w-0 items-start gap-1.5'>
      <span
        className={cn(
          'shrink-0 font-mono text-small',
          tone === 'added' ? 'text-[var(--badge-success-text)]' : 'text-[var(--badge-error-text)]'
        )}
      >
        {tone === 'added' ? '+' : '−'}
      </span>
      <ChipTag variant='mono'>{text}</ChipTag>
    </div>
  )
}

interface OldNewPairProps {
  oldText: string
  newText: string
}

function OldNewPair({ oldText, newText }: OldNewPairProps) {
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-2'>
      <ValueChip tone='removed' text={oldText} />
      <ArrowRight className='size-[12px] shrink-0 text-[var(--text-icon)]' />
      <ValueChip tone='added' text={newText} />
    </div>
  )
}
