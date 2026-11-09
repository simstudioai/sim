'use client'

import {
  type ChangeEvent,
  type ComponentType,
  type KeyboardEvent,
  memo,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from 'react'
import { IconButton } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { MenuSearchField } from '@sim/emcn/search-field/menu-search-field'
import { useReactFlow } from '@xyflow/react'
import {
  FieldPopover,
  FieldPopoverNote,
  FieldPopoverRow,
  useActiveRowIntoView,
} from '@/app/(product)/_components/field-popover/field-popover'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/combobox/combobox.module.css'
import { SandboxCreateModal } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/combobox/sandbox-create-modal'
import { formatDisplayText } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import { SubBlockInputController } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block-input-controller/sub-block-input-controller'
import {
  checkTagTrigger,
  type SubBlockConfig,
  useAccessibleReferencePrefixes,
  useFetchedOptions,
  useSubBlockStore,
  useSubBlockValue,
  useWorkflowRegistry,
} from '@/platform/lib/data/workflow-editor'
import {
  checkEnvVarTrigger,
  getDependsOnFields,
  type SandboxLanguage,
  type SelectorKey,
  shouldClearMissingOption,
  useDeploymentShape,
  usePermissionConfig,
  useSelectorSearch,
} from '@/platform/lib/data/workflow-editor/selectors'

const DEFAULT_MODEL = 'claude-sonnet-5-5'
const ZOOM_STEP = 0.96
const MIN_ZOOM = 0.1
const MAX_ZOOM = 1

const CREATE_ACTION_LABEL: Record<NonNullable<SubBlockConfig['createAction']>, string> = {
  sandbox: 'Create Sandbox',
}

/**
 * A choice: a plain string, or a labelled id with an optional mark. A `hidden` option leaves the
 * list but still names a stored value.
 */
type ComboBoxOption =
  | string
  | {
      label: string
      id: string
      icon?: ComponentType<{ className?: string }>
      hidden?: boolean
    }

type ComboBoxOptionsSource =
  | readonly ComboBoxOption[]
  | ((params?: { values: Record<string, unknown> }) => readonly ComboBoxOption[])

interface ComboChoice {
  value: string
  label: string
  icon?: ComponentType<{ className?: string }>
  hidden?: boolean
}

const EMPTY_OPTIONS: readonly ComboBoxOption[] = []

const optionValue = (option: ComboBoxOption) => (typeof option === 'string' ? option : option.id)

/** Whether a choice's label or stored value contains the lowercased text. */
function choiceMatches(choice: ComboChoice, text: string): boolean {
  return choice.label.toLowerCase().includes(text) || choice.value.toLowerCase().includes(text)
}

function toChoice(option: ComboBoxOption): ComboChoice {
  if (typeof option === 'string') return { value: option, label: option }
  return { value: option.id, label: option.label, icon: option.icon, hidden: option.hidden }
}

interface ComboBoxProps {
  blockId: string
  subBlockId: string
  /** Static options, a function of the block's values, or absent when `selectorKey` supplies them. */
  options?: ComboBoxOptionsSource
  defaultValue?: string
  placeholder?: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  config: SubBlockConfig
  /** The registered selector that supplies a remote list. */
  selectorKey?: SelectorKey
  /** Leaves the hosting workflow out of a workflow list. */
  selectorExcludeSelf?: boolean
  /** Fields whose change refetches the options. */
  dependsOn?: SubBlockConfig['dependsOn']
}

function ChoiceMark({ icon: ChoiceIcon }: { icon: ComponentType<{ className?: string }> }) {
  return (
    <span className={styles.mark} aria-hidden='true'>
      <ChoiceIcon />
    </span>
  )
}

/**
 * An editable choice: type any value (a `<block.output>` reference or a `{{SECRET}}` among it, with
 * their pickers) or pick from the options, which filter as you type. A typed value matching an
 * option stores that option's id. Options can come from a registered selector, searched and paged
 * on the provider; models the viewer's permission group denies are left out, and the field fills
 * itself with a default (the model field prefers the platform default).
 */
export const ComboBox = memo(function ComboBox({
  blockId,
  subBlockId,
  options,
  defaultValue,
  placeholder = 'Type or select an option…',
  isPreview = false,
  previewValue,
  disabled = false,
  config,
  selectorKey,
  selectorExcludeSelf,
  dependsOn,
}: ComboBoxProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const reactFlowInstance = useReactFlow()
  const dependsOnFields = useMemo(() => getDependsOnFields(dependsOn), [dependsOn])
  const preview = typeof previewValue === 'string' ? previewValue : null
  const value = isPreview ? preview : storeValue

  const { isModelUsable, isLoading: isPermissionLoading } = usePermissionConfig()
  const filtersModels = subBlockId === 'model' && !config.mediaModelOptions

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const blockValues = useSubBlockStore((state) =>
    activeWorkflowId ? state.workflowValues[activeWorkflowId]?.[blockId] : undefined
  )
  // Option builders read the deployment shape outside React, so a shape that lands after mount
  // re-evaluates them rather than leaving the fallback's list in place.
  const deploymentShape = useDeploymentShape()
  const staticOptions = useMemo(() => {
    void deploymentShape
    const evaluated =
      typeof options === 'function'
        ? options({ values: blockValues ?? {} })
        : (options ?? EMPTY_OPTIONS)
    return filtersModels
      ? evaluated.filter((option) => isModelUsable(optionValue(option)))
      : evaluated
  }, [options, blockValues, filtersModels, isModelUsable, deploymentShape])

  const search = useSelectorSearch()
  const fetched = useFetchedOptions({
    blockId,
    subBlockId,
    dependsOnFields,
    selectorKey,
    selectorExcludeSelf,
    isPreview,
    disabled,
    search: search.activeSearch,
    valueToHydrate: value,
    localOptions: staticOptions,
  })
  const { refetch: refetchOptions, missingOptionId } = fetched

  const [createOpen, setCreateOpen] = useState(false)
  const [createLanguage, setCreateLanguage] = useState<SandboxLanguage | undefined>()
  const [createdOption, setCreatedOption] = useState<{ label: string; id: string } | null>(null)

  useEffect(() => {
    const currentValue = useSubBlockStore.getState().getValue(blockId, subBlockId)
    if (
      shouldClearMissingOption({
        clearOnMissingOption: Boolean(config.clearOnMissingOption),
        missingOptionId,
        currentValue,
        isPreview,
        disabled,
      })
    )
      setStoreValue('')
  }, [
    blockId,
    config.clearOnMissingOption,
    disabled,
    isPreview,
    missingOptionId,
    setStoreValue,
    subBlockId,
  ])

  const evaluatedOptions = useMemo(() => {
    let merged: ComboBoxOption[] =
      fetched.isDynamic && fetched.fetchedOptions.length > 0
        ? fetched.fetchedOptions.map((option) => ({ label: option.label, id: option.id }))
        : [...staticOptions]
    if (filtersModels && fetched.isDynamic && fetched.fetchedOptions.length > 0)
      merged = merged.filter((option) => isModelUsable(optionValue(option)))
    // A value created through the pinned row is selected before any list refetches; it leaves
    // again once a real fetch carries it.
    for (const extra of [fetched.hydratedOption, createdOption]) {
      if (extra && !merged.some((option) => optionValue(option) === extra.id))
        merged = [extra, ...merged]
    }
    return merged
  }, [
    fetched.isDynamic,
    fetched.fetchedOptions,
    fetched.hydratedOption,
    staticOptions,
    createdOption,
    filtersModels,
    isModelUsable,
  ])

  const choices = useMemo(() => evaluatedOptions.map(toChoice), [evaluatedOptions])
  const createAction = config.createAction && !isPreview && !disabled ? config.createAction : null

  const defaultOptionValue = useMemo(() => {
    const values = evaluatedOptions.map(optionValue)
    if (defaultValue !== undefined && values.includes(defaultValue)) return defaultValue
    if (subBlockId === 'model' && values.includes(DEFAULT_MODEL)) return DEFAULT_MODEL
    // Filling a field whose empty value is a real choice would silently change the block.
    if (config.emptyIsValid) return undefined
    const first = evaluatedOptions.find((option) => typeof option === 'string' || !option.hidden)
    return first === undefined ? undefined : optionValue(first)
  }, [defaultValue, evaluatedOptions, subBlockId, config.emptyIsValid])

  const displayValue = useMemo(() => {
    const raw = value?.toString() ?? ''
    if (!raw) return ''
    return choices.find((choice) => choice.value === raw)?.label ?? raw
  }, [value, choices])

  const [inputValue, setInputValue] = useState(displayValue)
  const [previousDisplayValue, setPreviousDisplayValue] = useState(displayValue)
  if (displayValue !== previousDisplayValue) {
    setPreviousDisplayValue(displayValue)
    setInputValue(displayValue)
  }

  // The default in force when the viewer emptied the field, so it is not refilled while they type.
  // A dependency change bringing a different default ends it, and so does a remount.
  const userClearedDefaultRef = useRef<string | null>(null)

  useEffect(() => {
    if (isPermissionLoading || defaultOptionValue === undefined) return
    const clearedByDependency =
      config.restoreDefaultWhenCleared &&
      value === '' &&
      userClearedDefaultRef.current !== defaultOptionValue
    if (value === null || value === undefined || clearedByDependency)
      setStoreValue(defaultOptionValue)
  }, [
    value,
    defaultOptionValue,
    setStoreValue,
    isPermissionLoading,
    config.restoreDefaultWhenCleared,
  ])

  const commitValue = useCallback(
    (next: string) => {
      if (isPreview) return
      const matched = choices.find((choice) => choice.value === next)
      const stored = matched ? matched.value : next
      userClearedDefaultRef.current = stored === '' ? (defaultOptionValue ?? null) : null
      setStoreValue(stored)
    },
    [isPreview, choices, setStoreValue, defaultOptionValue]
  )

  const [open, setOpen] = useState(false)
  // Focus and click both open the list in one gesture; the ref keeps that to a single refetch.
  const openRef = useRef(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [caret, setCaret] = useState(0)
  const overlayRef = useRef<HTMLDivElement>(null)
  // A `searchable` field also searches from a box in the list, which narrows it without
  // overwriting the stored value the way typing in the field does.
  const searchable = Boolean(config.searchable)
  const [listQuery, setListQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const chevronClosesRef = useRef(false)

  // The typed text narrows the list unless it already names an option exactly.
  const visible = choices.filter((choice) => !choice.hidden)
  const query = inputValue.toLowerCase()
  const exactMatch = visible.some(
    (choice) => choice.value === inputValue || choice.label.toLowerCase() === query
  )
  const typed =
    !inputValue || exactMatch ? visible : visible.filter((choice) => choiceMatches(choice, query))
  const listText = listQuery.toLowerCase()
  const listed = listText ? typed.filter((choice) => choiceMatches(choice, listText)) : typed
  const rows: Array<{ kind: 'create' } | { kind: 'choice'; choice: ComboChoice }> = [
    ...(createAction ? [{ kind: 'create' as const }] : []),
    ...listed.map((choice) => ({ kind: 'choice' as const, choice })),
  ]
  const referencePickerOpen =
    checkTagTrigger(inputValue, caret).show || checkEnvVarTrigger(inputValue, caret).show
  const listOpen = open && !referencePickerOpen && !isPreview && !disabled
  useActiveRowIntoView(listOpen, activeIndex)

  const openList = () => {
    if (!openRef.current) refetchOptions()
    openRef.current = true
    setOpen(true)
  }
  const closeList = () => {
    openRef.current = false
    setOpen(false)
    setActiveIndex(-1)
    if (listQuery) {
      setListQuery('')
      search.reset()
    }
  }

  /** Arrow keys open the list on the first row, then move through it and wrap at either end. */
  const moveActive = (down: boolean) => {
    if (!listOpen) {
      if (down) {
        openList()
        setActiveIndex(0)
      }
      return
    }
    if (!rows.length) return
    setActiveIndex((current) =>
      down
        ? current < rows.length - 1
          ? current + 1
          : 0
        : current > 0
          ? current - 1
          : rows.length - 1
    )
  }

  const selectChoice = (choice: ComboChoice) => {
    setInputValue(choice.label)
    search.reset()
    commitValue(choice.value)
    closeList()
  }

  const startCreate = () => {
    const language = useSubBlockStore.getState().getValue(blockId, 'language')
    setCreateLanguage(language === 'python' || language === 'javascript' ? language : undefined)
    setCreateOpen(true)
    closeList()
  }

  const activateRow = (index: number) => {
    const row = rows[index]
    if (!row) return
    if (row.kind === 'create') startCreate()
    else selectChoice(row.choice)
  }

  const handleWheel = (event: WheelEvent<HTMLInputElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    event.stopPropagation()
    const currentZoom = reactFlowInstance.getZoom()
    const { x: viewportX, y: viewportY } = reactFlowInstance.getViewport()
    const delta = event.deltaY > 0 ? 1 : -1
    const newZoom = Math.min(Math.max(currentZoom * ZOOM_STEP ** delta, MIN_ZOOM), MAX_ZOOM)
    const { x: pointerX, y: pointerY } = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    })
    reactFlowInstance.setViewport(
      {
        x: viewportX + (pointerX * currentZoom - pointerX * newZoom),
        y: viewportY + (pointerY * currentZoom - pointerY * newZoom),
        zoom: newZoom,
      },
      { duration: 0 }
    )
  }

  const selected = value ? choices.find((choice) => choice.value === value) : undefined
  const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
    activeSearchTarget,
    blockId,
    subBlockId,
    valuePath: [],
    label: inputValue,
  })
  const fieldDisabled = isPreview || disabled
  const searching = Boolean(search.debouncedSearch)
  const loading = fetched.isLoadingOptions || fetched.isFetchingMore || fetched.isLoadingAll

  return (
    <div className={styles.field}>
      <SubBlockInputController
        blockId={blockId}
        subBlockId={subBlockId}
        config={config}
        onChange={commitValue}
        isPreview={isPreview}
        disabled={disabled}
        previewValue={preview}
      >
        {({ ref, onChange, onKeyDown, onDrop, onDragOver, onFocus }) => {
          const trackCaret = (event: SyntheticEvent<HTMLInputElement>) =>
            setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
          const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
            const next = event.target.value
            const matched = choices.find((choice) => choice.value === next)
            if (matched) {
              setInputValue(matched.label)
              search.reset()
            } else {
              setInputValue(next)
              search.setQuery(next)
            }
            trackCaret(event)
            setActiveIndex(-1)
            openList()
            onChange(event)
          }
          /** Arrows, Enter and Escape drive the list from the field or its search box alike. */
          const handleListKey = (event: KeyboardEvent<HTMLInputElement>): boolean => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              moveActive(event.key === 'ArrowDown')
              return true
            }
            if (event.key === 'Enter' && listOpen && activeIndex >= 0) {
              event.preventDefault()
              activateRow(activeIndex)
              return true
            }
            if (event.key === 'Escape') {
              closeList()
              return true
            }
            return false
          }
          const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
            onKeyDown(event)
            if (handleListKey(event) && event.key === 'Escape') event.currentTarget.blur()
          }
          return (
            <>
              <div
                ref={frameRef}
                className={styles.frame}
                data-disabled={fieldDisabled || undefined}
                data-leading={selected?.icon ? true : undefined}
              >
                {selected?.icon && (
                  <span className={styles.leading}>
                    <ChoiceMark icon={selected.icon} />
                  </span>
                )}
                <input
                  ref={ref as RefObject<HTMLInputElement>}
                  className={styles.input}
                  data-type='T043'
                  role='combobox'
                  aria-label={config.title || placeholder || subBlockId}
                  aria-expanded={listOpen}
                  aria-autocomplete='list'
                  placeholder={placeholder}
                  type='text'
                  value={inputValue}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  onKeyUp={trackCaret}
                  onClick={(event) => {
                    trackCaret(event)
                    openList()
                  }}
                  onFocus={(event) => {
                    onFocus(event)
                    trackCaret(event)
                    openList()
                  }}
                  onBlur={(event) => {
                    if (searchRef.current && event.relatedTarget === searchRef.current) return
                    closeList()
                  }}
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onWheel={handleWheel}
                  onScroll={(event) => {
                    if (overlayRef.current)
                      overlayRef.current.scrollLeft = event.currentTarget.scrollLeft
                  }}
                  autoComplete='off'
                  spellCheck={false}
                  disabled={fieldDisabled}
                />
                <div
                  ref={overlayRef}
                  className={styles.overlay}
                  data-type='T043'
                  aria-hidden='true'
                >
                  <span className={styles.overlayText}>
                    {formatDisplayText(inputValue, {
                      accessiblePrefixes,
                      highlightAll: !accessiblePrefixes,
                      workflowSearchHighlight,
                    })}
                  </span>
                </div>
                {!fieldDisabled && (
                  <span
                    role='presentation'
                    className={styles.trailing}
                    onPointerDown={() => {
                      chevronClosesRef.current = listOpen
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <IconButton
                      label={listOpen ? 'Hide options' : 'Show options'}
                      icon='I051'
                      size='row'
                      onClick={() => {
                        // The popup already dismissed itself on this press, as it was outside it.
                        const closes = chevronClosesRef.current || listOpen
                        chevronClosesRef.current = false
                        if (closes) closeList()
                        else {
                          ref.current?.focus()
                          openList()
                        }
                      }}
                    />
                  </span>
                )}
              </div>
              <FieldPopover
                label={`${config.title || subBlockId} options`}
                open={listOpen}
                anchor={frameRef}
                matchAnchorWidth
                onDismiss={closeList}
              >
                {searchable && (
                  <MenuSearchField
                    input={
                      <input
                        ref={searchRef}
                        type='search'
                        aria-label={`Search ${(config.title || subBlockId).toLowerCase()} options`}
                        placeholder='Search…'
                        value={listQuery}
                        autoComplete='off'
                        spellCheck={false}
                        onChange={(event) => {
                          setListQuery(event.target.value)
                          search.setQuery(event.target.value)
                          setActiveIndex(-1)
                        }}
                        onKeyDown={handleListKey}
                        onBlur={(event) => {
                          if (event.relatedTarget === ref.current) return
                          closeList()
                        }}
                      />
                    }
                  />
                )}
                {rows.map((row, index) =>
                  row.kind === 'create' && createAction ? (
                    <FieldPopoverRow
                      key='create'
                      index={index}
                      active={index === activeIndex}
                      leading={<Icon name='I074' />}
                      onHover={() => setActiveIndex(index)}
                      onSelect={startCreate}
                    >
                      {CREATE_ACTION_LABEL[createAction]}
                    </FieldPopoverRow>
                  ) : row.kind === 'choice' ? (
                    <FieldPopoverRow
                      key={row.choice.value}
                      index={index}
                      active={index === activeIndex}
                      leading={row.choice.icon ? <ChoiceMark icon={row.choice.icon} /> : undefined}
                      trailing={
                        row.choice.value === value ? (
                          <span className={styles.check}>
                            <Icon name='I072' />
                          </span>
                        ) : undefined
                      }
                      onHover={() => setActiveIndex(index)}
                      onSelect={() => selectChoice(row.choice)}
                    >
                      {row.choice.label}
                    </FieldPopoverRow>
                  ) : null
                )}
                {fetched.fetchError && <FieldPopoverNote>{fetched.fetchError}</FieldPopoverNote>}
                {!loading && !fetched.fetchError && listed.length === 0 && (
                  <FieldPopoverNote>
                    {fetched.truncated && searching
                      ? 'No matches in partial results'
                      : fetched.hasMore && searching
                        ? 'No matches in loaded options'
                        : fetched.hasMore
                          ? 'No options loaded'
                          : (inputValue && !exactMatch) || listQuery
                            ? 'No matching options found'
                            : 'No options available'}
                  </FieldPopoverNote>
                )}
                {fetched.hasMore ? (
                  <FieldPopoverRow
                    disabled={fetched.isFetchingMore || fetched.isLoadingAll}
                    onSelect={searching ? fetched.loadAll : fetched.loadMore}
                  >
                    {fetched.isFetchingMore || fetched.isLoadingAll
                      ? searching
                        ? 'Searching options…'
                        : 'Loading options…'
                      : fetched.fetchError
                        ? 'Try again'
                        : searching
                          ? 'Search all options'
                          : 'Load more'}
                  </FieldPopoverRow>
                ) : (
                  fetched.truncated &&
                  listed.length > 0 && <FieldPopoverNote>Showing partial results</FieldPopoverNote>
                )}
              </FieldPopover>
            </>
          )
        }}
      </SubBlockInputController>
      {config.createAction === 'sandbox' && (
        <SandboxCreateModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaultLanguage={createLanguage}
          onCreated={(sandbox) => {
            setCreatedOption({ label: sandbox.name, id: sandbox.id })
            setStoreValue(sandbox.id)
          }}
        />
      )}
    </div>
  )
})
