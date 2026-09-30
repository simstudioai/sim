'use client'

import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import { isContainerType } from '@/lib/workflows/autolayout'
import { resolveFieldLabel } from '@/lib/workflows/comparison/resolve-values'
import { KeyedListDiff } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/keyed-list-diff'
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
  toMessageList,
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
  /* A field its definition never titled comes back as the raw id; humanize it. */
  const label = resolvedLabel === field ? formatParameterLabel(field) : resolvedLabel

  return (
    <div className='flex flex-col gap-1.5'>
      <span className='text-[var(--text-tertiary)] text-caption'>{label}</span>
      {kind === 'secret' && (
        <span className='text-[var(--text-secondary)] text-small'>
          {isBlankValue(oldValue) ? 'Set' : isBlankValue(newValue) ? 'Cleared' : 'Value changed'}
        </span>
      )}
      {(kind === 'text' || kind === 'json') && (
        <TextDiff oldText={toDiffText(oldValue)} newText={toDiffText(newValue)} />
      )}
      {kind === 'messages' && <MessagesDiff oldValue={oldValue} newValue={newValue} />}
      {kind === 'list' && (
        <KeyedListDiff
          blockType={blockType}
          field={field}
          oldValue={oldValue}
          newValue={newValue}
        />
      )}
      {(kind === 'scalar' || kind === 'toggle') &&
        (oneSided ? (
          <ValueChip
            tone={isBlankValue(oldValue) ? 'added' : 'removed'}
            text={formatScalar(blockType, field, isBlankValue(oldValue) ? newValue : oldValue)}
          />
        ) : wordDiff ? (
          <InlineDiff
            oldText={formatScalar(blockType, field, oldValue)}
            newText={formatScalar(blockType, field, newValue)}
          />
        ) : (
          <OldNewPair
            oldText={formatScalar(blockType, field, oldValue)}
            newText={formatScalar(blockType, field, newValue)}
          />
        ))}
    </div>
  )
}

interface MessagesDiffProps {
  oldValue: unknown
  newValue: unknown
}

/**
 * Agent messages diff one slot at a time, paired by position, so a system
 * prompt edit reads as a prompt diff rather than a JSON diff of the array.
 */
function MessagesDiff({ oldValue, newValue }: MessagesDiffProps) {
  const oldMessages = toMessageList(oldValue)
  const newMessages = toMessageList(newValue)
  const count = Math.max(oldMessages.length, newMessages.length)
  const slots = Array.from({ length: count }, (_, index) => ({
    index,
    old: oldMessages[index],
    next: newMessages[index],
  })).filter(
    (slot) => slot.old?.content !== slot.next?.content || slot.old?.role !== slot.next?.role
  )

  return (
    <div className='flex flex-col gap-2'>
      {slots.map((slot) => (
        <div key={slot.index} className='flex flex-col gap-1'>
          <span className='text-[var(--text-muted)] text-caption capitalize'>
            {slot.next?.role ?? slot.old?.role} message
            {!slot.old && ' (added)'}
            {!slot.next && ' (removed)'}
          </span>
          <TextDiff oldText={slot.old?.content ?? ''} newText={slot.next?.content ?? ''} />
        </div>
      ))}
    </div>
  )
}

const CHIP_CLASS = {
  removed: 'bg-[color-mix(in_srgb,var(--text-error)_10%,transparent)] text-[var(--text-secondary)]',
  added: 'bg-[color-mix(in_srgb,var(--brand-accent)_14%,transparent)] text-[var(--text-primary)]',
} as const

interface ValueChipProps {
  tone: keyof typeof CHIP_CLASS
  text: string
}

/** A single value in its side's tint; wraps rather than truncates so nothing hides. */
function ValueChip({ tone, text }: ValueChipProps) {
  return (
    <span
      className={cn(
        'min-w-0 self-start whitespace-pre-wrap break-words rounded-sm px-1.5 py-px text-small',
        CHIP_CLASS[tone]
      )}
    >
      {text}
    </span>
  )
}

interface OldNewPairProps {
  oldText: string
  newText: string
}

function OldNewPair({ oldText, newText }: OldNewPairProps) {
  return (
    <div className='flex min-w-0 items-center gap-2'>
      <ValueChip tone='removed' text={oldText} />
      <ArrowRight className='size-[12px] shrink-0 text-[var(--text-icon)]' />
      <ValueChip tone='added' text={newText} />
    </div>
  )
}
