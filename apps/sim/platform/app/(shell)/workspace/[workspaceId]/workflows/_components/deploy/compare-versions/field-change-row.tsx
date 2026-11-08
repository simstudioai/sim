'use client'

import { Icon } from '@sim/emcn/icon'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/compare-versions/compare-versions.module.css'
import { StructuredValueDiff } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/compare-versions/structured-value-diff'
import {
  InlineDiff,
  TextDiff,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/compare-versions/text-diff'
import {
  classifyChange,
  containerFieldLabel,
  findSubBlockConfig,
  formatScalar,
  formatValueForDisplay,
  getStructuredValuePresentation,
  isBlankValue,
  isSentenceLike,
  mappingPresentation,
  resolveFieldLabel,
  toDiffText,
} from '@/platform/lib/data/workflow-deploy'
import { formatParameterLabel } from '@/platform/lib/data/workflows'

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
 * One changed field. Its kind decides the shape: prose and code get a folded line diff, short
 * strings a word diff on one line, toggles and selections an old → new pair, secrets only the fact.
 * A field with one side empty shows that side alone, in that side's colour.
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
    <div className={styles.fieldChange}>
      <span className={styles.fieldLabel} data-type='T059'>
        {label}
      </span>
      {before && after && (
        <StructuredValueDiff before={before} after={after} config={config} label={label} />
      )}
      {kind === 'secret' && (
        <span className={styles.muted} data-type='T060'>
          {isBlankValue(oldValue) ? 'Set' : isBlankValue(newValue) ? 'Cleared' : 'Value changed'}
        </span>
      )}
      {sameDisplayValue && (
        <span className={styles.muted} data-type='T060'>
          Value changed
        </span>
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
            side={isBlankValue(oldValue) ? 'added' : 'removed'}
            text={isBlankValue(oldValue) ? newText : oldText}
          />
        ) : wordDiff ? (
          <InlineDiff oldText={oldText} newText={newText} />
        ) : (
          <OldNewPair oldText={oldText} newText={newText} />
        ))}
    </div>
  )
}

function ValueChip({ side, text }: { side: 'removed' | 'added'; text: string }) {
  return (
    <span className={styles.valueChip} data-kind={side}>
      <span className={styles.chipSign} aria-hidden='true'>
        {side === 'added' ? '+' : '−'}
      </span>
      <span data-visually-hidden=''>{side === 'added' ? 'Added: ' : 'Removed: '}</span>
      <span className={styles.chip} data-type='T009'>
        {text}
      </span>
    </span>
  )
}

function OldNewPair({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <span className={styles.pair}>
      <ValueChip side='removed' text={oldText} />
      <span className={styles.arrow}>
        <Icon name='arrow-right' />
      </span>
      <ValueChip side='added' text={newText} />
    </span>
  )
}
