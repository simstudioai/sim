'use client'

import {
  createRef,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
  useMemo,
  useRef,
  useState,
} from 'react'
import { IconButton } from '@sim/emcn/button'
import { EnvVarDropdown } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/env-var-dropdown/env-var-dropdown'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { CodeField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/code-field/code-field'
import { highlightCode } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/code-field/highlight'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/condition-input/condition-input.module.css'
import { RouteDescription } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/condition-input/route-description'
import { getActiveWorkflowSearchHighlight } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import { TagDropdown } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/tag-dropdown/tag-dropdown'
import {
  checkTagTrigger,
  createShouldHighlightEnvVar,
  isAccessibleCodeReference,
  useAccessibleReferencePrefixes,
  useAvailableEnvVarKeys,
  useSubBlockValue,
  useTagSelection,
  useWorkflowScope,
  useWorkflowStore,
} from '@/platform/lib/data/workflow-editor'
import {
  type ConditionalBlock,
  type ConditionInputMode,
  checkEnvVarTrigger,
  conditionValueText,
  createConditionBranch,
  createDefaultConditionBlocks,
  isElseConditionTitle,
  parseConditionBlocks,
  readConnectionDrop,
  withConditionTitles,
} from '@/platform/lib/data/workflow-editor/code'

/** How long a branch keeps its pickers after losing focus, so a click into one still lands. */
const BLUR_SETTLE_MS = 150

/** Puts the caret back after React commits a picker's insertion, so it lands after the text. */
function placeCaret(textarea: HTMLTextAreaElement | null, position: number) {
  setTimeout(() => {
    if (!textarea) return
    textarea.focus()
    textarea.selectionStart = position
    textarea.selectionEnd = position
  })
}

interface SyncedValue {
  blockId: string
  text: string | null
}

interface ConditionInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  /** A Condition block's `if` / `else if` / `else` branches, or a Router block's routes. */
  mode?: ConditionInputMode
}

/**
 * A Condition block's branches or a Router block's routes. Each condition branch edits a
 * JavaScript expression and each route a description the model reads, with the `<` and `{{`
 * pickers at the caret and dropped connections. Branches can be added after any branch but
 * `else`, reordered and deleted (deleting one also removes the canvas edges leaving it). The value
 * is stored as the same JSON the canvas reads its branch handles from.
 */
export function ConditionInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  mode = 'condition',
}: ConditionInputProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const isRouterMode = mode === 'router'
  const { workspaceId } = useWorkflowScope()
  const [storeValue, setStoreValue] = useSubBlockValue<unknown>(blockId, subBlockId)
  const emitTagSelection = useTagSelection(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId)
  const batchRemoveEdges = useWorkflowStore((state) => state.batchRemoveEdges)
  const isEnvVar = useMemo(() => createShouldHighlightEnvVar(availableEnvVars), [availableEnvVars])
  const textareaRefsRef = useRef<Map<string, RefObject<HTMLTextAreaElement | null>> | null>(null)
  const textareaRefs = (textareaRefsRef.current ??= new Map())

  const storedText = conditionValueText(isPreview ? previewValue : storeValue)
  const readBlocks = (text: string | null) => {
    const parsed = text === null ? null : parseConditionBlocks(text)
    return parsed ? withConditionTitles(parsed, mode) : null
  }

  const [blocks, setBlocks] = useState<ConditionalBlock[]>(
    () => readBlocks(storedText) ?? createDefaultConditionBlocks(blockId, mode)
  )
  const [synced, setSynced] = useState<SyncedValue>({ blockId, text: storedText })
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusedIdRef = useRef<string | null>(null)

  if (synced.blockId !== blockId) {
    setSynced({ blockId, text: storedText })
    setBlocks(readBlocks(storedText) ?? createDefaultConditionBlocks(blockId, mode))
  } else if (synced.text !== storedText) {
    setSynced({ blockId, text: storedText })
    const next = readBlocks(storedText)
    if (next) setBlocks(next)
  }

  const isLocked = isPreview || disabled
  const minBlocks = isRouterMode ? 1 : 2

  const refFor = (id: string): RefObject<HTMLTextAreaElement | null> => {
    const existing = textareaRefs.get(id)
    if (existing) return existing
    const created = createRef<HTMLTextAreaElement>()
    textareaRefs.set(id, created)
    return created
  }

  /** Commits an edit: shows it and stores it, as a tag selection when a picker made it. */
  const persist = (next: ConditionalBlock[], viaPicker = false) => {
    setBlocks(next)
    if (isPreview) return
    const json = JSON.stringify(next)
    if (json === synced.text) return
    setSynced({ blockId, text: json })
    if (viaPicker) emitTagSelection(json)
    else setStoreValue(json)
  }

  /** Changes only what the field shows (its pickers), which the store does not need to hear. */
  const updateView = (id: string, change: (block: ConditionalBlock) => ConditionalBlock) => {
    setBlocks((current) => current.map((block) => (block.id === id ? change(block) : block)))
  }

  const handleChange = (id: string, value: string, caret: number) => {
    if (isLocked) return
    const tagTrigger = checkTagTrigger(value, caret)
    const envVarTrigger = checkEnvVarTrigger(value, caret)
    persist(
      blocks.map((block) => {
        if (block.id !== id) return block
        if (isRouterMode) {
          return {
            ...block,
            value,
            showTags: tagTrigger.show,
            showEnvVars: envVarTrigger.show,
            searchTerm: envVarTrigger.show ? envVarTrigger.searchTerm : '',
            cursorPosition: caret,
          }
        }
        return {
          ...block,
          value,
          showTags: tagTrigger.show,
          showEnvVars: envVarTrigger.show,
          searchTerm: envVarTrigger.show ? envVarTrigger.searchTerm : '',
          cursorPosition: caret,
          activeSourceBlockId: tagTrigger.show ? block.activeSourceBlockId : null,
        }
      })
    )
  }

  const handleFocus = (block: ConditionalBlock) => {
    focusedIdRef.current = block.id
    setFocusedId(block.id)
    if (isLocked || block.value.trim() !== '') return
    updateView(block.id, (current) => ({ ...current, showTags: true, cursorPosition: 0 }))
  }

  /** Pickers only show for the focused branch; leaving it also clears them so a return starts clean. */
  const handleBlur = (id: string) => {
    if (focusedIdRef.current === id) focusedIdRef.current = null
    setFocusedId((current) => (current === id ? null : current))
    setTimeout(() => {
      if (focusedIdRef.current === id) return
      updateView(id, (current) => ({ ...current, showTags: false, showEnvVars: false }))
    }, BLUR_SETTLE_MS)
  }

  const handleKeyDown = (id: string, event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    updateView(id, (current) => ({
      ...current,
      showTags: false,
      showEnvVars: false,
      searchTerm: '',
    }))
  }

  const handleDrop = (id: string, event: DragEvent) => {
    if (isLocked) return
    event.preventDefault()
    const drop = readConnectionDrop(event.dataTransfer)
    if (!drop) return
    const textarea = textareaRefs.get(id)?.current ?? null
    const dropPosition = textarea?.selectionStart ?? 0
    persist(
      blocks.map((block) =>
        block.id === id
          ? {
              ...block,
              value: `${block.value.slice(0, dropPosition)}<${block.value.slice(dropPosition)}`,
              showTags: true,
              cursorPosition: dropPosition + 1,
              activeSourceBlockId: drop.sourceBlockId || null,
            }
          : block
      )
    )
    setTimeout(() => {
      if (!textarea) return
      textarea.selectionStart = dropPosition + 1
      textarea.selectionEnd = dropPosition + 1
      textarea.focus()
    })
  }

  const handleTagSelect = (id: string, value: string, caret: number) => {
    if (isLocked) return
    persist(
      blocks.map((block) =>
        block.id === id ? { ...block, value, showTags: false, activeSourceBlockId: null } : block
      ),
      true
    )
    placeCaret(textareaRefs.get(id)?.current ?? null, caret)
  }

  const handleEnvVarSelect = (id: string, value: string, caret: number) => {
    if (isLocked) return
    persist(
      blocks.map((block) =>
        block.id === id ? { ...block, value, showEnvVars: false, searchTerm: '' } : block
      ),
      true
    )
    placeCaret(textareaRefs.get(id)?.current ?? null, caret)
  }

  const addBlock = (afterId: string) => {
    if (isLocked) return
    const index = blocks.findIndex((block) => block.id === afterId)
    if (!isRouterMode && isElseConditionTitle(blocks[index]?.title)) return
    const branch = createConditionBranch(blockId, mode)
    const next = [...blocks]
    next.splice(index + 1, 0, branch)
    persist(withConditionTitles(next, mode))
    setTimeout(() => refFor(branch.id).current?.focus())
  }

  const removeBlock = (id: string) => {
    if (isLocked || blocks.length <= minBlocks) return
    const handlePrefix = isRouterMode ? `router-${id}` : `condition-${id}`
    const edgeIds = useWorkflowStore
      .getState()
      .edges.filter((edge) => edge.sourceHandle?.startsWith(handlePrefix))
      .map((edge) => edge.id)
    if (edgeIds.length > 0) batchRemoveEdges(edgeIds)
    textareaRefs.delete(id)
    persist(
      withConditionTitles(
        blocks.filter((block) => block.id !== id),
        mode
      )
    )
  }

  const moveBlock = (id: string, direction: 'up' | 'down') => {
    if (isLocked) return
    const index = blocks.findIndex((block) => block.id === id)
    if (index === -1 || isElseConditionTitle(blocks[index]?.title)) return
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === blocks.length - 1)
    )
      return
    const target = direction === 'up' ? index - 1 : index + 1
    if (direction === 'down' && isElseConditionTitle(blocks[target]?.title)) return
    const next = [...blocks]
    ;[next[index], next[target]] = [next[target], next[index]]
    persist(withConditionTitles(next, mode))
  }

  const noun = isRouterMode ? 'route' : 'condition'

  return (
    <div className={styles.branches}>
      {blocks.map((block, index) => {
        const isElse = !isRouterMode && isElseConditionTitle(block.title)
        const isNextElse = !isRouterMode && isElseConditionTitle(blocks[index + 1]?.title)
        const title = isRouterMode ? `Route ${index + 1}` : block.title
        const textareaRef = refFor(block.id)
        const search = getActiveWorkflowSearchHighlight({
          activeSearchTarget,
          blockId,
          subBlockId,
          valuePath: [index, 'value'],
        })
        const pickersOpen = focusedId === block.id && !isLocked
        const pickers = (
          <>
            {block.showEnvVars && pickersOpen && (
              <EnvVarDropdown
                visible={block.showEnvVars}
                onSelect={(value, caret) => handleEnvVarSelect(block.id, value, caret)}
                searchTerm={block.searchTerm}
                inputValue={block.value}
                cursorPosition={block.cursorPosition}
                workspaceId={workspaceId}
                onClose={() =>
                  updateView(block.id, (current) => ({
                    ...current,
                    showEnvVars: false,
                    searchTerm: '',
                  }))
                }
                inputRef={textareaRef}
              />
            )}
            {block.showTags && pickersOpen && (
              <TagDropdown
                visible={block.showTags}
                onSelect={(value, caret) => handleTagSelect(block.id, value, caret)}
                blockId={blockId}
                activeSourceBlockId={block.activeSourceBlockId}
                inputValue={block.value}
                cursorPosition={block.cursorPosition}
                onClose={() =>
                  updateView(block.id, (current) => ({
                    ...current,
                    showTags: false,
                    activeSourceBlockId: null,
                  }))
                }
                inputRef={textareaRef}
              />
            )}
          </>
        )
        return (
          <div key={block.id} className={styles.branch}>
            <div className={styles.branchHeader}>
              <span className={styles.branchTitle} data-type='T060'>
                {title}
              </span>
              {!isPreview && (
                <span className={styles.branchActions}>
                  <IconButton
                    label={`Add ${noun}`}
                    icon='I074'
                    size='compact'
                    tooltip
                    disabled={disabled || isElse}
                    onClick={() => addBlock(block.id)}
                  />
                  <IconButton
                    label='Move up'
                    icon='I023'
                    size='compact'
                    tooltip
                    disabled={disabled || index === 0 || isElse}
                    onClick={() => moveBlock(block.id, 'up')}
                  />
                  <IconButton
                    label='Move down'
                    icon='I102'
                    size='compact'
                    tooltip
                    disabled={disabled || index === blocks.length - 1 || isNextElse || isElse}
                    onClick={() => moveBlock(block.id, 'down')}
                  />
                  <IconButton
                    label={`Delete ${noun}`}
                    icon='I105'
                    size='compact'
                    tooltip
                    disabled={disabled || blocks.length <= minBlocks}
                    onClick={() => removeBlock(block.id)}
                  />
                </span>
              )}
            </div>
            {isRouterMode ? (
              <RouteDescription
                value={block.value}
                label={`${title} description`}
                disabled={isLocked}
                textareaRef={textareaRef}
                accessiblePrefixes={accessiblePrefixes}
                search={search}
                onChange={(value, caret) => handleChange(block.id, value, caret)}
                onFocus={() => handleFocus(block)}
                onBlur={() => handleBlur(block.id)}
                onKeyDown={(event) => handleKeyDown(block.id, event)}
                onDrop={(event) => handleDrop(block.id, event)}
              >
                {pickers}
              </RouteDescription>
            ) : (
              !isElse && (
                <CodeField
                  value={block.value}
                  onValueChange={(value) =>
                    handleChange(block.id, value, textareaRef.current?.selectionStart ?? 0)
                  }
                  highlight={(source) =>
                    highlightCode(source, 'javascript', {
                      isReference: (part) => isAccessibleCodeReference(part, accessiblePrefixes),
                      isEnvVar,
                      search,
                    })
                  }
                  label={`${title} condition`}
                  placeholder='<response> === true'
                  disabled={isLocked}
                  textareaRef={textareaRef}
                  onKeyDown={(event) => handleKeyDown(block.id, event)}
                  onFocus={() => handleFocus(block)}
                  onBlur={() => handleBlur(block.id)}
                  onDrop={isLocked ? undefined : (event) => handleDrop(block.id, event)}
                >
                  {pickers}
                </CodeField>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
