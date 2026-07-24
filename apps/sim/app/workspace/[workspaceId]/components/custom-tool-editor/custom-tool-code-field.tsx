'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ChipTag,
  CODE_LINE_HEIGHT_PX,
  cn,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import {
  CODE_PLACEHOLDER,
  type SchemaParameter,
} from '@/app/workspace/[workspaceId]/components/custom-tool-editor/custom-tool-schema'
import type { useCodeGeneration } from '@/app/workspace/[workspaceId]/components/custom-tool-editor/use-custom-tool-generation'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { CodeEditor } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/code-editor/code-editor'

const logger = createLogger('CustomToolCodeField')

interface CustomToolCodeFieldProps {
  value: string
  onChange: (value: string) => void
  error: boolean
  generation: ReturnType<typeof useCodeGeneration>
  schemaParameters: SchemaParameter[]
  workspaceId: string
  /**
   * Workflow block the editor is embedded in. Only present on the canvas —
   * without it there is no upstream block output to reference, so the `<`
   * tag autocomplete is not offered.
   */
  blockId?: string
}

interface TriggerState {
  show: boolean
  searchTerm: string
}

function checkSchemaParamTrigger(
  text: string,
  cursorPos: number,
  parameters: SchemaParameter[]
): TriggerState {
  if (parameters.length === 0) return { show: false, searchTerm: '' }

  const currentWord = text.slice(0, cursorPos).match(/[a-zA-Z_]\w*$/)?.[0] ?? ''
  if (!currentWord) return { show: false, searchTerm: '' }

  const lower = currentWord.toLowerCase()
  const hasMatch = parameters.some((param) => param.name.toLowerCase().startsWith(lower))
  return { show: hasMatch, searchTerm: currentWord }
}

/**
 * The code half of the custom tool editor: the available-parameters strip, the
 * JavaScript editor, and its three caret-anchored autocompletes (environment
 * variables, upstream block tags, and schema parameters). The surrounding
 * surface owns the section label, the "Generate" action, and the error message.
 */
export function CustomToolCodeField({
  value,
  onChange,
  error,
  generation,
  schemaParameters,
  workspaceId,
  blockId,
}: CustomToolCodeFieldProps) {
  const codeEditorRef = useRef<HTMLDivElement>(null)
  const schemaParamItemRefs = useRef<Map<number, HTMLElement> | null>(null)
  schemaParamItemRefs.current ??= new Map()

  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [showSchemaParams, setShowSchemaParams] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const [schemaParamSelectedIndex, setSchemaParamSelectedIndex] = useState(0)

  const busy = generation.isLoading || generation.isStreaming
  const resolvedMinHeight = schemaParameters.length > 0 ? '380px' : '420px'

  useEffect(() => {
    if (!showSchemaParams || schemaParamSelectedIndex < 0) return
    const element = schemaParamItemRefs.current?.get(schemaParamSelectedIndex)
    element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [schemaParamSelectedIndex, showSchemaParams])

  const handleChange = (newValue: string) => {
    onChange(newValue)
    if (busy) return

    const textarea = codeEditorRef.current?.querySelector('textarea')
    if (!textarea) return

    const pos = textarea.selectionStart
    setCursorPosition(pos)

    const textBeforeCursor = newValue.substring(0, pos)
    const lines = textBeforeCursor.split('\n')
    const currentLine = lines.length
    const currentCol = lines[lines.length - 1].length

    try {
      if (codeEditorRef.current) {
        const editorRect = codeEditorRef.current.getBoundingClientRect()
        setDropdownPosition({
          top: currentLine * CODE_LINE_HEIGHT_PX + 5,
          left: Math.min(currentCol * 8, editorRect.width - 260),
        })
      }
    } catch (error) {
      logger.error('Error calculating cursor position:', { error })
    }

    const envVarTrigger = checkEnvVarTrigger(newValue, pos)
    setShowEnvVars(envVarTrigger.show)
    setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

    if (blockId) {
      const tagTrigger = checkTagTrigger(newValue, pos)
      setShowTags(tagTrigger.show)
      if (!tagTrigger.show) setActiveSourceBlockId(null)
    }

    if (schemaParameters.length > 0) {
      const schemaParamTrigger = checkSchemaParamTrigger(newValue, pos, schemaParameters)
      if (schemaParamTrigger.show && !showSchemaParams) {
        setShowSchemaParams(true)
        setSchemaParamSelectedIndex(0)
      } else if (!schemaParamTrigger.show && showSchemaParams) {
        setShowSchemaParams(false)
      }
    }
  }

  const handleSchemaParamSelect = (paramName: string) => {
    const textarea = codeEditorRef.current?.querySelector('textarea')
    if (!textarea) return

    const pos = textarea.selectionStart
    const beforeCursor = value.substring(0, pos)
    const afterCursor = value.substring(pos)

    const words = beforeCursor.split(/[\s=();,{}[\]]+/)
    const currentWord = words[words.length - 1] || ''
    const wordStart = beforeCursor.lastIndexOf(currentWord)

    onChange(beforeCursor.substring(0, wordStart) + paramName + afterCursor)
    setShowSchemaParams(false)

    requestAnimationFrame(() => {
      textarea.focus()
      const caret = wordStart + paramName.length
      textarea.setSelectionRange(caret, caret)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showEnvVars || showTags || showSchemaParams) {
        setShowEnvVars(false)
        setShowTags(false)
        setShowSchemaParams(false)
        e.preventDefault()
        e.stopPropagation()
        return
      }
    }

    if (generation.isStreaming) {
      e.preventDefault()
      return
    }

    if (showSchemaParams && schemaParameters.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setSchemaParamSelectedIndex((prev) => Math.min(prev + 1, schemaParameters.length - 1))
          return
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setSchemaParamSelectedIndex((prev) => Math.max(prev - 1, 0))
          return
        case 'Enter': {
          e.preventDefault()
          e.stopPropagation()
          const selectedParam = schemaParameters[schemaParamSelectedIndex]
          if (selectedParam) handleSchemaParamSelect(selectedParam.name)
          return
        }
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          setShowSchemaParams(false)
          return
        case ' ':
        case 'Tab':
          setShowSchemaParams(false)
          return
      }
    }

    if (showEnvVars || showTags) {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
  }

  return (
    <div className='flex flex-col'>
      {schemaParameters.length > 0 && (
        <div className='mb-2 flex flex-wrap items-center gap-1.5'>
          <span className='text-[var(--text-muted)] text-caption'>Available parameters:</span>
          {schemaParameters.map((param) => (
            <ChipTag key={param.name} variant='gray'>
              {param.name}
            </ChipTag>
          ))}
          <span className='text-[var(--text-muted)] text-caption'>
            Start typing a parameter name for autocomplete.
          </span>
        </div>
      )}

      <div ref={codeEditorRef} className='relative'>
        <CodeEditor
          value={value}
          onChange={handleChange}
          language='javascript'
          placeholder={CODE_PLACEHOLDER}
          minHeight={resolvedMinHeight}
          error={error && !generation.isStreaming}
          className={cn(busy && 'cursor-not-allowed opacity-50')}
          highlightVariables={true}
          disabled={busy}
          onKeyDown={handleKeyDown}
          schemaParameters={schemaParameters}
        />

        {showEnvVars && (
          <EnvVarDropdown
            visible={showEnvVars}
            onSelect={(newValue) => {
              onChange(newValue)
              setShowEnvVars(false)
            }}
            searchTerm={searchTerm}
            inputValue={value}
            cursorPosition={cursorPosition}
            workspaceId={workspaceId}
            onClose={() => {
              setShowEnvVars(false)
              setSearchTerm('')
            }}
            className='w-64'
            style={{
              position: 'absolute',
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
            }}
          />
        )}

        {showTags && blockId && (
          <TagDropdown
            visible={showTags}
            onSelect={(newValue) => {
              onChange(newValue)
              setShowTags(false)
              setActiveSourceBlockId(null)
            }}
            blockId={blockId}
            activeSourceBlockId={activeSourceBlockId}
            inputValue={value}
            cursorPosition={cursorPosition}
            onClose={() => {
              setShowTags(false)
              setActiveSourceBlockId(null)
            }}
            className='w-64'
            style={{
              position: 'absolute',
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
            }}
          />
        )}

        {showSchemaParams && schemaParameters.length > 0 && (
          <Popover
            open={showSchemaParams}
            onOpenChange={(open) => {
              if (!open) setShowSchemaParams(false)
            }}
            colorScheme='inverted'
          >
            <PopoverAnchor asChild>
              <div
                className='pointer-events-none'
                style={{
                  position: 'absolute',
                  top: `${dropdownPosition.top}px`,
                  left: `${dropdownPosition.left}px`,
                  width: '1px',
                  height: '1px',
                }}
              />
            </PopoverAnchor>
            <PopoverContent
              maxHeight={240}
              className='min-w-[280px]'
              side='bottom'
              align='start'
              collisionPadding={6}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <PopoverScrollArea>
                <PopoverSection>Available Parameters</PopoverSection>
                {schemaParameters.map((param, index) => (
                  <PopoverItem
                    key={param.name}
                    rootOnly
                    active={index === schemaParamSelectedIndex}
                    onMouseEnter={() => setSchemaParamSelectedIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleSchemaParamSelect(param.name)
                    }}
                    ref={(el) => {
                      if (el) schemaParamItemRefs.current?.set(index, el)
                    }}
                  >
                    <span className='flex-1 truncate'>{param.name}</span>
                    {param.type && param.type !== 'any' && (
                      <span className='ml-auto text-[var(--text-muted-inverse)] text-micro'>
                        {param.type}
                      </span>
                    )}
                  </PopoverItem>
                ))}
              </PopoverScrollArea>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  )
}
