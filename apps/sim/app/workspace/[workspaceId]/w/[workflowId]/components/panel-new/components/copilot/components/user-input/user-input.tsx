'use client'

import {
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'
import { ArrowUp, AtSign, Image, Loader2, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Badge, Button } from '@/components/emcn'
import { Button as ShadCNButton, Textarea } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import type { ChatContext } from '@/stores/panel-new/copilot/types'
import { ContextUsagePill } from '../context-usage-pill/context-usage-pill'
import {
  AttachedFilesDisplay,
  ContextPills,
  MentionMenuPortal,
  ModelSelector,
  ModeSelector,
} from './components'
import {
  MENTION_MENU_MARGINS,
  MENTION_MENU_MAX_HEIGHT,
  MENTION_MENU_WIDTHS,
  MENTION_OPTIONS,
  NEAR_TOP_THRESHOLD,
} from './constants'
import {
  useFileAttachments,
  useMentionData,
  useMentionKeyboard,
  useMentionMenu,
  useModelSelection,
  useTextareaAutoResize,
} from './hooks'
import type { MessageFileAttachment } from './hooks/use-file-attachments'

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
  mode?: 'ask' | 'agent'
  onModeChange?: (mode: 'ask' | 'agent') => void
  value?: string
  onChange?: (value: string) => void
  panelWidth?: number
  hideContextUsage?: boolean
  clearOnSubmit?: boolean
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
      mode = 'agent',
      onModeChange,
      value: controlledValue,
      onChange: onControlledChange,
      panelWidth = 308,
      hideContextUsage = false,
      clearOnSubmit = true,
    },
    ref
  ) => {
    // Refs and external hooks
    const { data: session } = useSession()
    const params = useParams()
    const workspaceId = params.workspaceId as string

    // Store hooks
    const { workflowId, contextUsage, createNewChat } = useCopilotStore()

    // Internal state
    const [internalMessage, setInternalMessage] = useState('')
    const [selectedContexts, setSelectedContexts] = useState<ChatContext[]>([])
    const [isNearTop, setIsNearTop] = useState(false)
    const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null)

    // Controlled vs uncontrolled message state
    const message = controlledValue !== undefined ? controlledValue : internalMessage
    const setMessage =
      controlledValue !== undefined ? onControlledChange || (() => {}) : setInternalMessage

    // Effective placeholder
    const effectivePlaceholder =
      placeholder || (mode === 'ask' ? 'Ask about your workflow' : 'Plan, search, build anything')

    // Custom hooks - order matters for ref sharing
    const mentionMenu = useMentionMenu({
      message,
      selectedContexts,
      onContextSelect: (context: ChatContext) => {
        setSelectedContexts((prev) => {
          // Avoid duplicates
          const exists = prev.some((c) => {
            if (c.kind !== context.kind) return false
            if (c.kind === 'past_chat' && 'chatId' in context && 'chatId' in c) {
              return c.chatId === (context as any).chatId
            }
            if (c.kind === 'workflow' && 'workflowId' in context && 'workflowId' in c) {
              return c.workflowId === (context as any).workflowId
            }
            return c.label === context.label
          })
          if (exists) return prev
          return [...prev, context]
        })
      },
      onMessageChange: setMessage,
    })

    const { overlayRef } = useTextareaAutoResize({
      message,
      panelWidth,
      selectedContexts,
      textareaRef: mentionMenu.textareaRef,
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

    const modelSelection = useModelSelection()

    // Insert mention handlers for keyboard hook
    const insertPastChatMention = useCallback(
      (chat: { id: string; title: string | null }) => {
        const label = chat.title || 'Untitled Chat'
        mentionMenu.replaceActiveMentionWith(label)
        setSelectedContexts((prev) => {
          if (prev.some((c) => c.kind === 'past_chat' && (c as any).chatId === chat.id)) return prev
          return [...prev, { kind: 'past_chat', chatId: chat.id, label } as ChatContext]
        })
        mentionMenu.setShowMentionMenu(false)
        mentionMenu.setOpenSubmenuFor(null)
      },
      [mentionMenu]
    )

    const insertWorkflowMention = useCallback(
      (wf: { id: string; name: string }) => {
        const label = wf.name || 'Untitled Workflow'
        const token = `@${label}`
        if (!mentionMenu.replaceActiveMentionWith(label)) mentionMenu.insertAtCursor(`${token} `)
        setSelectedContexts((prev) => {
          if (prev.some((c) => c.kind === 'workflow' && (c as any).workflowId === wf.id))
            return prev
          return [...prev, { kind: 'workflow', workflowId: wf.id, label } as ChatContext]
        })
        mentionMenu.setShowMentionMenu(false)
        mentionMenu.setOpenSubmenuFor(null)
      },
      [mentionMenu]
    )

    const insertKnowledgeMention = useCallback(
      (kb: { id: string; name: string }) => {
        const label = kb.name || 'Untitled'
        mentionMenu.replaceActiveMentionWith(label)
        setSelectedContexts((prev) => {
          if (prev.some((c) => c.kind === 'knowledge' && (c as any).knowledgeId === kb.id))
            return prev
          return [...prev, { kind: 'knowledge', knowledgeId: kb.id, label } as any]
        })
        mentionMenu.setShowMentionMenu(false)
        mentionMenu.setOpenSubmenuFor(null)
      },
      [mentionMenu]
    )

    const insertBlockMention = useCallback(
      (blk: { id: string; name: string }) => {
        const label = blk.name || blk.id
        mentionMenu.replaceActiveMentionWith(label)
        setSelectedContexts((prev) => {
          if (prev.some((c) => c.kind === 'blocks' && (c as any).blockId === blk.id)) return prev
          return [...prev, { kind: 'blocks', blockId: blk.id, label } as any]
        })
        mentionMenu.setShowMentionMenu(false)
        mentionMenu.setOpenSubmenuFor(null)
      },
      [mentionMenu]
    )

    const insertWorkflowBlockMention = useCallback(
      (blk: { id: string; name: string }) => {
        const label = blk.name
        const token = `@${label}`
        if (!mentionMenu.replaceActiveMentionWith(label)) mentionMenu.insertAtCursor(`${token} `)
        setSelectedContexts((prev) => {
          if (
            prev.some(
              (c) =>
                c.kind === 'workflow_block' &&
                (c as any).workflowId === workflowId &&
                (c as any).blockId === blk.id
            )
          )
            return prev
          return [
            ...prev,
            {
              kind: 'workflow_block',
              workflowId: workflowId as string,
              blockId: blk.id,
              label,
            } as any,
          ]
        })
        mentionMenu.setShowMentionMenu(false)
        mentionMenu.setOpenSubmenuFor(null)
      },
      [mentionMenu, workflowId]
    )

    const insertTemplateMention = useCallback(
      (tpl: { id: string; name: string }) => {
        const label = tpl.name || 'Untitled Template'
        mentionMenu.replaceActiveMentionWith(label)
        setSelectedContexts((prev) => {
          if (prev.some((c) => c.kind === 'templates' && (c as any).templateId === tpl.id))
            return prev
          return [...prev, { kind: 'templates', templateId: tpl.id, label } as any]
        })
        mentionMenu.setShowMentionMenu(false)
        mentionMenu.setOpenSubmenuFor(null)
      },
      [mentionMenu]
    )

    const insertLogMention = useCallback(
      (log: { id: string; executionId?: string; workflowName: string }) => {
        const label = log.workflowName
        mentionMenu.replaceActiveMentionWith(label)
        setSelectedContexts((prev) => {
          if (prev.some((c) => c.kind === 'logs' && c.label === label)) return prev
          return [...prev, { kind: 'logs', executionId: log.executionId, label }]
        })
        mentionMenu.setShowMentionMenu(false)
        mentionMenu.setOpenSubmenuFor(null)
      },
      [mentionMenu]
    )

    const insertDocsMention = useCallback(() => {
      const label = 'Docs'
      if (!mentionMenu.replaceActiveMentionWith(label)) mentionMenu.insertAtCursor(`@${label} `)
      setSelectedContexts((prev) => {
        if (prev.some((c) => c.kind === 'docs')) return prev
        return [...prev, { kind: 'docs', label } as any]
      })
      mentionMenu.setShowMentionMenu(false)
      mentionMenu.setOpenSubmenuFor(null)
    }, [mentionMenu])

    // Keyboard navigation hook
    const mentionKeyboard = useMentionKeyboard({
      mentionMenu,
      mentionData,
      insertHandlers: {
        insertPastChatMention,
        insertWorkflowMention,
        insertKnowledgeMention,
        insertBlockMention,
        insertWorkflowBlockMention,
        insertTemplateMention,
        insertLogMention,
        insertDocsMention,
      },
    })

    // Expose focus method to parent
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

    // Note: textarea auto-resize is handled by the useTextareaAutoResize hook

    // Load workflows on mount if we have a workflowId
    useEffect(() => {
      if (workflowId) {
        void mentionData.ensureWorkflowsLoaded()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workflowId])

    // Sync scroll between textarea and overlay
    useEffect(() => {
      const textarea = mentionMenu.textareaRef.current
      const overlay = overlayRef.current

      if (!textarea || !overlay) return

      const handleScroll = () => {
        overlay.scrollTop = textarea.scrollTop
      }

      textarea.addEventListener('scroll', handleScroll)
      return () => textarea.removeEventListener('scroll', handleScroll)
    }, [mentionMenu.textareaRef, overlayRef])

    // Detect if input is near top of screen
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

    // Also check position when mention menu opens
    useEffect(() => {
      if (mentionMenu.showMentionMenu && containerRef) {
        const rect = containerRef.getBoundingClientRect()
        setIsNearTop(rect.top < NEAR_TOP_THRESHOLD)
      }
    }, [mentionMenu.showMentionMenu, containerRef])

    // Keep selected contexts in sync with inline @label tokens
    useEffect(() => {
      if (!message) {
        setSelectedContexts([])
        return
      }

      const presentLabels = new Set<string>()
      const ranges = computeMentionRanges()
      for (const r of ranges) presentLabels.add(r.label)

      setSelectedContexts((prev) => prev.filter((c) => !!c.label && presentLabels.has(c.label)))
    }, [message])

    // Manage aggregated mode and preload mention data when query is active
    useEffect(() => {
      if (!mentionMenu.showMentionMenu || mentionMenu.openSubmenuFor) {
        mentionMenu.setAggregatedActive(false)
        mentionMenu.setInAggregated(false)
        return
      }

      const q = mentionMenu
        .getActiveMentionQueryAtPosition(mentionMenu.getCaretPos())
        ?.query.trim()
        .toLowerCase()

      if (q && q.length > 0) {
        const filteredMain = MENTION_OPTIONS.filter((o) => o.toLowerCase().includes(q))
        const needAggregate = filteredMain.length === 0
        mentionMenu.setAggregatedActive(needAggregate)

        // Prefetch all lists when there's any query
        void mentionData.ensurePastChatsLoaded()
        void mentionData.ensureWorkflowsLoaded()
        void mentionData.ensureWorkflowBlocksLoaded()
        void mentionData.ensureKnowledgeLoaded()
        void mentionData.ensureBlocksLoaded()
        void mentionData.ensureTemplatesLoaded()
        void mentionData.ensureLogsLoaded()

        if (needAggregate) {
          mentionMenu.setSubmenuActiveIndex(0)
          requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(0))
        }
      }
      // Only depend on values that trigger data loading, not the entire objects
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mentionMenu.showMentionMenu, mentionMenu.openSubmenuFor, message])

    // When switching into a submenu, select the first item and scroll to it
    useEffect(() => {
      if (mentionMenu.openSubmenuFor) {
        mentionMenu.setInAggregated(false)
        mentionMenu.setSubmenuActiveIndex(0)
        requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(0))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mentionMenu.openSubmenuFor])

    // Position the mention menu portal dynamically
    useEffect(() => {
      if (!mentionMenu.showMentionMenu) {
        mentionMenu.setMentionPortalStyle(null)
        return
      }

      const updatePosition = () => {
        if (!containerRef || !mentionMenu.textareaRef.current) {
          return
        }

        const rect = containerRef.getBoundingClientRect()
        const margin = MENTION_MENU_MARGINS.VIEWPORT
        const textarea = mentionMenu.textareaRef.current
        const caretPos = mentionMenu.getCaretPos()

        // Create a mirror div to calculate caret position
        const div = document.createElement('div')
        const style = window.getComputedStyle(textarea)

        div.style.position = 'absolute'
        div.style.visibility = 'hidden'
        div.style.whiteSpace = 'pre-wrap'
        div.style.wordWrap = 'break-word'
        div.style.font = style.font
        div.style.padding = style.padding
        div.style.border = style.border
        div.style.width = style.width
        div.style.lineHeight = style.lineHeight

        const textBeforeCaret = message.substring(0, caretPos)
        div.textContent = textBeforeCaret

        const span = document.createElement('span')
        span.textContent = '|'
        div.appendChild(span)

        document.body.appendChild(div)
        const spanRect = span.getBoundingClientRect()
        const divRect = div.getBoundingClientRect()
        document.body.removeChild(div)

        const caretLeftOffset = spanRect.left - divRect.left

        const spaceAbove = rect.top - margin
        const spaceBelow = window.innerHeight - rect.bottom - margin

        const maxMenuHeight = MENTION_MENU_MAX_HEIGHT
        const showBelow = rect.top < NEAR_TOP_THRESHOLD || spaceBelow > spaceAbove
        const maxHeight = Math.min(
          Math.max(showBelow ? spaceBelow : spaceAbove, 120),
          maxMenuHeight
        )

        const menuWidth =
          mentionMenu.openSubmenuFor === 'Blocks'
            ? MENTION_MENU_WIDTHS.BLOCKS
            : mentionMenu.openSubmenuFor === 'Templates' ||
                mentionMenu.openSubmenuFor === 'Logs' ||
                mentionMenu.aggregatedActive
              ? MENTION_MENU_WIDTHS.EXPANDED
              : MENTION_MENU_WIDTHS.DEFAULT

        const idealLeft = rect.left + caretLeftOffset
        const maxLeft = window.innerWidth - menuWidth - margin
        const finalLeft = Math.min(idealLeft, maxLeft)

        mentionMenu.setMentionPortalStyle({
          top: showBelow
            ? rect.bottom + MENTION_MENU_MARGINS.PORTAL_OFFSET
            : rect.top - MENTION_MENU_MARGINS.PORTAL_OFFSET,
          left: Math.max(rect.left, finalLeft),
          width: menuWidth,
          maxHeight: maxHeight,
          showBelow,
        })

        setIsNearTop(showBelow)
      }

      // Initial position
      updatePosition()

      // Listen to events
      window.addEventListener('resize', updatePosition)
      const scrollContainer = containerRef?.closest('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', updatePosition, { passive: true })
      }

      // Continuous updates for smooth tracking
      let rafId: number
      const loop = () => {
        updatePosition()
        rafId = requestAnimationFrame(loop)
      }
      rafId = requestAnimationFrame(loop)

      return () => {
        window.removeEventListener('resize', updatePosition)
        if (scrollContainer) {
          scrollContainer.removeEventListener('scroll', updatePosition)
        }
        cancelAnimationFrame(rafId)
      }
      // Only depend on values that should trigger repositioning, not the entire mentionMenu object
    }, [
      mentionMenu.showMentionMenu,
      mentionMenu.openSubmenuFor,
      mentionMenu.aggregatedActive,
      message,
      containerRef,
    ])

    // Handlers
    const handleSubmit = useCallback(async () => {
      const trimmedMessage = message.trim()
      if (!trimmedMessage || disabled || isLoading) return

      const failedUploads = fileAttachments.attachedFiles.filter((f) => !f.uploading && !f.key)
      if (failedUploads.length > 0) {
        logger.error(`Some files failed to upload: ${failedUploads.map((f) => f.name).join(', ')}`)
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

      onSubmit(trimmedMessage, fileAttachmentsForApi, selectedContexts as any)

      if (clearOnSubmit) {
        fileAttachments.attachedFiles.forEach((f) => {
          if (f.previewUrl) {
            URL.revokeObjectURL(f.previewUrl)
          }
        })

        setMessage('')
        fileAttachments.clearAttachedFiles()
        setSelectedContexts([])
        mentionMenu.setOpenSubmenuFor(null)
      }
      mentionMenu.setShowMentionMenu(false)
    }, [
      message,
      disabled,
      isLoading,
      fileAttachments,
      onSubmit,
      selectedContexts,
      clearOnSubmit,
      setMessage,
      mentionMenu,
    ])

    const handleAbort = useCallback(() => {
      if (onAbort && isLoading) {
        onAbort()
      }
    }, [onAbort, isLoading])

    // Utility functions for mention tokens - must be defined before handleKeyDown
    const computeMentionRanges = useCallback(() => {
      const ranges: Array<{ start: number; end: number; label: string }> = []
      if (!message || selectedContexts.length === 0) return ranges

      const labels = selectedContexts.map((c) => c.label).filter(Boolean)
      if (labels.length === 0) return ranges

      for (const label of labels) {
        const token = `@${label}`
        let fromIndex = 0
        while (fromIndex <= message.length) {
          const idx = message.indexOf(token, fromIndex)
          if (idx === -1) break
          ranges.push({ start: idx, end: idx + token.length, label })
          fromIndex = idx + token.length
        }
      }

      ranges.sort((a, b) => a.start - b.start)
      return ranges
    }, [message, selectedContexts])

    const findRangeContaining = useCallback(
      (pos: number) => {
        const ranges = computeMentionRanges()
        return ranges.find((r) => pos > r.start && pos < r.end)
      },
      [computeMentionRanges]
    )

    const deleteRange = useCallback(
      (range: { start: number; end: number; label: string }) => {
        const before = message.slice(0, range.start)
        const after = message.slice(range.end)
        const next = `${before}${after}`.replace(/\s{2,}/g, ' ')
        setMessage(next)

        setSelectedContexts((prev) => prev.filter((c) => c.label !== range.label))

        requestAnimationFrame(() => {
          const textarea = mentionMenu.textareaRef.current
          if (textarea) {
            textarea.setSelectionRange(range.start, range.start)
            textarea.focus()
          }
        })
      },
      [message, setMessage, mentionMenu.textareaRef]
    )

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Escape key handling
        if (e.key === 'Escape' && mentionMenu.showMentionMenu) {
          e.preventDefault()
          if (mentionMenu.openSubmenuFor) {
            mentionMenu.setOpenSubmenuFor(null)
            mentionMenu.setSubmenuQueryStart(null)
          } else {
            mentionMenu.closeMentionMenu()
          }
          return
        }

        // Arrow navigation in mention menu
        if (mentionKeyboard.handleArrowNavigation(e)) return
        if (mentionKeyboard.handleArrowRight(e)) return
        if (mentionKeyboard.handleArrowLeft(e)) return

        // Enter key handling
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          if (!mentionMenu.showMentionMenu) {
            handleSubmit()
          } else {
            mentionKeyboard.handleEnterSelection(e)
          }
          return
        }

        // Handle mention token behavior (backspace, delete, arrow keys) when menu is closed
        if (!mentionMenu.showMentionMenu) {
          const textarea = mentionMenu.textareaRef.current
          const selStart = textarea?.selectionStart ?? 0
          const selEnd = textarea?.selectionEnd ?? selStart
          const selectionLength = Math.abs(selEnd - selStart)

          if (e.key === 'Backspace') {
            const ranges = computeMentionRanges()
            const target =
              selectionLength > 0
                ? ranges.find((r) => !(selEnd <= r.start || selStart >= r.end))
                : ranges.find((r) => selStart > r.start && selStart <= r.end)
            if (target) {
              e.preventDefault()
              deleteRange(target)
              return
            }
          }

          if (e.key === 'Delete') {
            const ranges = computeMentionRanges()
            const target = ranges.find((r) => selStart >= r.start && selStart < r.end)
            if (target) {
              e.preventDefault()
              deleteRange(target)
              return
            }
          }

          if (selectionLength === 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            if (textarea) {
              if (e.key === 'ArrowLeft') {
                const nextPos = Math.max(0, selStart - 1)
                const r = findRangeContaining(nextPos)
                if (r) {
                  e.preventDefault()
                  const target = r.start
                  requestAnimationFrame(() => textarea.setSelectionRange(target, target))
                  return
                }
              } else if (e.key === 'ArrowRight') {
                const nextPos = Math.min(message.length, selStart + 1)
                const r = findRangeContaining(nextPos)
                if (r) {
                  e.preventDefault()
                  const target = r.end
                  requestAnimationFrame(() => textarea.setSelectionRange(target, target))
                  return
                }
              }
            }
          }

          // Prevent typing inside token
          if (e.key.length === 1 || e.key === 'Space') {
            const blocked = selectionLength === 0 && !!findRangeContaining(selStart)
            if (blocked) {
              e.preventDefault()
              const r = findRangeContaining(selStart)
              if (r && textarea) {
                requestAnimationFrame(() => {
                  textarea.setSelectionRange(r.end, r.end)
                })
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
        message.length,
        computeMentionRanges,
        deleteRange,
        findRangeContaining,
      ]
    )

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value
        setMessage(newValue)

        const caret = e.target.selectionStart ?? newValue.length
        const active = mentionMenu.getActiveMentionQueryAtPosition(caret, newValue)

        if (active) {
          mentionMenu.setShowMentionMenu(true)
          mentionMenu.setInAggregated(false)
          if (mentionMenu.openSubmenuFor) {
            mentionMenu.setSubmenuActiveIndex(0)
          } else {
            mentionMenu.setMentionActiveIndex(0)
            mentionMenu.setSubmenuActiveIndex(0)
          }
        } else {
          mentionMenu.setShowMentionMenu(false)
          mentionMenu.setOpenSubmenuFor(null)
          mentionMenu.setSubmenuQueryStart(null)
        }
      },
      [setMessage, mentionMenu]
    )

    const handleSelectAdjust = useCallback(() => {
      const textarea = mentionMenu.textareaRef.current
      if (!textarea) return
      const pos = textarea.selectionStart ?? 0
      const r = findRangeContaining(pos)
      if (r) {
        const snapPos = pos - r.start < r.end - pos ? r.start : r.end
        requestAnimationFrame(() => {
          textarea.setSelectionRange(snapPos, snapPos)
        })
      }
    }, [mentionMenu.textareaRef, findRangeContaining])

    const handleOpenMentionMenuWithAt = useCallback(() => {
      if (disabled || isLoading) return
      const textarea = mentionMenu.textareaRef.current
      if (!textarea) return
      textarea.focus()
      const pos = textarea.selectionStart ?? message.length
      const needsSpaceBefore = pos > 0 && !/\s/.test(message.charAt(pos - 1))

      const insertText = needsSpaceBefore ? ' @' : '@'
      const start = textarea.selectionStart ?? message.length
      const end = textarea.selectionEnd ?? message.length
      const before = message.slice(0, start)
      const after = message.slice(end)
      const next = `${before}${insertText}${after}`
      setMessage(next)

      setTimeout(() => {
        const newPos = before.length + insertText.length
        textarea.setSelectionRange(newPos, newPos)
        textarea.focus()
      }, 0)

      mentionMenu.setShowMentionMenu(true)
      mentionMenu.setOpenSubmenuFor(null)
      mentionMenu.setMentionActiveIndex(0)
      mentionMenu.setSubmenuActiveIndex(0)
    }, [disabled, isLoading, mentionMenu, message, setMessage])

    const canSubmit = message.trim().length > 0 && !disabled && !isLoading
    const showAbortButton = isLoading && onAbort

    // Render overlay content with highlighted mentions
    const renderOverlayContent = useCallback(() => {
      const elements: React.ReactNode[] = []
      const contexts = selectedContexts
      if (contexts.length === 0 || !message) return message

      const labels = contexts.map((c) => c.label).filter(Boolean)
      const pattern = new RegExp(
        `@(${labels.map((l) => l!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
        'g'
      )
      let lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = pattern.exec(message)) !== null) {
        const i = match.index
        const before = message.slice(lastIndex, i)
        if (before) elements.push(before)

        const mentionText = match[0]
        elements.push(
          <span
            key={`${mentionText}-${i}-${lastIndex}`}
            style={{
              backgroundColor:
                'color-mix(in srgb, var(--brand-primary-hover-hex) 14%, transparent)',
              borderRadius: '6px',
            }}
          >
            {mentionText}
          </span>
        )
        lastIndex = i + mentionText.length
      }

      const tail = message.slice(lastIndex)
      if (tail) elements.push(tail)
      return elements
    }, [message, selectedContexts])

    return (
      <div ref={setContainerRef} className={cn('relative flex-none', className)}>
        <div
          className={cn(
            'relative rounded-[4px] border border-[#3D3D3D] bg-[#282828] px-[8px] py-[6px] transition-colors dark:bg-[#353535]',
            fileAttachments.isDragging &&
              'border-[var(--brand-primary-hover-hex)] bg-purple-50/50 dark:border-[var(--brand-primary-hover-hex)] dark:bg-purple-950/20'
          )}
          onDragEnter={fileAttachments.handleDragEnter}
          onDragLeave={fileAttachments.handleDragLeave}
          onDragOver={fileAttachments.handleDragOver}
          onDrop={fileAttachments.handleDrop}
        >
          {/* Top Row: @ Button + Context Usage Pill */}
          <div className='mb-[6px] flex items-center justify-between'>
            <Badge
              onClick={handleOpenMentionMenuWithAt}
              title='Insert @'
              className={cn(
                'radius-[6px] cursor-pointer border border-[#575757] bg-transparent dark:border-[#575757] dark:bg-transparent',
                (disabled || isLoading) && 'cursor-not-allowed',
                'rounded-[6px] p-[4.5px]'
              )}
            >
              <AtSign className='h-3 w-3' strokeWidth={1.25} />
            </Badge>

            {/* Context Usage Pill */}
            {!hideContextUsage && contextUsage && contextUsage.percentage > 0 && (
              <ContextUsagePill
                percentage={contextUsage.percentage}
                onCreateNewChat={createNewChat}
              />
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

          {/* Selected Context Pills */}
          <ContextPills
            contexts={selectedContexts}
            onRemoveContext={(label) => {
              setSelectedContexts((prev) => prev.filter((c) => c.label !== label))
            }}
          />

          {/* Textarea Field with overlay */}
          <div className='relative'>
            {/* Highlight overlay */}
            <div
              ref={overlayRef}
              className='pointer-events-none absolute inset-0 z-[1] max-h-[120px] overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words px-[2px] py-1 [&::-webkit-scrollbar]:hidden'
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              <pre className='m-0 whitespace-pre-wrap break-words font-sans text-foreground text-sm leading-[1.25rem]'>
                {renderOverlayContent()}
              </pre>
            </div>

            <Textarea
              ref={mentionMenu.textareaRef}
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onSelect={handleSelectAdjust}
              onMouseUp={handleSelectAdjust}
              onScroll={(e) => {
                if (overlayRef.current) {
                  overlayRef.current.scrollTop = e.currentTarget.scrollTop
                  overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
                }
              }}
              placeholder={fileAttachments.isDragging ? 'Drop files here...' : effectivePlaceholder}
              disabled={disabled}
              rows={1}
              className='relative z-[2] mb-[6px] min-h-[32px] w-full resize-none overflow-y-auto overflow-x-hidden break-words border-0 bg-transparent px-[2px] py-1 font-sans text-sm text-transparent leading-[1.25rem] caret-foreground focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden'
              style={{
                height: 'auto',
                wordBreak: 'break-word',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              }}
            />

            {/* Mention Menu Portal */}
            {mentionMenu.showMentionMenu &&
              mentionMenu.mentionPortalStyle &&
              createPortal(
                <MentionMenuPortal
                  mentionMenu={mentionMenu}
                  mentionData={mentionData}
                  selectedContexts={selectedContexts}
                  onContextSelect={(context) => {
                    setSelectedContexts((prev) => {
                      const exists = prev.some((c) => c.label === context.label)
                      if (exists) return prev
                      return [...prev, context]
                    })
                  }}
                  onMessageChange={setMessage}
                  message={message}
                  workflowId={workflowId}
                  insertHandlers={{
                    insertPastChatMention,
                    insertWorkflowMention,
                    insertKnowledgeMention,
                    insertBlockMention,
                    insertWorkflowBlockMention,
                    insertTemplateMention,
                    insertLogMention,
                    insertDocsMention,
                  }}
                />,
                document.body
              )}
          </div>

          {/* Bottom Row: Mode Selector + Model Selector + Attach Button + Send Button */}
          <div className='flex items-center justify-between gap-2'>
            {/* Left side: Mode Selector + Model Selector */}
            <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
              <ModeSelector
                mode={mode}
                onModeChange={onModeChange}
                isNearTop={isNearTop}
                disabled={disabled}
              />

              <ModelSelector
                selectedModel={modelSelection.selectedModel}
                agentPrefetch={modelSelection.agentPrefetch}
                enabledModels={modelSelection.enabledModels}
                panelWidth={panelWidth}
                isNearTop={isNearTop}
                onModelSelect={(model: string) => modelSelection.setSelectedModel(model as any)}
                onAgentPrefetchChange={modelSelection.setAgentPrefetch}
                onFirstOpen={modelSelection.fetchEnabledModelsOnce}
              />
            </div>

            {/* Right side: Attach Button + Send Button */}
            <div className='flex flex-shrink-0 items-center gap-[10px]'>
              <Badge
                onClick={fileAttachments.handleFileSelect}
                title='Attach file'
                className={cn(
                  'cursor-pointer rounded-[6px] bg-transparent p-[0px] dark:bg-transparent',
                  (disabled || isLoading) && 'cursor-not-allowed opacity-50'
                )}
              >
                <Image className='!h-3.5 !w-3.5 scale-x-110' />
              </Badge>

              {showAbortButton ? (
                <ShadCNButton
                  onClick={handleAbort}
                  disabled={isAborting}
                  size='icon'
                  className='h-6 w-6 rounded-full bg-red-500 text-white transition-all duration-200 hover:bg-red-600'
                  title='Stop generation'
                >
                  {isAborting ? (
                    <Loader2 className='h-3 w-3 animate-spin' />
                  ) : (
                    <X className='h-3 w-3' />
                  )}
                </ShadCNButton>
              ) : (
                <Button
                  variant='primary'
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className={cn(
                    'h-[22px] w-[22px] rounded-full p-0',
                    canSubmit &&
                      'ring-2 ring-[#8E4CFB] ring-offset-2 ring-offset-[#282828] dark:ring-offset-[#353535]'
                  )}
                >
                  {isLoading ? (
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  ) : (
                    <ArrowUp className='h-3.5 w-3.5' />
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Hidden File Input */}
          <input
            ref={fileAttachments.fileInputRef}
            type='file'
            onChange={fileAttachments.handleFileChange}
            className='hidden'
            accept='image/*'
            multiple
            disabled={disabled || isLoading}
          />
        </div>
      </div>
    )
  }
)

UserInput.displayName = 'UserInput'

export { UserInput }
export type { UserInputRef }
