'use client'

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Input, TextArea } from '@sim/emcn/field/inputs'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { EnvVarDropdown } from '@/app/(product)/_components/env-var-dropdown/env-var-dropdown'
import styles from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/forks.module.css'
import { checkEnvVarTrigger } from '@/platform/lib/data/credentials'
import {
  applyDependentRepick,
  CUSTOM_BLOCK_UNSUPPORTED_HINT,
  customBlockBooleanOptions,
  type DependentReconfigState,
  dependentFieldNoun,
  dependentKey,
  effectiveCopyDependentValue,
  effectiveDependentValue,
  type ForkDependentReconfig,
  forkDependentControl,
} from '@/platform/lib/data/forks'
import {
  type SelectorClientContext,
  type SelectorKey,
  useSelectorOptionDetail,
  useSelectorOptions,
  useSelectorSearch,
} from '@/platform/lib/data/workflow-editor/selectors'

/** The dependent fields of one block in one workflow, as a mapping entry groups them. */
export interface DependentBlock {
  targetBlockId: string
  blockName: string
  fields: ForkDependentReconfig[]
  configurableFields: ForkDependentReconfig[]
}

interface DependentFieldSelectorProps {
  selectorKey: SelectorKey
  /** The whole selector context, including the chosen parent. */
  context: Record<string, string>
  /** The workspace whose parent resource the selector browses. */
  workspaceId: string
  /** False until the parent target, and every in-block parent, has a value. */
  enabled: boolean
  value: string
  onChange: (value: string) => void
  title: string
}

/**
 * A provider-backed pick for one dependent field, through the same selector data the canvas uses
 * but without its stores: searched on the provider, paged as the list scrolls, and a stored value
 * the loaded page lacks still named through its detail lookup.
 */
function DependentFieldSelector({
  selectorKey,
  context,
  workspaceId,
  enabled,
  value,
  onChange,
  title,
}: DependentFieldSelectorProps) {
  const search = useSelectorSearch()
  const surfaceId = `fork:${title}`
  const scope = { kind: 'workspace' as const, workspaceId }
  const selectorContext: SelectorClientContext = {}
  Object.assign(selectorContext, context)
  const list = useSelectorOptions(selectorKey, {
    context: selectorContext,
    scope,
    search: search.activeSearch,
    enabled,
    surfaceId,
  })
  const detail = useSelectorOptionDetail(selectorKey, {
    context: selectorContext,
    scope,
    detailId: value || undefined,
    enabled: enabled && Boolean(value),
    surfaceId,
  })
  const options = (list.data ?? []).map((option) => ({ value: option.id, label: option.label }))
  const selected = detail.data ?? undefined
  if (selected && !options.some((option) => option.value === selected.id)) {
    options.unshift({ value: selected.id, label: selected.label })
  }
  const noun = dependentFieldNoun(title)
  return (
    <SearchableSelect
      label={title}
      labelHidden
      options={options}
      value={value || null}
      selectedLabel={
        value ? (options.find((option) => option.value === value)?.label ?? value) : undefined
      }
      onValueChange={(next) => onChange(next ?? '')}
      placeholder={`Select ${noun}`}
      searchLabel={`Search ${noun}`}
      disabled={!enabled}
      search={{
        query: search.query,
        onQueryChange: (query, { reason }) => {
          if (reason !== 'item-press') search.setQuery(query)
        },
        hasMore: list.hasMore,
        loading: enabled && (list.isLoading || list.isFetchingMore || detail.isLoading),
        error: list.error ? 'Could not load options.' : undefined,
        onLoadMore: () => list.loadMore(),
        onRetry: () => list.refetch(),
        emptyMessage: `No ${noun} found`,
        footer: list.hasMore ? (
          <Button
            variant='quiet'
            size='compact'
            disabled={list.isLoadingAll}
            onClick={() => void list.loadAll()}
          >
            {list.isLoadingAll ? 'Loading all…' : 'Load all'}
          </Button>
        ) : undefined,
      }}
    />
  )
}

interface DependentTextFieldProps {
  title: string
  value: string
  onChange: (value: string) => void
  /** The workspace being written into, whose secrets `{{` offers. */
  workspaceId: string
  /** JSON-valued fields take the multi-line editor. */
  multiline?: boolean
}

/**
 * A typed dependent value. `{{` offers the secrets of the workspace the value is written INTO, so
 * the suggestion is one that resolves there at run time. A host around the EMCN control finds its
 * text element and follows the caret through the bubbling select event.
 */
function DependentTextField({
  title,
  value,
  onChange,
  workspaceId,
  multiline,
}: DependentTextFieldProps) {
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  /** The caret the suggestions follow; `null` once they are dismissed or a secret is chosen. */
  const [caret, setCaret] = useState<number | null>(null)
  const trigger = caret === null ? null : checkEnvVarTrigger(value, caret)
  const suggesting = Boolean(trigger?.show)

  /** While suggestions show, Escape closes them rather than anything around the field. */
  useEffect(() => {
    const element = field.current
    if (!suggesting || !element) return
    const holdEscape = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setCaret(null)
    }
    element.addEventListener('keydown', holdEscape)
    return () => element.removeEventListener('keydown', holdEscape)
  }, [suggesting])

  const change = (next: string) => {
    onChange(next)
    setCaret(field.current?.selectionStart ?? next.length)
  }
  const placeholder = multiline ? `Enter ${title} as JSON` : `Enter ${title}`

  return (
    <>
      <span
        className={styles.textEntry}
        ref={(host) => {
          field.current =
            host?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ?? null
        }}
        onSelect={(event) => {
          const target = event.target
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            setCaret(target.selectionStart ?? value.length)
          }
        }}
      >
        {multiline ? (
          <TextArea
            label={title}
            placeholder={placeholder}
            value={value}
            onChange={change}
            spellCheck={false}
          />
        ) : (
          <Input
            label={title}
            placeholder={placeholder}
            value={value}
            onChange={change}
            autoComplete='off'
            spellCheck={false}
          />
        )}
      </span>
      {trigger?.show && caret !== null && (
        <EnvVarDropdown
          visible
          searchTerm={trigger.searchTerm}
          inputValue={value}
          cursorPosition={caret}
          workspaceId={workspaceId}
          inputRef={field}
          onClose={() => setCaret(null)}
          onSelect={(next, cursor) => {
            onChange(next)
            setCaret(null)
            requestAnimationFrame(() => {
              field.current?.focus()
              field.current?.setSelectionRange(cursor, cursor)
            })
          }}
        />
      )}
    </>
  )
}

/** The values a block's parent fields hand to a field that consumes them. */
function blockChainState(
  block: DependentBlock,
  activeField: ForkDependentReconfig,
  effectiveValue: (field: ForkDependentReconfig) => string
) {
  const providedValues: Record<string, string> = {}
  const providedContextKeys = new Set<string>()
  for (const field of block.fields) {
    if (field.dependencyScope !== activeField.dependencyScope) continue
    if (field.providesContextKey) {
      providedContextKeys.add(field.providesContextKey)
      const value = effectiveValue(field)
      if (value) providedValues[field.providesContextKey] = value
    }
  }
  return { providedValues, providedContextKeys }
}

interface DependentFieldProps {
  field: ForkDependentReconfig
  block: DependentBlock
  target: string
  parentChanged: boolean
  /** The parent is resolved by COPY: browse the SOURCE parent, seeded from the source. */
  copying: boolean
  workspaceId: string
  sourceWorkspaceId: string
  reconfig: DependentReconfigState
  setReconfig: Dispatch<SetStateAction<DependentReconfigState>>
}

/**
 * One dependent field's control. Under a MAPPED parent a selector browses the TARGET parent, filled
 * from the stored value and blank after a parent change; under a COPY-resolved parent it browses the
 * SOURCE parent, which the copy brings across. It waits for every in-block parent, and a re-pick
 * clears the fields chained beneath it. A field with no selector takes a typed value instead.
 */
export function DependentField({
  field,
  block,
  target,
  parentChanged,
  copying,
  workspaceId,
  sourceWorkspaceId,
  reconfig,
  setReconfig,
}: DependentFieldProps) {
  const isCustomBlockInput = field.parentKind === 'custom-block'
  const effectiveValueIn = (f: ForkDependentReconfig, state: DependentReconfigState) =>
    copying && !isCustomBlockInput
      ? effectiveCopyDependentValue(f, state)
      : effectiveDependentValue(f, state, parentChanged)
  const effectiveValue = (f: ForkDependentReconfig) => effectiveValueIn(f, reconfig)

  if (!field.selectorKey) {
    const setValue = (value: string) =>
      setReconfig((current) => ({ ...current, [dependentKey(field)]: value }))
    const value = effectiveValue(field)
    switch (forkDependentControl(field)) {
      case 'switch':
        return (
          <SegmentedControl<string>
            label={field.title}
            options={customBlockBooleanOptions(field.required)}
            value={value}
            onSelect={setValue}
          />
        )
      case 'textarea':
        return (
          <DependentTextField
            title={field.title}
            value={value}
            onChange={setValue}
            workspaceId={workspaceId}
            multiline
          />
        )
      case 'unsupported':
        return (
          <Input
            label={field.title}
            placeholder={CUSTOM_BLOCK_UNSUPPORTED_HINT}
            value=''
            disabled
          />
        )
      default:
        return (
          <DependentTextField
            title={field.title}
            value={value}
            onChange={setValue}
            workspaceId={workspaceId}
          />
        )
    }
  }

  const { providedValues, providedContextKeys } = blockChainState(block, field, effectiveValue)
  const ready = field.consumesContextKeys.every(
    (key) => !providedContextKeys.has(key) || providedValues[key] !== undefined
  )
  // A copy has no target id until the sync runs, so it scopes to the SOURCE parent.
  const parentValue = copying ? field.parentSourceId : target
  return (
    <DependentFieldSelector
      selectorKey={field.selectorKey as SelectorKey}
      workspaceId={copying ? sourceWorkspaceId : workspaceId}
      context={{
        ...field.context,
        ...providedValues,
        ...(field.parentContextKey ? { [field.parentContextKey]: parentValue } : {}),
      }}
      enabled={parentValue !== '' && ready}
      value={effectiveValue(field)}
      onChange={(value) =>
        setReconfig((current) =>
          applyDependentRepick(current, field, block.fields, value, {
            previousValue: effectiveValueIn(field, current),
            baselineValueFor: (f) => effectiveValueIn(f, {}),
          })
        )
      }
      title={field.title}
    />
  )
}
