'use client'

import {
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'
import { createLogger } from '@sim/logger'
import { AtSign } from 'lucide-react'
import { useParams } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Badge, Button, Textarea } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import type { CopilotModelId } from '@/lib/copilot/models'
import { cn } from '@/lib/core/utils/cn'
import {
  AttachedFilesDisplay,
  BottomControls,
  ContextPills,
  type MentionFolderNav,
  MentionMenu,
  type SlashFolderNav,
  SlashMenu,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/components'
import {
  ALL_COMMAND_IDS,
  getCommandDisplayLabel,
  getNextIndex,
  NEAR_TOP_THRESHOLD,
  TOP_LEVEL_COMMANDS,
  WEB_COMMANDS,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants'
import {
  useContextManagement,
  useFileAttachments,
  useMentionData,
  useMentionInsertHandlers,
  useMentionKeyboard,
  useMentionMenu,
  useMentionTokens,
  useTextareaAutoResize,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import type { MessageFileAttachment } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import {
  computeMentionHighlightRanges,
  extractContextTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { ChatContext } from '@/stores/panel'
import { useCopilotStore } from '@/stores/panel'

const logger = createLogger('CopilotUserInput')

interface UserInputProps {
  onSubmit: (
    message: string,
    fileAttachments?: MessageFileAttachment[],
    contexts?: ChatContext[]
  ) => void
  onAbort?: () => void
  disabled?: boolean
  isLoading?: boolean
  isAborting?: boolean
  placeholder?: string
  className?: string
  mode?: 'ask' | 'build' | 'plan'
  onModeChange?: (mode: 'ask' | 'build' | 'plan') => void
  value?: string
  onChange?: (value: string) => void
  panelWidth?: number
  clearOnSubmit?: boolean
  hasPlanArtifact?: boolean
  /** Override workflowId from store (for use outside copilot context) */
  workflowIdOverride?: string | null
  /** Override selectedModel from store (for use outside copilot context) */
  selectedModelOverride?: string
  /** Override setSelectedModel from store (for use outside copilot context) */
  onModelChangeOverride?: (model: string) => void
  hideModeSelector?: boolean
  /** Disable @mention functionality */
  disableMentions?: boolean
  /** Initial contexts for editing a message with existing context mentions */
  initialContexts?: ChatContext[]
}

interface UserInputRef {
  focus: () => void
}

/**
 * User input component for the copilot chat interface.
 * Supports file attachments, @mentions, mode selection, model selection, and rich text editing.
 * Integrates with the copilot store and provides keyboard shortcuts for enhanced UX.
 *
 * @param props - Component props
 * @returns Rendered user input component
 */
const UserInput = forwardRef<UserInputRef, UserInputProps>(
  (
    {
      onSubmit,
      onAbort,
      disabled = false,
      isLoading = false,
      isAborting = false,
      placeholder,
      className,
      mode = 'build',
      onModeChange,
      value: controlledValue,
      onChange: onControlledChange,
      panelWidth = 308,
      clearOnSubmit = true,
      hasPlanArtifact = false,
      workflowIdOverride,
      selectedModelOverride,
      onModelChangeOverride,
      hideModeSelector = false,
      disableMentions = false,
      initialContexts,
    },
    ref
  ) => {
    const { data: session } = useSession()
    const params = useParams()
    const workspaceId = params.workspaceId as string

    const copilotStore = useCopilotStore()
    const workflowId =
      workflowIdOverride !== undefined ? workflowIdOverride : copilotStore.workflowId
    const selectedModel =
      selectedModelOverride !== undefined ? selectedModelOverride : copilotStore.selectedModel
    const setSelectedModel = onModelChangeOverride || copilotStore.setSelectedModel

    const [internalMessage, setInternalMessage] = useState('')
    const [isNearTop, setIsNearTop] = useState(false)
    const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null)
    const [inputContainerRef, setInputContainerRef] = useState<HTMLDivElement | null>(null)
    const [showSlashMenu, setShowSlashMenu] = useState(false)
    const [slashFolderNav, setSlashFolderNav] = useState<SlashFolderNav | null>(null)
    const [mentionFolderNav, setMentionFolderNav] = useState<MentionFolderNav | null>(null)

    const message = controlledValue !== undefined ? controlledValue : internalMessage
    const setMessage =
      controlledValue !== undefined ? onControlledChange || (() => {}) : setInternalMessage

    const effectivePlaceholder =
      placeholder ||
      (mode === 'ask'
        ? 'Ask about your workflow'
        : mode === 'plan'
          ? 'Plan your workflow'
          : 'Plan, search, build anything')

    const contextManagement = useContextManagement({ message, initialContexts })

    const mentionMenu = useMentionMenu({
      message,
      selectedContexts: contextManagement.selectedContexts,
      onContextSelect: contextManagement.addContext,
      onMessageChange: setMessage,
    })

    const mentionTokensWithContext = useMentionTokens({
      message,
      selectedContexts: contextManagement.selectedContexts,
      mentionMenu,
      setMessage,
      setSelectedContexts: contextManagement.setSelectedContexts,
    })

    const { overlayRef } = useTextareaAutoResize({
      message,
      panelWidth,
      selectedContexts: contextManagement.selectedContexts,
      textareaRef: mentionMenu.textareaRef,
      containerRef: inputContainerRef,
    })

    const mentionData = useMentionData({
      workflowId: workflowId || null,
      workspaceId,
    })

    const fileAttachments = useFileAttachments({
      userId: session?.user?.id,
      disabled,
      isLoading,
    })

    const insertHandlers = useMentionInsertHandlers({
      mentionMenu,
      workflowId: workflowId || null,
      selectedContexts: contextManagement.selectedContexts,
      onContextAdd: contextManagement.addContext,
      mentionFolderNav,
    })

    const mentionKeyboard = useMentionKeyboard({
      mentionMenu,
      mentionData,
      insertHandlers,
      mentionFolderNav,
    })

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const textarea = mentionMenu.textareaRef.current
          if (textarea) {
            textarea.focus()
            const length = textarea.value.length
            textarea.setSelectionRange(length, length)
            textarea.scrollTop = textarea.scrollHeight
          }
        },
      }),
      [mentionMenu.textareaRef]
    )

    useEffect(() => {
      const checkPosition = () => {
        if (containerRef) {
          const rect = containerRef.getBoundingClientRect()
          setIsNearTop(rect.top < NEAR_TOP_THRESHOLD)
        }
      }

      checkPosition()

      const scrollContainer = containerRef?.closest('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', checkPosition, { passive: true })
      }

      window.addEventListener('scroll', checkPosition, true)
      window.addEventListener('resize', checkPosition)

      return () => {
        if (scrollContainer) {
          scrollContainer.removeEventListener('scroll', checkPosition)
        }
        window.removeEventListener('scroll', checkPosition, true)
        window.removeEventListener('resize', checkPosition)
      }
    }, [containerRef])

    useEffect(() => {
      if (mentionMenu.showMentionMenu && containerRef) {
        const rect = containerRef.getBoundingClientRect()
        setIsNearTop(rect.top < NEAR_TOP_THRESHOLD)
      }
    }, [mentionMenu.showMentionMenu, containerRef])

    useEffect(() => {
      if (!mentionMenu.showMentionMenu || mentionFolderNav?.isInFolder) {
        return
      }

      const q = mentionMenu
        .getActiveMentionQueryAtPosition(mentionMenu.getCaretPos())
        ?.query.trim()
        .toLowerCase()

      if (q && q.length > 0) {
        void mentionData.ensurePastChatsLoaded()
        void mentionData.ensureKnowledgeLoaded()
        void mentionData.ensureBlocksLoaded()
        void mentionData.ensureTemplatesLoaded()
        void mentionData.ensureLogsLoaded()

        mentionMenu.setSubmenuActiveIndex(0)
        requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(0))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mentionMenu.showMentionMenu, mentionFolderNav?.isInFolder, message])

    useEffect(() => {
      if (mentionFolderNav?.isInFolder) {
        mentionMenu.setSubmenuActiveIndex(0)
        requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(0))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mentionFolderNav?.isInFolder])

    const handleSubmit = useCallback(
      async (overrideMessage?: string, options: { preserveInput?: boolean } = {}) => {
        const targetMessage = overrideMessage ?? message
        const trimmedMessage = targetMessage.trim()
        if (!trimmedMessage || disabled) return

        const failedUploads = fileAttachments.attachedFiles.filter((f) => !f.uploading && !f.key)
        if (failedUploads.length > 0) {
          logger.error(
            `Some files failed to upload: ${failedUploads.map((f) => f.name).join(', ')}`
          )
        }

        const fileAttachmentsForApi = fileAttachments.attachedFiles
          .filter((f) => !f.uploading && f.key)
          .map((f) => ({
            id: f.id,
            key: f.key!,
            filename: f.name,
            media_type: f.type,
            size: f.size,
          }))

        onSubmit(trimmedMessage, fileAttachmentsForApi, contextManagement.selectedContexts)

        const shouldClearInput = clearOnSubmit && !options.preserveInput && !overrideMessage
        if (shouldClearInput) {
          fileAttachments.attachedFiles.forEach((f) => {
            if (f.previewUrl) {
              URL.revokeObjectURL(f.previewUrl)
            }
          })

          setMessage('')
          fileAttachments.clearAttachedFiles()
          contextManagement.clearContexts()
          mentionMenu.setOpenSubmenuFor(null)
        } else {
          mentionMenu.setOpenSubmenuFor(null)
        }

        mentionMenu.setShowMentionMenu(false)
      },
      [
        message,
        disabled,
        isLoading,
        fileAttachments,
        onSubmit,
        contextManagement,
        clearOnSubmit,
        setMessage,
        mentionMenu,
      ]
    )

    const handleBuildWorkflow = useCallback(() => {
      if (!hasPlanArtifact || !onModeChange) {
        return
      }
      if (disabled || isLoading) {
        return
      }

      onModeChange('build')
      void handleSubmit('build the workflow according to the design plan', { preserveInput: true })
    }, [hasPlanArtifact, onModeChange, disabled, isLoading, handleSubmit])

    const handleAbort = useCallback(() => {
      if (onAbort && isLoading) {
        onAbort()
      }
    }, [onAbort, isLoading])

    const handleSlashCommandSelect = useCallback(
      (command: string) => {
        const displayLabel = getCommandDisplayLabel(command)
        mentionMenu.replaceActiveSlashWith(displayLabel)
        contextManagement.addContext({
          kind: 'slash_command',
          command,
          label: displayLabel,
        })

        setShowSlashMenu(false)
        mentionMenu.textareaRef.current?.focus()
      },
      [mentionMenu, contextManagement]
    )

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape' && (mentionMenu.showMentionMenu || showSlashMenu)) {
          e.preventDefault()
          if (mentionFolderNav?.isInFolder) {
            mentionFolderNav.closeFolder()
            mentionMenu.setSubmenuQueryStart(null)
          } else if (slashFolderNav?.isInFolder) {
            slashFolderNav.closeFolder()
          } else {
            mentionMenu.closeMentionMenu()
            setShowSlashMenu(false)
          }
          return
        }

        if (showSlashMenu) {
          const caretPos = mentionMenu.getCaretPos()
          const activeSlash = mentionMenu.getActiveSlashQueryAtPosition(caretPos, message)
          const query = activeSlash?.query.trim().toLowerCase() || ''
          const showAggregatedView = query.length > 0
          const direction = e.key === 'ArrowDown' ? 'down' : 'up'
          const isInFolder = slashFolderNav?.isInFolder ?? false

          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()

            if (isInFolder) {
              mentionMenu.setSubmenuActiveIndex((prev) => {
                const next = getNextIndex(prev, direction, WEB_COMMANDS.length - 1)
                requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(next))
                return next
              })
            } else if (showAggregatedView) {
              const filtered = ALL_COMMAND_IDS.filter((cmd) => cmd.includes(query))
              mentionMenu.setSubmenuActiveIndex((prev) => {
                if (filtered.length === 0) return 0
                const next = getNextIndex(prev, direction, filtered.length - 1)
                requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(next))
                return next
              })
            } else {
              mentionMenu.setMentionActiveIndex((prev) => {
                const next = getNextIndex(prev, direction, TOP_LEVEL_COMMANDS.length)
                requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(next))
                return next
              })
            }
            return
          }

          if (e.key === 'ArrowRight') {
            e.preventDefault()
            if (!showAggregatedView && !isInFolder) {
              if (mentionMenu.mentionActiveIndex === TOP_LEVEL_COMMANDS.length) {
                slashFolderNav?.openWebFolder()
              }
            }
            return
          }

          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            if (isInFolder) {
              slashFolderNav?.closeFolder()
            }
            return
          }
        }

        if (mentionKeyboard.handleArrowNavigation(e)) return
        if (mentionKeyboard.handleArrowRight(e)) return
        if (mentionKeyboard.handleArrowLeft(e)) return

        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          if (showSlashMenu) {
            const caretPos = mentionMenu.getCaretPos()
            const activeSlash = mentionMenu.getActiveSlashQueryAtPosition(caretPos, message)
            const query = activeSlash?.query.trim().toLowerCase() || ''
            const showAggregatedView = query.length > 0
            const isInFolder = slashFolderNav?.isInFolder ?? false

            if (isInFolder) {
              const selectedCommand =
                WEB_COMMANDS[mentionMenu.submenuActiveIndex]?.id || WEB_COMMANDS[0].id
              handleSlashCommandSelect(selectedCommand)
            } else if (showAggregatedView) {
              const filtered = ALL_COMMAND_IDS.filter((cmd) => cmd.includes(query))
              if (filtered.length > 0) {
                const selectedCommand = filtered[mentionMenu.submenuActiveIndex] || filtered[0]
                handleSlashCommandSelect(selectedCommand)
              }
            } else {
              const selectedIndex = mentionMenu.mentionActiveIndex
              if (selectedIndex < TOP_LEVEL_COMMANDS.length) {
                handleSlashCommandSelect(TOP_LEVEL_COMMANDS[selectedIndex].id)
              } else if (selectedIndex === TOP_LEVEL_COMMANDS.length) {
                slashFolderNav?.openWebFolder()
              }
            }
            return
          }
          if (!mentionMenu.showMentionMenu) {
            handleSubmit()
          } else {
            mentionKeyboard.handleEnterSelection(e)
          }
          return
        }

        if (!mentionMenu.showMentionMenu) {
          const textarea = mentionMenu.textareaRef.current
          const selStart = textarea?.selectionStart ?? 0
          const selEnd = textarea?.selectionEnd ?? selStart
          const selectionLength = Math.abs(selEnd - selStart)

          if (e.key === 'Backspace' || e.key === 'Delete') {
            if (selectionLength > 0) {
              mentionTokensWithContext.removeContextsInSelection(selStart, selEnd)
            } else {
              const ranges = mentionTokensWithContext.computeMentionRanges()
              const target =
                e.key === 'Backspace'
                  ? ranges.find((r) => selStart > r.start && selStart <= r.end)
                  : ranges.find((r) => selStart >= r.start && selStart < r.end)

              if (target) {
                e.preventDefault()
                mentionTokensWithContext.deleteRange(target)
                return
              }
            }
          }

          if (selectionLength === 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            if (textarea) {
              if (e.key === 'ArrowLeft') {
                const nextPos = Math.max(0, selStart - 1)
                const r = mentionTokensWithContext.findRangeContaining(nextPos)
                if (r) {
                  e.preventDefault()
                  const target = r.start
                  setTimeout(() => textarea.setSelectionRange(target, target), 0)
                  return
                }
              } else if (e.key === 'ArrowRight') {
                const nextPos = Math.min(message.length, selStart + 1)
                const r = mentionTokensWithContext.findRangeContaining(nextPos)
                if (r) {
                  e.preventDefault()
                  const target = r.end
                  setTimeout(() => textarea.setSelectionRange(target, target), 0)
                  return
                }
              }
            }
          }

          if (e.key.length === 1 || e.key === 'Space') {
            const blocked =
              selectionLength === 0 && !!mentionTokensWithContext.findRangeContaining(selStart)
            if (blocked) {
              e.preventDefault()
              const r = mentionTokensWithContext.findRangeContaining(selStart)
              if (r && textarea) {
                setTimeout(() => {
                  textarea.setSelectionRange(r.end, r.end)
                }, 0)
              }
              return
            }
          }
        }
      },
      [
        mentionMenu,
        mentionKeyboard,
        handleSubmit,
        handleSlashCommandSelect,
        message,
        mentionTokensWithContext,
        showSlashMenu,
        slashFolderNav,
        mentionFolderNav,
      ]
    )

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value
        setMessage(newValue)

        if (disableMentions) return

        const caret = e.target.selectionStart ?? newValue.length
        const activeMention = mentionMenu.getActiveMentionQueryAtPosition(caret, newValue)
        const activeSlash = mentionMenu.getActiveSlashQueryAtPosition(caret, newValue)

        if (activeMention) {
          setShowSlashMenu(false)
          mentionMenu.setShowMentionMenu(true)
          mentionMenu.setInAggregated(false)
          if (mentionFolderNav?.isInFolder) {
            mentionMenu.setSubmenuActiveIndex(0)
          } else {
            mentionMenu.setMentionActiveIndex(0)
            mentionMenu.setSubmenuActiveIndex(0)
          }
        } else if (activeSlash) {
          mentionMenu.setShowMentionMenu(false)
          mentionMenu.setOpenSubmenuFor(null)
          mentionMenu.setSubmenuQueryStart(null)
          setShowSlashMenu(true)
          mentionMenu.setSubmenuActiveIndex(0)
        } else {
          mentionMenu.setShowMentionMenu(false)
          mentionMenu.setOpenSubmenuFor(null)
          mentionMenu.setSubmenuQueryStart(null)
          setShowSlashMenu(false)
        }
      },
      [setMessage, mentionMenu, disableMentions, mentionFolderNav]
    )

    const handleSelectAdjust = useCallback(() => {
      const textarea = mentionMenu.textareaRef.current
      if (!textarea) return
      const pos = textarea.selectionStart ?? 0
      const r = mentionTokensWithContext.findRangeContaining(pos)
      if (r) {
        const snapPos = pos - r.start < r.end - pos ? r.start : r.end
        setTimeout(() => {
          textarea.setSelectionRange(snapPos, snapPos)
        }, 0)
      }
    }, [mentionMenu.textareaRef, mentionTokensWithContext])

    const insertTriggerAndOpenMenu = useCallback(
      (trigger: '@' | '/') => {
        if (disabled) return
        const textarea = mentionMenu.textareaRef.current
        if (!textarea) return

        textarea.focus()
        const start = textarea.selectionStart ?? message.length
        const end = textarea.selectionEnd ?? message.length
        const needsSpaceBefore = start > 0 && !/\s/.test(message.charAt(start - 1))

        const insertText = needsSpaceBefore ? ` ${trigger}` : trigger
        const before = message.slice(0, start)
        const after = message.slice(end)
        setMessage(`${before}${insertText}${after}`)

        setTimeout(() => {
          const newPos = before.length + insertText.length
          textarea.setSelectionRange(newPos, newPos)
          textarea.focus()
        }, 0)

        if (trigger === '@') {
          mentionMenu.setShowMentionMenu(true)
          mentionMenu.setOpenSubmenuFor(null)
          mentionMenu.setMentionActiveIndex(0)
        } else {
          setShowSlashMenu(true)
        }
        mentionMenu.setSubmenuActiveIndex(0)
      },
      [disabled, mentionMenu, message, setMessage]
    )

    const handleOpenMentionMenuWithAt = useCallback(
      () => insertTriggerAndOpenMenu('@'),
      [insertTriggerAndOpenMenu]
    )

    const handleOpenSlashMenu = useCallback(
      () => insertTriggerAndOpenMenu('/'),
      [insertTriggerAndOpenMenu]
    )

    const handleModelSelect = useCallback(
      (model: string) => {
        setSelectedModel(model as CopilotModelId)
      },
      [setSelectedModel]
    )

    const canSubmit = message.trim().length > 0 && !disabled && !isLoading
    const showAbortButton = isLoading && onAbort

    const renderOverlayContent = useCallback(() => {
      const contexts = contextManagement.selectedContexts

      if (!message) {
        return <span>{'\u00A0'}</span>
      }

      if (contexts.length === 0) {
        const displayText = message.endsWith('\n') ? `${message}\u200B` : message
        return <span>{displayText}</span>
      }

      const tokens = extractContextTokens(contexts)
      const ranges = computeMentionHighlightRanges(message, tokens)

      if (ranges.length === 0) {
        const displayText = message.endsWith('\n') ? `${message}\u200B` : message
        return <span>{displayText}</span>
      }

      const elements: React.ReactNode[] = []
      let lastIndex = 0

      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i]

        if (range.start > lastIndex) {
          const before = message.slice(lastIndex, range.start)
          elements.push(<span key={`text-${i}-${lastIndex}-${range.start}`}>{before}</span>)
        }

        elements.push(
          <span
            key={`mention-${i}-${range.start}-${range.end}`}
            className='rounded-[4px] bg-[rgba(50,189,126,0.65)] py-[1px]'
          >
            {range.token}
          </span>
        )
        lastIndex = range.end
      }

      const tail = message.slice(lastIndex)
      if (tail) {
        const displayTail = tail.endsWith('\n') ? `${tail}\u200B` : tail
        elements.push(<span key={`tail-${lastIndex}`}>{displayTail}</span>)
      }

      return elements.length > 0 ? elements : <span>{'\u00A0'}</span>
    }, [message, contextManagement.selectedContexts])

    return (
      <div
        ref={setContainerRef}
        data-user-input
        className={cn('relative w-full flex-none [max-width:var(--panel-max-width)]', className)}
        style={{ '--panel-max-width': `${panelWidth - 16}px` } as React.CSSProperties}
      >
        <div
          ref={setInputContainerRef}
          className={cn(
            'relative w-full rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-4)] px-[6px] py-[6px] transition-colors dark:bg-[var(--surface-4)]',
            fileAttachments.isDragging && 'ring-[1.75px] ring-[var(--brand-secondary)]'
          )}
          onDragEnter={fileAttachments.handleDragEnter}
          onDragLeave={fileAttachments.handleDragLeave}
          onDragOver={fileAttachments.handleDragOver}
          onDrop={fileAttachments.handleDrop}
        >
          {/* Top Row: Context controls + Build Workflow button */}
          <div className='mb-[6px] flex flex-wrap items-center justify-between gap-[6px]'>
            <div className='flex flex-wrap items-center gap-[6px]'>
              {!disableMentions && (
                <>
                  <Badge
                    variant='outline'
                    onClick={handleOpenMentionMenuWithAt}
                    title='Insert @'
                    className={cn(
                      'cursor-pointer rounded-[6px] p-[4.5px]',
                      disabled && 'cursor-not-allowed'
                    )}
                  >
                    <AtSign className='h-3 w-3' strokeWidth={1.75} />
                  </Badge>

                  <Badge
                    variant='outline'
                    onClick={handleOpenSlashMenu}
                    title='Insert /'
                    className={cn(
                      'cursor-pointer rounded-[6px] p-[4.5px]',
                      disabled && 'cursor-not-allowed'
                    )}
                  >
                    <span className='flex h-3 w-3 items-center justify-center font-medium text-[11px] leading-none'>
                      /
                    </span>
                  </Badge>

                  {/* Selected Context Pills */}
                  <ContextPills
                    contexts={contextManagement.selectedContexts}
                    onRemoveContext={contextManagement.removeContext}
                  />
                </>
              )}
            </div>

            {hasPlanArtifact && (
              <Button
                type='button'
                variant='outline'
                onClick={handleBuildWorkflow}
                disabled={disabled || isLoading}
              >
                Build Plan
              </Button>
            )}
          </div>

          {/* Attached Files Display */}
          <AttachedFilesDisplay
            files={fileAttachments.attachedFiles}
            onFileClick={fileAttachments.handleFileClick}
            onFileRemove={fileAttachments.removeFile}
            formatFileSize={fileAttachments.formatFileSize}
            getFileIconType={fileAttachments.getFileIconType}
          />

          {/* Textarea Field with overlay */}
          <div className='relative mb-[6px]'>
            {/* Highlight overlay - must have identical flow as textarea */}
            <div
              ref={overlayRef}
              className='pointer-events-none absolute top-0 left-0 z-[1] m-0 box-border h-auto max-h-[120px] min-h-[48px] w-full resize-none overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-[2px] py-1 font-medium font-sans text-[var(--text-primary)] text-sm leading-[1.25rem] outline-none [-ms-overflow-style:none] [scrollbar-width:none] [text-rendering:optimizeLegibility] [&::-webkit-scrollbar]:hidden'
              aria-hidden='true'
            >
              {renderOverlayContent()}
            </div>

            <Textarea
              ref={mentionMenu.textareaRef}
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onCut={mentionTokensWithContext.handleCut}
              onSelect={handleSelectAdjust}
              onMouseUp={handleSelectAdjust}
              onScroll={(e) => {
                const overlay = overlayRef.current
                if (overlay) {
                  overlay.scrollTop = e.currentTarget.scrollTop
                  overlay.scrollLeft = e.currentTarget.scrollLeft
                }
              }}
              placeholder={fileAttachments.isDragging ? 'Drop files here...' : effectivePlaceholder}
              disabled={disabled}
              rows={2}
              className='relative z-[2] m-0 box-border h-auto max-h-[120px] min-h-[48px] w-full resize-none overflow-y-auto overflow-x-hidden break-words border-0 bg-transparent px-[2px] py-1 font-medium font-sans text-sm text-transparent leading-[1.25rem] caret-foreground outline-none [-ms-overflow-style:none] [scrollbar-width:none] [text-rendering:auto] placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0 dark:placeholder:text-[var(--text-muted)] [&::-webkit-scrollbar]:hidden'
            />

            {/* Mention Menu Portal */}
            {!disableMentions &&
              mentionMenu.showMentionMenu &&
              createPortal(
                <MentionMenu
                  mentionMenu={mentionMenu}
                  mentionData={mentionData}
                  message={message}
                  insertHandlers={insertHandlers}
                  onFolderNavChange={setMentionFolderNav}
                />,
                document.body
              )}

            {/* Slash Menu Portal */}
            {!disableMentions &&
              showSlashMenu &&
              createPortal(
                <SlashMenu
                  mentionMenu={mentionMenu}
                  message={message}
                  onSelectCommand={handleSlashCommandSelect}
                  onFolderNavChange={setSlashFolderNav}
                />,
                document.body
              )}
          </div>

          {/* Bottom Row: Mode Selector + Model Selector + Attach Button + Send Button */}
          <BottomControls
            mode={mode}
            onModeChange={onModeChange}
            selectedModel={selectedModel}
            onModelSelect={handleModelSelect}
            isNearTop={isNearTop}
            disabled={disabled}
            hideModeSelector={hideModeSelector}
            canSubmit={canSubmit}
            isLoading={isLoading}
            isAborting={isAborting}
            showAbortButton={Boolean(showAbortButton)}
            onSubmit={() => void handleSubmit()}
            onAbort={handleAbort}
            onFileSelect={fileAttachments.handleFileSelect}
          />

          {/* Hidden File Input - enabled during streaming so users can prepare images for the next message */}
          <input
            ref={fileAttachments.fileInputRef}
            type='file'
            onChange={fileAttachments.handleFileChange}
            className='hidden'
            accept='image/*'
            multiple
            disabled={disabled}
          />
        </div>
      </div>
    )
  }
)

UserInput.displayName = 'UserInput'

export { UserInput }
export type { UserInputRef }
