import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Wand2 } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'
import Editor from 'react-simple-code-editor'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useCodeGeneration } from '@/app/w/[id]/hooks/use-code-generation'
import { CodePromptBar } from '../../../../code-prompt-bar/code-prompt-bar'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

const logger = createLogger('Code')

interface CodeProps {
  blockId: string
  subBlockId: string
  isConnecting: boolean
  placeholder?: string
  language?: 'javascript' | 'json'
  generationType?: 'javascript-function-body' | 'json-schema'
}

if (typeof document !== 'undefined') {
  const styleId = 'code-dark-mode-fix'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      .dark .token.operator {
        color: #9cdcfe !important;
        background: transparent !important;
      }
      .dark .token.punctuation {
        color: #d4d4d4 !important;
      }
    `
    document.head.appendChild(style)
  }
}

export function Code({
  blockId,
  subBlockId,
  isConnecting,
  placeholder = 'Write JavaScript...',
  language = 'javascript',
  generationType = 'javascript-function-body',
}: CodeProps) {
  // Determine the AI prompt placeholder based on language
  const aiPromptPlaceholder =
    language === 'json'
      ? 'Describe the JSON schema to generate...'
      : 'Describe the JavaScript code to generate...'

  // State management
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [code, setCode] = useState<string>('')
  const [lineCount, setLineCount] = useState(1)
  const [showTags, setShowTags] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [visualLineHeights, setVisualLineHeights] = useState<number[]>([])
  const [isCollapsed, setIsCollapsed] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)

  // AI Code Generation Hook
  const handleStreamStart = () => {
    setCode('')
    // Optionally clear the store value too, though handleStreamChunk will update it
    // setStoreValue('')
  }

  const handleGeneratedContent = (generatedCode: string) => {
    setCode(generatedCode)
    setStoreValue(generatedCode)
  }

  // Handle streaming chunks directly into the editor
  const handleStreamChunk = (chunk: string) => {
    setCode((currentCode) => {
      const newCode = currentCode + chunk
      setStoreValue(newCode)
      return newCode
    })
  }

  const {
    isLoading: isAiLoading,
    isStreaming: isAiStreaming,
    generate: generateCode,
    generateStream: generateCodeStream,
    cancelGeneration,
    isPromptVisible,
    showPromptInline,
    hidePromptInline,
    promptInputValue,
    updatePromptValue,
  } = useCodeGeneration({
    generationType: generationType,
    initialContext: code,
    onGeneratedContent: handleGeneratedContent,
    onStreamChunk: handleStreamChunk,
    onStreamStart: handleStreamStart,
  })

  // Effects
  useEffect(() => {
    const valueString = storeValue?.toString() ?? ''
    if (valueString !== code) {
      setCode(valueString)
    }
  }, [storeValue])

  useEffect(() => {
    if (!editorRef.current) return

    const calculateVisualLines = () => {
      const preElement = editorRef.current?.querySelector('pre')
      if (!preElement) return

      const lines = code.split('\n')
      const newVisualLineHeights: number[] = []

      const tempContainer = document.createElement('div')
      tempContainer.style.cssText = `
        position: absolute;
        visibility: hidden;
        height: auto;
        width: ${preElement.clientWidth}px;
        font-family: ${window.getComputedStyle(preElement).fontFamily};
        font-size: ${window.getComputedStyle(preElement).fontSize};
        line-height: 21px;
        padding: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        box-sizing: border-box;
      `
      document.body.appendChild(tempContainer)

      lines.forEach((line) => {
        const lineDiv = document.createElement('div')

        if (line.includes('<') && line.includes('>')) {
          const parts = line.split(/(<[^>]+>)/g)
          parts.forEach((part) => {
            const span = document.createElement('span')
            span.textContent = part
            if (part.startsWith('<') && part.endsWith('>')) {
            }
            lineDiv.appendChild(span)
          })
        } else {
          lineDiv.textContent = line || ' '
        }

        tempContainer.appendChild(lineDiv)
        const actualHeight = lineDiv.getBoundingClientRect().height
        const lineUnits = Math.max(1, Math.ceil(actualHeight / 21))
        newVisualLineHeights.push(lineUnits)
        tempContainer.removeChild(lineDiv)
      })

      document.body.removeChild(tempContainer)
      setVisualLineHeights(newVisualLineHeights)
      setLineCount(newVisualLineHeights.reduce((sum, height) => sum + height, 0))
    }

    const timeoutId = setTimeout(calculateVisualLines, 50)

    const resizeObserver = new ResizeObserver(calculateVisualLines)
    if (editorRef.current) {
      resizeObserver.observe(editorRef.current)
    }

    return () => {
      clearTimeout(timeoutId)
      resizeObserver.disconnect()
    }
  }, [code])

  // Handlers
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const textarea = editorRef.current?.querySelector('textarea')
      const dropPosition = textarea?.selectionStart ?? code.length
      const newValue = code.slice(0, dropPosition) + '<' + code.slice(dropPosition)

      setCode(newValue)
      setStoreValue(newValue)
      const newCursorPosition = dropPosition + 1
      setCursorPosition(newCursorPosition)

      setShowTags(true)
      if (data.connectionData?.sourceBlockId) {
        setActiveSourceBlockId(data.connectionData.sourceBlockId)
      }

      setTimeout(() => {
        if (textarea) {
          textarea.focus()
          textarea.selectionStart = newCursorPosition
          textarea.selectionEnd = newCursorPosition
        }
      }, 0)
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  const handleTagSelect = (newValue: string) => {
    setCode(newValue)
    setStoreValue(newValue)
    setShowTags(false)
    setActiveSourceBlockId(null)

    setTimeout(() => {
      editorRef.current?.querySelector('textarea')?.focus()
    }, 0)
  }

  const handleEnvVarSelect = (newValue: string) => {
    setCode(newValue)
    setStoreValue(newValue)
    setShowEnvVars(false)

    setTimeout(() => {
      editorRef.current?.querySelector('textarea')?.focus()
    }, 0)
  }

  // Render helpers
  const renderLineNumbers = () => {
    const numbers: ReactElement[] = []
    let lineNumber = 1

    visualLineHeights.forEach((height, index) => {
      numbers.push(
        <div key={`${lineNumber}-0`} className={cn('text-xs text-muted-foreground leading-[21px]')}>
          {lineNumber}
        </div>
      )
      for (let i = 1; i < height; i++) {
        numbers.push(
          <div
            key={`${lineNumber}-${i}`}
            className={cn('text-xs text-muted-foreground leading-[21px] invisible')}
          >
            {lineNumber}
          </div>
        )
      }
      lineNumber++
    })

    if (numbers.length === 0) {
      numbers.push(
        <div key="1-0" className={cn('text-xs text-muted-foreground leading-[21px]')}>
          1
        </div>
      )
    }

    return numbers
  }

  return (
    <>
      <CodePromptBar
        isVisible={isPromptVisible}
        isLoading={isAiLoading}
        isStreaming={isAiStreaming}
        promptValue={promptInputValue}
        onSubmit={(prompt: string) => generateCodeStream({ prompt, context: code })}
        onCancel={isAiStreaming ? cancelGeneration : hidePromptInline}
        onChange={updatePromptValue}
        placeholder={aiPromptPlaceholder}
      />

      <div
        className={cn(
          'relative min-h-[100px] rounded-md border bg-background font-mono text-sm group',
          isConnecting && 'ring-2 ring-blue-500 ring-offset-2'
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="absolute right-3 top-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isCollapsed && !isAiStreaming && (
            <Button
              variant="ghost"
              size="icon"
              onClick={isPromptVisible ? hidePromptInline : showPromptInline}
              disabled={isAiLoading || isAiStreaming}
              aria-label="Generate code with AI"
              className="h-8 w-8 rounded-full bg-muted/80 hover:bg-muted shadow-sm hover:shadow text-muted-foreground hover:text-primary transition-all duration-200 border border-transparent hover:border-primary/20"
            >
              <Wand2 className="h-4 w-4" />
            </Button>
          )}

          {code.split('\n').length > 5 && !isAiStreaming && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={isCollapsed ? 'Expand code' : 'Collapse code'}
              className="h-8 px-2 text-muted-foreground hover:text-foreground"
            >
              <span className="text-xs">{isCollapsed ? 'Expand' : 'Collapse'}</span>
            </Button>
          )}
        </div>

        <div
          className="absolute left-0 top-0 bottom-0 w-[30px] bg-muted/30 flex flex-col items-end pr-3 pt-3 select-none overflow-hidden"
          aria-hidden="true"
        >
          {renderLineNumbers()}
        </div>

        <div
          className={cn(
            'pl-[30px] pt-0 mt-0 relative',
            isCollapsed && 'max-h-[126px] overflow-hidden',
            isAiStreaming && 'streaming-effect'
          )}
          ref={editorRef}
        >
          {code.length === 0 && !isCollapsed && (
            <div className="absolute left-[42px] top-[12px] text-muted-foreground/50 select-none pointer-events-none">
              {placeholder}
            </div>
          )}

          <Editor
            value={code}
            onValueChange={(newCode) => {
              if (!isCollapsed && !isAiStreaming) {
                setCode(newCode)
                setStoreValue(newCode)

                const textarea = editorRef.current?.querySelector('textarea')
                if (textarea) {
                  const pos = textarea.selectionStart
                  setCursorPosition(pos)

                  const tagTrigger = checkTagTrigger(newCode, pos)
                  setShowTags(tagTrigger.show)
                  if (!tagTrigger.show) {
                    setActiveSourceBlockId(null)
                  }

                  const envVarTrigger = checkEnvVarTrigger(newCode, pos)
                  setShowEnvVars(envVarTrigger.show)
                  setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')
                }
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowTags(false)
                setShowEnvVars(false)
              }
              if (isAiStreaming) {
                e.preventDefault()
              }
            }}
            highlight={(codeToHighlight) =>
              highlight(codeToHighlight, languages[language], language)
            }
            padding={12}
            style={{
              fontFamily: 'inherit',
              fontSize: 'inherit',
              minHeight: isCollapsed ? '0px' : '106px',
              lineHeight: '21px',
              outline: 'none',
            }}
            className={cn(
              'code-editor-area caret-primary',
              'bg-transparent focus:outline-none',
              (isCollapsed || isAiStreaming) && 'opacity-50 cursor-not-allowed'
            )}
            textareaClassName={cn(
              'focus:outline-none focus:ring-0 border-none bg-transparent resize-none',
              (isCollapsed || isAiStreaming) && 'pointer-events-none'
            )}
          />

          {showEnvVars && !isCollapsed && !isAiStreaming && (
            <EnvVarDropdown
              visible={showEnvVars}
              onSelect={handleEnvVarSelect}
              searchTerm={searchTerm}
              inputValue={code}
              cursorPosition={cursorPosition}
              onClose={() => {
                setShowEnvVars(false)
                setSearchTerm('')
              }}
            />
          )}

          {showTags && !isCollapsed && !isAiStreaming && (
            <TagDropdown
              visible={showTags}
              onSelect={handleTagSelect}
              blockId={blockId}
              activeSourceBlockId={activeSourceBlockId}
              inputValue={code}
              cursorPosition={cursorPosition}
              onClose={() => {
                setShowTags(false)
                setActiveSourceBlockId(null)
              }}
            />
          )}
        </div>
      </div>
    </>
  )
}
