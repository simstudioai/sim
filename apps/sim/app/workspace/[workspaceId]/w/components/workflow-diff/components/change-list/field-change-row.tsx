'use client'

import { ChipModalField, ChipTag, cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import { formatValueForDisplay, resolveFieldLabel } from '@/lib/workflows/comparison/resolve-values'
import { StructuredValueDiff } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/structured-value-diff'
import {
  InlineDiff,
  TextDiff,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/text-diff'
import {
  getStructuredValuePresentation,
  mappingPresentation,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/value-presentation'
import {
  classifyChange,
  containerFieldLabel,
  findSubBlockConfig,
  formatScalar,
  isBlankValue,
  isSentenceLike,
  toDiffText,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'
import { formatParameterLabel } from '@/tools/params'

interface FieldChangeRowProps {
  blockType: string
  scope: 'block' | 'subblock' | 'container'
  field: string
  oldValue: unknown
  newValue: unknown
  baseValues: Record<string, unknown>
  targetValues: Record<string, unknown>
}

/**
 * One changed field. The value kind decides the shape: prose and code get a
 * folded line diff, short strings a word diff on one line, toggles and
 * selections an old → new pair, secrets only the fact. A field with one side
 * empty (a block that exists on one side only, or a value first set or
 * cleared) shows that one side alone, in that side's colour.
 */
export function FieldChangeRow({
  blockType,
  scope,
  field,
  oldValue,
  newValue,
  baseValues,
  targetValues,
}: FieldChangeRowProps) {
  const valueBlockType = scope === 'subblock' ? blockType : undefined
  const config = findSubBlockConfig(valueBlockType, field)
  const kind = classifyChange(valueBlockType, field, oldValue, newValue)
  const structuredSettings = scope === 'block' && kind === 'json'
  const present = (value: unknown, values: Record<string, unknown>) =>
    structuredSettings
      ? mappingPresentation(value)
      : kind === 'structured'
        ? getStructuredValuePresentation(config, field, value, values)
        : null
  const before = present(oldValue, baseValues)
  const after = present(newValue, targetValues)
  const oneSided = isBlankValue(oldValue) !== isBlankValue(newValue)
  const wordDiff = kind === 'scalar' && isSentenceLike(oldValue) && isSentenceLike(newValue)
  const resolvedLabel =
    scope === 'container' ? containerFieldLabel(field) : resolveFieldLabel(blockType, field, scope)
  const label = resolvedLabel === field ? formatParameterLabel(field) : resolvedLabel
  const textual = !structuredSettings && (kind === 'text' || kind === 'json')
  const scalar = kind === 'scalar' || kind === 'toggle'
  const text = (value: unknown) => {
    const formatted = toDiffText(value, valueBlockType, field)
    return kind === 'json' && typeof value === 'string' ? JSON.stringify(formatted) : formatted
  }
  let oldText = textual
    ? text(oldValue)
    : scalar
      ? formatScalar(valueBlockType, field, oldValue, baseValues)
      : ''
  let newText = textual
    ? text(newValue)
    : scalar
      ? formatScalar(valueBlockType, field, newValue, targetValues)
      : ''
  if (
    scalar &&
    (config?.type === 'dropdown' || config?.type === 'combobox') &&
    oldText === newText &&
    typeof oldValue === 'string' &&
    typeof newValue === 'string' &&
    oldValue !== newValue
  ) {
    oldText = `${oldText} (${oldValue})`
    newText = `${newText} (${newValue})`
  }
  const emptyTextChange = textual && oldText === '' && newText === ''
  const sameDisplayValue =
    !emptyTextChange && (textual || (scalar && !oneSided)) && oldText === newText

  return (
    <ChipModalField type='custom' title={label} flush>
      {before && after && (
        <StructuredValueDiff before={before} after={after} config={config} label={label} />
      )}
      {kind === 'secret' && (
        <span className='text-[var(--text-secondary)] text-small'>
          {isBlankValue(oldValue) ? 'Set' : isBlankValue(newValue) ? 'Cleared' : 'Value changed'}
        </span>
      )}
      {sameDisplayValue && (
        <span className='text-[var(--text-secondary)] text-small'>Value changed</span>
      )}
      {emptyTextChange && (
        <OldNewPair
          oldText={formatValueForDisplay(oldValue)}
          newText={formatValueForDisplay(newValue)}
        />
      )}
      {textual && !sameDisplayValue && !emptyTextChange && (
        <TextDiff oldText={oldText} newText={newText} />
      )}
      {scalar &&
        !sameDisplayValue &&
        (oneSided ? (
          <ValueChip
            tone={isBlankValue(oldValue) ? 'added' : 'removed'}
            text={isBlankValue(oldValue) ? newText : oldText}
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
