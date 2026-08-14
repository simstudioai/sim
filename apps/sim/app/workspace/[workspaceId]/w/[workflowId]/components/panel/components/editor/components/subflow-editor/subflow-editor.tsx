'use client'

import {
  ChipCombobox,
  Code as CodeEditor,
  cn,
  getCodeEditorProps,
  Label,
  thinScrollbarClass,
} from '@sim/emcn'
import SimpleCodeEditor from 'react-simple-code-editor'
import { WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS } from '@/lib/workflows/search-replace/subflow-fields'
import { AvailableData } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/available-data'
import { WORKFLOW_SEARCH_HIGHLIGHT_CLASS } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/constants'
import {
  formatDisplayText,
  getValidWorkflowSearchRange,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { ReferenceTextInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/reference-text-control'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { getActiveWorkflowSearchHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import type { ConnectedBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks/use-block-connections'
import { useSubflowEditor } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks/use-subflow-editor'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import type { BlockState } from '@/stores/workflows/workflow/types'

const WORKFLOW_SEARCH_MATCH_PLACEHOLDER = '__WORKFLOW_SEARCH_MATCH__'

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

interface SubflowEditorProps {
  currentBlock: BlockState
  currentBlockId: string
  subBlocksRef: React.RefObject<HTMLDivElement | null>
  hasIncomingConnections: boolean
  incomingConnections: ConnectedBlock[]
  userCanEdit: boolean
  isAvailableDataOpen: boolean
  onAvailableDataOpenChange: (open: boolean) => void
}

/**
 * SubflowEditor component for editing loop and parallel blocks
 *
 * @param props - Component props
 * @returns Rendered subflow editor
 */
export function SubflowEditor({
  currentBlock,
  currentBlockId,
  subBlocksRef,
  hasIncomingConnections,
  incomingConnections,
  userCanEdit,
  isAvailableDataOpen,
  onAvailableDataOpenChange,
}: SubflowEditorProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const {
    subflowConfig,
    currentType,
    isCountMode,
    isConditionMode,
    inputValue,
    batchSizeValue,
    editorValue,
    typeOptions,
    showTagDropdown,
    cursorPosition,
    editorContainerRef,
    handleSubflowTypeChange,
    handleSubflowIterationsChange,
    handleSubflowIterationsBlur,
    handleParallelBatchSizeChange,
    handleParallelBatchSizeBlur,
    handleSubflowEditorChange,
    handleSubflowTagSelect,
    highlightWithReferences,
    setShowTagDropdown,
  } = useSubflowEditor(currentBlock, currentBlockId)

  if (!subflowConfig) return null

  const configSearchFieldId = isCountMode
    ? WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations
    : isConditionMode
      ? WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.condition
      : WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.items
  const configSearchHighlight = getActiveWorkflowSearchHighlight({
    activeSearchTarget,
    subBlockId: configSearchFieldId,
    valuePath: [],
    targetKind: 'subflow',
  })
  const batchSizeSearchHighlight = getActiveWorkflowSearchHighlight({
    activeSearchTarget,
    subBlockId: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.batchSize,
    valuePath: [],
    targetKind: 'subflow',
  })
  const highlightEditorValue = (value: string) => {
    const workflowSearchRange = getValidWorkflowSearchRange(value, configSearchHighlight)
    if (!workflowSearchRange) return highlightWithReferences(value)
    const highlightedValue = highlightWithReferences(
      `${value.slice(0, workflowSearchRange.start)}${WORKFLOW_SEARCH_MATCH_PLACEHOLDER}${value.slice(workflowSearchRange.end)}`
    )
    return highlightedValue.replace(
      WORKFLOW_SEARCH_MATCH_PLACEHOLDER,
      `<mark class="${WORKFLOW_SEARCH_HIGHLIGHT_CLASS}">${escapeHtml(value.slice(workflowSearchRange.start, workflowSearchRange.end))}</mark>`
    )
  }

  return (
    <div className='flex flex-1 flex-col overflow-hidden pt-[0px]'>
      <div ref={subBlocksRef} className='subblocks-section flex flex-1 flex-col overflow-hidden'>
        <div
          className={cn(
            'flex-1 overflow-y-auto overflow-x-hidden px-2 pt-[9px] pb-2',
            thinScrollbarClass
          )}
        >
          <div
            data-workflow-search-subblock-id={WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.type}
            data-workflow-search-canonical-id={WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.type}
            className='rounded-md'
          >
            <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
              {currentBlock.type === 'loop' ? 'Loop Type' : 'Parallel Type'}
            </Label>
            <ChipCombobox
              options={typeOptions}
              value={currentType || ''}
              onChange={handleSubflowTypeChange}
              disabled={!userCanEdit}
              placeholder='Select type...'
            />
          </div>

          <div
            data-workflow-search-subblock-id={configSearchFieldId}
            data-workflow-search-canonical-id={configSearchFieldId}
            className='rounded-md'
          >
            <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
              {isCountMode
                ? `${currentBlock.type === 'loop' ? 'Loop' : 'Parallel'} Iterations`
                : isConditionMode
                  ? 'While Condition'
                  : `${currentBlock.type === 'loop' ? 'Collection' : 'Parallel'} Items`}
            </Label>

            {isCountMode ? (
              <div className='relative'>
                <ReferenceTextInput
                  type='text'
                  value={inputValue}
                  onChange={handleSubflowIterationsChange}
                  onBlur={handleSubflowIterationsBlur}
                  disabled={!userCanEdit}
                  className='mb-1'
                  overlayContent={
                    <div className='min-w-fit whitespace-pre'>
                      {formatDisplayText(inputValue, {
                        workflowSearchHighlight: configSearchHighlight,
                      })}
                    </div>
                  }
                />
                <div className='text-[var(--text-muted)] text-micro'>
                  Enter a whole number greater than 0.
                </div>
              </div>
            ) : (
              <div ref={editorContainerRef} className='relative'>
                <CodeEditor.Container>
                  <CodeEditor.Content>
                    <CodeEditor.Placeholder gutterWidth={0} show={editorValue.length === 0}>
                      {isConditionMode ? '<counter.value> < 10' : "['item1', 'item2', 'item3']"}
                    </CodeEditor.Placeholder>

                    <SimpleCodeEditor
                      value={editorValue}
                      onValueChange={handleSubflowEditorChange}
                      highlight={highlightEditorValue}
                      {...getCodeEditorProps({
                        isPreview: false,
                        disabled: !userCanEdit,
                      })}
                    />

                    {showTagDropdown && (
                      <TagDropdown
                        visible={showTagDropdown}
                        onSelect={handleSubflowTagSelect}
                        blockId={currentBlockId}
                        activeSourceBlockId={null}
                        inputValue={editorValue}
                        cursorPosition={cursorPosition}
                        onClose={() => setShowTagDropdown(false)}
                        inputRef={{
                          current: editorContainerRef.current?.querySelector(
                            'textarea'
                          ) as HTMLTextAreaElement,
                        }}
                      />
                    )}
                  </CodeEditor.Content>
                </CodeEditor.Container>
              </div>
            )}
          </div>

          {currentBlock.type === 'parallel' && (
            <div
              data-workflow-search-subblock-id={WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.batchSize}
              data-workflow-search-canonical-id={WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.batchSize}
              className='relative mt-4 rounded-md'
            >
              <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
                Parallel Batch Size
              </Label>
              <ReferenceTextInput
                type='text'
                value={batchSizeValue}
                onChange={handleParallelBatchSizeChange}
                onBlur={handleParallelBatchSizeBlur}
                disabled={!userCanEdit}
                className='mb-1'
                overlayContent={
                  <div className='min-w-fit whitespace-pre'>
                    {formatDisplayText(batchSizeValue, {
                      workflowSearchHighlight: batchSizeSearchHighlight,
                    })}
                  </div>
                }
              />
              <div className='text-[var(--text-muted)] text-micro'>
                Run 1 to 20 parallel branches at a time.
              </div>
            </div>
          )}
        </div>
      </div>

      {hasIncomingConnections && (
        <AvailableData
          connections={incomingConnections}
          open={isAvailableDataOpen}
          onOpenChange={onAvailableDataOpenChange}
        />
      )}
    </div>
  )
}
