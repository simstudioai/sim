import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Wand2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useReactFlow } from 'reactflow'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { WandPromptBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import type { SubBlockConfig } from '@/blocks/types'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { useWebhookManagement } from '@/hooks/use-webhook-management'

const logger = createLogger('ShortInput')

interface ShortInputProps {
  placeholder?: string
  password?: boolean
  blockId: string
  subBlockId: string
  isConnecting: boolean
  config: SubBlockConfig
  value?: string
  onChange?: (value: string) => void
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
  readOnly?: boolean
  showCopyButton?: boolean
  useWebhookUrl?: boolean
}

export function ShortInput({
  blockId,
  subBlockId,
  placeholder,
  password,
  isConnecting,
  config,
  onChange,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled = false,
  readOnly = false,
  showCopyButton = false,
  useWebhookUrl = false,
}: ShortInputProps) {
  const [localContent, setLocalContent] = useState<string>('')
  const [isFocused, setIsFocused] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [copied, setCopied] = useState(false)

  const webhookManagement = useWebhookUrl
    ? useWebhookManagement({
        blockId,
        triggerId: undefined,
        isPreview,
      })
    : null

  const wandHook = config.wandConfig?.enabled
    ? useWand({
        wandConfig: config.wandConfig,
        currentValue: localContent,
        onStreamStart: () => {
          setLocalContent('')
        },
        onStreamChunk: (chunk) => {
          setLocalContent((current) => current + chunk)
        },
        onGeneratedContent: (content) => {
          setLocalContent(content)
        },
      })
    : null
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, false, {
    isStreaming: wandHook?.isStreaming || false,
    onStreamingEnd: () => {
      logger.debug('Wand streaming ended, value persisted', { blockId, subBlockId })
    },
  })

  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)

  const emitTagSelection = useTagSelection(blockId, subBlockId)

  const params = useParams()
  const workspaceId = params.workspaceId as string

  const reactFlowInstance = useReactFlow()

  const baseValue = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  const effectiveValue =
    useWebhookUrl && webhookManagement?.webhookUrl ? webhookManagement.webhookUrl : baseValue

  const value = wandHook?.isStreaming ? localContent : effectiveValue

  useEffect(() => {
    if (!wandHook?.isStreaming) {
      const baseValueString = baseValue?.toString() ?? ''
      if (baseValueString !== localContent) {
        setLocalContent(baseValueString)
      }
    }
  }, [baseValue, wandHook?.isStreaming])

  useEffect(() => {
    if (wandHook?.isStreaming && localContent !== '') {
      if (!isPreview && !disabled) {
        setStoreValue(localContent)
      }
    }
  }, [localContent, wandHook?.isStreaming, isPreview, disabled, setStoreValue])

  const isApiKeyField = useMemo(() => {
    const normalizedId = config?.id?.replace(/\s+/g, '').toLowerCase() || ''
    const normalizedTitle = config?.title?.replace(/\s+/g, '').toLowerCase() || ''

    const apiKeyPatterns = [
      'apikey',
      'api_key',
      'api-key',
      'secretkey',
      'secret_key',
      'secret-key',
      'token',
      'access_token',
      'auth_token',
      'secret',
      'password',
    ]

    return apiKeyPatterns.some(
      (pattern) =>
        normalizedId === pattern ||
        normalizedTitle === pattern ||
        normalizedId.includes(pattern) ||
        normalizedTitle.includes(pattern)
    )
  }, [config?.id, config?.title])

  const handleCopy = () => {
    const textToCopy = useWebhookUrl ? webhookManagement?.webhookUrl : value?.toString()
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled || readOnly) {
      e.preventDefault()
      return
    }

    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

    if (onChange) {
      onChange(newValue)
    } else if (!isPreview) {
      setStoreValue(newValue)
    }

    setCursorPosition(newCursorPosition)

    const envVarTrigger = checkEnvVarTrigger(newValue, newCursorPosition)

    if (isApiKeyField && isFocused) {
      const shouldShowDropdown = newValue.trim() !== '' || newValue === ''
      setShowEnvVars(shouldShowDropdown)
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : newValue)
    } else {
      setShowEnvVars(envVarTrigger.show)
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')
    }

    const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
    setShowTags(tagTrigger.show)
  }

  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  useEffect(() => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }, [value])

  const handlePaste = (_e: React.ClipboardEvent<HTMLInputElement>) => {
    setTimeout(() => {
      if (inputRef.current && overlayRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft
      }
    }, 0)
  }

  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()

      const currentZoom = reactFlowInstance.getZoom()
      const { x: viewportX, y: viewportY } = reactFlowInstance.getViewport()

      const delta = e.deltaY > 0 ? 1 : -1
      const zoomFactor = 0.96 ** delta

      const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.1), 1)

      const { x: pointerX, y: pointerY } = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      })

      const newViewportX = viewportX + (pointerX * currentZoom - pointerX * newZoom)
      const newViewportY = viewportY + (pointerY * currentZoom - pointerY * newZoom)

      reactFlowInstance.setViewport(
        {
          x: newViewportX,
          y: newViewportY,
          zoom: newZoom,
        },
        { duration: 0 }
      )

      return false
    }

    return true
  }

  const handleDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const dropPosition = inputRef.current?.selectionStart ?? value?.toString().length ?? 0

      const currentValue = value?.toString() ?? ''
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

      inputRef.current?.focus()

      Promise.resolve().then(() => {
        if (onChange) {
          onChange(newValue)
        } else if (!isPreview) {
          setStoreValue(newValue)
        }

        setCursorPosition(dropPosition + 1)
        setShowTags(true)

        if (data.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }

        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = dropPosition + 1
            inputRef.current.selectionEnd = dropPosition + 1
          }
        }, 0)
      })
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowEnvVars(false)
      setShowTags(false)
      return
    }

    if (
      isApiKeyField &&
      (e.key === 'Delete' || e.key === 'Backspace') &&
      inputRef.current?.selectionStart === 0 &&
      inputRef.current?.selectionEnd === value?.toString().length
    ) {
      setTimeout(() => setShowEnvVars(true), 0)
    }
  }

  const displayValue =
    password && !isFocused ? '•'.repeat(value?.toString().length ?? 0) : (value?.toString() ?? '')

  const handleEnvVarSelect = (newValue: string) => {
    if (isApiKeyField && !newValue.startsWith('{{')) {
      newValue = `{{${newValue}}}`
    }

    if (onChange) {
      onChange(newValue)
    } else if (!isPreview) {
      emitTagSelection(newValue)
    }
  }

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  return (
    <>
      <WandPromptBar
        isVisible={wandHook?.isPromptVisible || false}
        isLoading={wandHook?.isLoading || false}
        isStreaming={wandHook?.isStreaming || false}
        promptValue={wandHook?.promptInputValue || ''}
        onSubmit={(prompt: string) => wandHook?.generateStream({ prompt }) || undefined}
        onCancel={
          wandHook?.isStreaming
            ? wandHook?.cancelGeneration
            : wandHook?.hidePromptInline || (() => {})
        }
        onChange={(value: string) => wandHook?.updatePromptValue?.(value)}
        placeholder={config.wandConfig?.placeholder || 'Describe what you want to generate...'}
      />

      <div className='group relative w-full'>
        <Input
          ref={inputRef}
          className={cn(
            'allow-scroll w-full overflow-auto text-transparent caret-foreground [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground/50 [&::-webkit-scrollbar]:hidden',
            isConnecting &&
              config?.connectionDroppable !== false &&
              'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500',
            showCopyButton && 'pr-14'
          )}
          placeholder={placeholder ?? ''}
          type='text'
          value={displayValue}
          onChange={handleChange}
          readOnly={readOnly}
          onFocus={() => {
            setIsFocused(true)

            if (isApiKeyField) {
              setShowEnvVars(true)
              setSearchTerm('')

              const inputLength = value?.toString().length ?? 0
              setCursorPosition(inputLength)
            } else {
              setShowEnvVars(false)
              setShowTags(false)
              setSearchTerm('')
            }
          }}
          onBlur={() => {
            setIsFocused(false)
            setShowEnvVars(false)
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onScroll={handleScroll}
          onPaste={handlePaste}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          autoComplete='off'
          style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          disabled={disabled}
        />
        <div
          ref={overlayRef}
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            'pl-3',
            showCopyButton ? 'pr-14' : 'pr-3'
          )}
          style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <div
            className={cn('whitespace-pre', showCopyButton ? 'mr-12' : '')}
            style={{ scrollbarWidth: 'none', minWidth: 'fit-content' }}
          >
            {password && !isFocused
              ? '•'.repeat(value?.toString().length ?? 0)
              : formatDisplayText(value?.toString() ?? '', {
                  accessiblePrefixes,
                  highlightAll: !accessiblePrefixes,
                })}
          </div>
        </div>

        {/* Copy Button */}
        {showCopyButton && value && (
          <div className='pointer-events-none absolute top-0 right-0 bottom-0 z-10 flex w-14 items-center justify-end pr-2'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={handleCopy}
              disabled={!value}
              className={cn(
                'pointer-events-auto h-8 w-8 p-0',
                'text-muted-foreground/60 transition-all duration-200',
                'hover:scale-105 hover:bg-muted/50 hover:text-foreground',
                'bg-background/80 backdrop-blur-sm active:scale-95'
              )}
              aria-label='Copy value'
            >
              {copied ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
            </Button>
          </div>
        )}

        {/* Wand Button */}
        {wandHook && !isPreview && !wandHook.isStreaming && (
          <div className='-translate-y-1/2 absolute top-1/2 right-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
            <Button
              variant='ghost'
              size='icon'
              onClick={
                wandHook.isPromptVisible ? wandHook.hidePromptInline : wandHook.showPromptInline
              }
              disabled={wandHook.isLoading || wandHook.isStreaming || disabled}
              aria-label='Generate content with AI'
              className='h-8 w-8 rounded-full border border-transparent bg-muted/80 text-muted-foreground shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-muted hover:text-foreground hover:shadow'
            >
              <Wand2 className='h-4 w-4' />
            </Button>
          </div>
        )}

        {!wandHook?.isStreaming && (
          <>
            <EnvVarDropdown
              visible={showEnvVars}
              onSelect={handleEnvVarSelect}
              searchTerm={searchTerm}
              inputValue={value?.toString() ?? ''}
              cursorPosition={cursorPosition}
              workspaceId={workspaceId}
              onClose={() => {
                setShowEnvVars(false)
                setSearchTerm('')
              }}
              maxHeight='192px'
            />
            <TagDropdown
              visible={showTags}
              onSelect={handleEnvVarSelect}
              blockId={blockId}
              activeSourceBlockId={activeSourceBlockId}
              inputValue={value?.toString() ?? ''}
              cursorPosition={cursorPosition}
              onClose={() => {
                setShowTags(false)
                setActiveSourceBlockId(null)
              }}
            />
          </>
        )}
      </div>
    </>
  )
}
