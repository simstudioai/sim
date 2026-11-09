'use client'

import { type RefObject, useCallback, useMemo, useRef, useState } from 'react'
import { SelectField } from '@sim/emcn/field'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { CodeField } from '@/app/(product)/workspace/[workspaceId]/_components/code-field/code-field'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { highlightCode } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/code-highlight'
import { getActiveWorkflowSearchHighlight } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import { ShortInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/short-input/short-input'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/subflow-editor/subflow-editor.module.css'
import { TagDropdown } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tag-dropdown/tag-dropdown'
import {
  type BlockState,
  checkTagTrigger,
  createShouldHighlightEnvVar,
  isAccessibleCodeReference,
  type SubBlockConfig,
  useAccessibleReferencePrefixes,
  useAvailableEnvVarKeys,
  useSubflowConfig,
  useWorkflowScope,
  WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS,
} from '@/platform/lib/data/workflow-editor'

const ITERATIONS_CONFIG = {
  id: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations,
  title: 'Iterations',
  type: 'short-input',
  connectionDroppable: false,
} as const satisfies SubBlockConfig

const BATCH_SIZE_CONFIG = {
  id: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.batchSize,
  title: 'Parallel Batch Size',
  type: 'short-input',
  connectionDroppable: false,
} as const satisfies SubBlockConfig

interface SubflowEditorProps {
  currentBlock: BlockState
  currentBlockId: string
  subBlocksRef: RefObject<HTMLDivElement | null>
  userCanEdit: boolean
}

/** Keeps the digits of a number field, holding the draft while it is typed. */
function useNumberDraft(value: number, commit: (next: number) => void) {
  const [draft, setDraft] = useState<string | null>(null)
  return {
    value: draft ?? String(value),
    onChange: (next: string) => {
      const digits = next.replace(/[^0-9]/g, '')
      setDraft(digits)
      const parsed = Number.parseInt(digits, 10)
      if (!Number.isNaN(parsed)) commit(parsed)
    },
    onBlur: () => setDraft(null),
  }
}

/**
 * A loop's or parallel's settings: its type, then the iteration count, collection or while
 * condition the type calls for, and a parallel's batch size.
 */
export function SubflowEditor({
  currentBlock,
  currentBlockId,
  subBlocksRef,
  userCanEdit,
}: SubflowEditorProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const { workspaceId } = useWorkflowScope()
  const config = useSubflowConfig(currentBlock, currentBlockId)
  const bodyRef = useScrollEdges<HTMLDivElement>('vertical', { viewport: subBlocksRef })
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)

  const iterations = useNumberDraft(config.iterations, config.setIterations)
  const batchSize = useNumberDraft(config.batchSize, config.setBatchSize)

  const accessiblePrefixes = useAccessibleReferencePrefixes(currentBlockId)
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId)
  const isEnvVar = useMemo(() => createShouldHighlightEnvVar(availableEnvVars), [availableEnvVars])

  const kindLabel = config.kind === 'loop' ? 'Loop' : 'Parallel'
  const configFieldId = config.isCountMode
    ? WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations
    : config.isConditionMode
      ? WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.condition
      : WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.items
  const editorSearch = getActiveWorkflowSearchHighlight({
    activeSearchTarget,
    subBlockId: configFieldId,
    valuePath: [],
    targetKind: 'subflow',
  })

  const highlight = useCallback(
    (code: string) =>
      highlightCode(code, 'javascript', {
        isReference: (segment) => isAccessibleCodeReference(segment, accessiblePrefixes),
        isEnvVar,
        search: editorSearch,
      }),
    [accessiblePrefixes, isEnvVar, editorSearch]
  )

  const handleEditorChange = (value: string) => {
    config.setEditorValue(value)
    const position = textareaRef.current?.selectionStart ?? 0
    setCursorPosition(position)
    setShowTags(checkTagTrigger(value, position).show)
  }

  const handleTagSelect = (value: string, nextCursor: number) => {
    config.setEditorValue(value)
    setShowTags(false)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.selectionStart = nextCursor
      textarea.selectionEnd = nextCursor
    })
  }

  const configLabel = config.isCountMode
    ? `${kindLabel} Iterations`
    : config.isConditionMode
      ? 'While Condition'
      : `${config.kind === 'loop' ? 'Collection' : 'Parallel'} Items`

  return (
    <div ref={bodyRef} className={styles.body}>
      <div className={styles.fields}>
        <div
          data-workflow-search-subblock-id={WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.type}
          data-workflow-search-canonical-id={WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.type}
        >
          <SelectField
            label={`${kindLabel} Type`}
            options={config.typeOptions}
            value={config.currentType}
            onValueChange={config.setType}
            disabled={!userCanEdit}
          />
        </div>

        <div
          className={styles.field}
          data-workflow-search-subblock-id={configFieldId}
          data-workflow-search-canonical-id={configFieldId}
        >
          <span className={styles.label} data-type='T059'>
            {configLabel}
          </span>
          {config.isCountMode ? (
            <>
              <ShortInput
                blockId={currentBlockId}
                subBlockId={ITERATIONS_CONFIG.id}
                config={ITERATIONS_CONFIG}
                value={iterations.value}
                onChange={iterations.onChange}
                onBlur={iterations.onBlur}
                disabled={!userCanEdit}
                allowReferences={false}
                workflowSearchTargetKind='subflow'
              />
              <span className={styles.hint} data-type='T052'>
                Enter a whole number greater than 0.
              </span>
            </>
          ) : (
            <CodeField
              label={configLabel}
              value={config.editorValue}
              onValueChange={handleEditorChange}
              highlight={highlight}
              placeholder={
                config.isConditionMode ? '<counter.value> < 10' : "['item1', 'item2', 'item3']"
              }
              disabled={!userCanEdit}
              lineNumbers={false}
              textareaRef={textareaRef}
            >
              <TagDropdown
                visible={showTags}
                onSelect={handleTagSelect}
                blockId={currentBlockId}
                activeSourceBlockId={null}
                inputValue={config.editorValue}
                cursorPosition={cursorPosition}
                onClose={() => setShowTags(false)}
                inputRef={textareaRef}
              />
            </CodeField>
          )}
        </div>

        {config.kind === 'parallel' && (
          <div
            className={styles.field}
            data-workflow-search-subblock-id={WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.batchSize}
            data-workflow-search-canonical-id={WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.batchSize}
          >
            <span className={styles.label} data-type='T059'>
              Parallel Batch Size
            </span>
            <ShortInput
              blockId={currentBlockId}
              subBlockId={BATCH_SIZE_CONFIG.id}
              config={BATCH_SIZE_CONFIG}
              value={batchSize.value}
              onChange={batchSize.onChange}
              onBlur={batchSize.onBlur}
              disabled={!userCanEdit}
              allowReferences={false}
              workflowSearchTargetKind='subflow'
            />
            <span className={styles.hint} data-type='T052'>
              Run 1 to 20 parallel branches at a time.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
