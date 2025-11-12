'use client'

import { ChevronUp } from 'lucide-react'
import SimpleCodeEditor from 'react-simple-code-editor'
import { Code as CodeEditor, Combobox, getCodeEditorProps, Input, Label } from '@/components/emcn'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import type { BlockState } from '@/stores/workflows/workflow/types'
import type { ConnectedBlock } from '../../hooks/use-block-connections'
import { useSubflowEditor } from '../../hooks/use-subflow-editor'
import { ConnectionBlocks } from '../connection-blocks'

interface SubflowEditorProps {
  currentBlock: BlockState
  currentBlockId: string
  subBlocksRef: React.RefObject<HTMLDivElement | null>
  connectionsHeight: number
  isResizing: boolean
  hasIncomingConnections: boolean
  incomingConnections: ConnectedBlock[]
  handleConnectionsResizeMouseDown: (e: React.MouseEvent) => void
  toggleConnectionsCollapsed: () => void
  userCanEdit: boolean
  isConnectionsAtMinHeight: boolean
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
  connectionsHeight,
  isResizing,
  hasIncomingConnections,
  incomingConnections,
  handleConnectionsResizeMouseDown,
  toggleConnectionsCollapsed,
  userCanEdit,
  isConnectionsAtMinHeight,
}: SubflowEditorProps) {
  const {
    subflowConfig,
    currentType,
    isCountMode,
    isConditionMode,
    inputValue,
    editorValue,
    typeOptions,
    showTagDropdown,
    cursorPosition,
    editorContainerRef,
    handleSubflowTypeChange,
    handleSubflowIterationsChange,
    handleSubflowIterationsSave,
    handleSubflowEditorChange,
    handleSubflowTagSelect,
    highlightWithReferences,
    setShowTagDropdown,
  } = useSubflowEditor(currentBlock, currentBlockId)

  if (!subflowConfig) return null

  return (
    <div className='flex flex-1 flex-col overflow-hidden pt-[0px]'>
      {/* Subflow Editor Section */}
      <div ref={subBlocksRef} className='subblocks-section flex flex-1 flex-col overflow-hidden'>
        <div className='flex-1 overflow-y-auto overflow-x-hidden px-[8px] pt-[5px] pb-[8px]'>
          {/* Type Selection */}
          <div>
            <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              {currentBlock.type === 'loop' ? 'Loop Type' : 'Parallel Type'}
            </Label>
            <Combobox
              options={typeOptions}
              value={currentType || ''}
              onChange={handleSubflowTypeChange}
              disabled={!userCanEdit}
              placeholder='Select type...'
            />
          </div>

          {/* Dashed Line Separator */}
          <div className='px-[2px] pt-[16px] pb-[10px]'>
            <div
              className='h-[1.25px]'
              style={{
                backgroundImage:
                  'repeating-linear-gradient(to right, #2C2C2C 0px, #2C2C2C 6px, transparent 6px, transparent 12px)',
              }}
            />
          </div>

          {/* Configuration */}
          <div>
            <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              {isCountMode
                ? `${currentBlock.type === 'loop' ? 'Loop' : 'Parallel'} Iterations`
                : isConditionMode
                  ? 'While Condition'
                  : `${currentBlock.type === 'loop' ? 'Collection' : 'Parallel'} Items`}
            </Label>

            {isCountMode ? (
              <div>
                <Input
                  type='text'
                  value={inputValue}
                  onChange={handleSubflowIterationsChange}
                  onBlur={handleSubflowIterationsSave}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubflowIterationsSave()}
                  disabled={!userCanEdit}
                  className='mb-[4px]'
                />
                <div className='text-[10px] text-muted-foreground'>
                  Enter a number between 1 and {subflowConfig.maxIterations}
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
                      highlight={highlightWithReferences}
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
        </div>
      </div>

      {/* Connections Section - Only show when there are connections */}
      {hasIncomingConnections && (
        <div
          className={
            'connections-section flex flex-shrink-0 flex-col overflow-hidden border-[var(--border)] border-t dark:border-[var(--border)]' +
            (!isResizing ? ' transition-[height] duration-100 ease-out' : '')
          }
          style={{ height: `${connectionsHeight}px` }}
        >
          {/* Resize Handle */}
          <div className='relative'>
            <div
              className='absolute top-[-4px] right-0 left-0 z-30 h-[8px] cursor-ns-resize'
              onMouseDown={handleConnectionsResizeMouseDown}
            />
          </div>

          {/* Connections Header with Chevron */}
          <div
            className='flex flex-shrink-0 cursor-pointer items-center gap-[8px] px-[10px] pt-[5px] pb-[5px]'
            onClick={toggleConnectionsCollapsed}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggleConnectionsCollapsed()
              }
            }}
            role='button'
            tabIndex={0}
            aria-label={isConnectionsAtMinHeight ? 'Expand connections' : 'Collapse connections'}
          >
            <ChevronUp
              className={
                'h-[14px] w-[14px] transition-transform' +
                (!isConnectionsAtMinHeight ? ' rotate-180' : '')
              }
            />
            <div className='font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              Connections
            </div>
          </div>

          {/* Connections Content - Always visible */}
          <div className='flex-1 overflow-y-auto overflow-x-hidden px-[6px] pb-[8px]'>
            <ConnectionBlocks connections={incomingConnections} currentBlockId={currentBlock.id} />
          </div>
        </div>
      )}
    </div>
  )
}
