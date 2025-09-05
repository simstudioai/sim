'use client'

import {
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  ArrowUp,
  AtSign,
  Blocks,
  BookOpen,
  Bot,
  Box,
  Brain,
  BrainCircuit,
  Check,
  ChevronRight,
  FileText,
  Image,
  Infinity as InfinityIcon,
  Info,
  LibraryBig,
  Loader2,
  MessageCircle,
  Package,
  Paperclip,
  Shapes,
  SquareChevronRight,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { CopilotSlider } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/components/copilot-slider'
import { useCopilotStore } from '@/stores/copilot/store'
import type { ChatContext } from '@/stores/copilot/types'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('CopilotUserInput')

export interface MessageFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

interface AttachedFile {
  id: string
  name: string
  size: number
  type: string
  path: string
  key?: string // Add key field to store the actual storage key
  uploading: boolean
  previewUrl?: string // For local preview of images before upload
}

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
  value?: string // Controlled value from outside
  onChange?: (value: string) => void // Callback when value changes
}

interface UserInputRef {
  focus: () => void
}

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
    },
    ref
  ) => {
    const [internalMessage, setInternalMessage] = useState('')
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
    // Drag and drop state
    const [isDragging, setIsDragging] = useState(false)
    const [dragCounter, setDragCounter] = useState(0)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [showMentionMenu, setShowMentionMenu] = useState(false)
    const mentionMenuRef = useRef<HTMLDivElement>(null)
    const submenuRef = useRef<HTMLDivElement>(null)
    const menuListRef = useRef<HTMLDivElement>(null)
    const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
    const mentionOptions = [
      'Chats',
      'Workflows',
      'Workflow Blocks',
      'Blocks',
      'Knowledge',
      'Docs',
      'Templates',
      'Logs',
    ]
    const [openSubmenuFor, setOpenSubmenuFor] = useState<string | null>(null)
    const [submenuActiveIndex, setSubmenuActiveIndex] = useState(0)
    const [inAggregated, setInAggregated] = useState(false)
    const isSubmenu = (
      v: 'Chats' | 'Workflows' | 'Workflow Blocks' | 'Knowledge' | 'Blocks' | 'Templates' | 'Logs'
    ) => openSubmenuFor === v
    const [pastChats, setPastChats] = useState<
      Array<{ id: string; title: string | null; workflowId: string | null; updatedAt?: string }>
    >([])
    const [isLoadingPastChats, setIsLoadingPastChats] = useState(false)
    // Removed explicit submenu query inputs; we derive query from the text typed after '@'
    const [selectedContexts, setSelectedContexts] = useState<ChatContext[]>([])
    const [workflows, setWorkflows] = useState<Array<{ id: string; name: string; color?: string }>>(
      []
    )
    const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false)
    const [knowledgeBases, setKnowledgeBases] = useState<Array<{ id: string; name: string }>>([])
    const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false)
    const [blocksList, setBlocksList] = useState<
      Array<{ id: string; name: string; iconComponent?: any; bgColor?: string }>
    >([])
    const [isLoadingBlocks, setIsLoadingBlocks] = useState(false)
    const [templatesList, setTemplatesList] = useState<
      Array<{ id: string; name: string; stars: number }>
    >([])
    const [isLoadingTemplates, setIsLoadingTemplates] = useState(false)
    // const [templatesQuery, setTemplatesQuery] = useState('')
    // Add logs list state
    const [logsList, setLogsList] = useState<
      Array<{
        id: string
        executionId?: string
        level: string
        trigger: string | null
        createdAt: string
        workflowName: string
      }>
    >([])
    const [isLoadingLogs, setIsLoadingLogs] = useState(false)

    const { data: session } = useSession()
    const { currentChat, workflowId } = useCopilotStore()
    const params = useParams()
    const workspaceId = params.workspaceId as string
    // Track per-chat preference for auto-adding workflow context
    const [workflowAutoAddDisabledMap, setWorkflowAutoAddDisabledMap] = useState<
      Record<string, boolean>
    >({})
    // Also track for new chats (no ID yet)
    const [newChatWorkflowDisabled, setNewChatWorkflowDisabled] = useState(false)
    const workflowAutoAddDisabled = currentChat?.id
      ? workflowAutoAddDisabledMap[currentChat.id] || false
      : newChatWorkflowDisabled

    // Determine placeholder based on mode
    const effectivePlaceholder =
      placeholder ||
      (mode === 'ask' ? 'Ask, plan, understand workflows' : 'Build, edit, debug workflows')

    // Track submenu query anchor and aggregate mode
    const [submenuQueryStart, setSubmenuQueryStart] = useState<number | null>(null)
    const [aggregatedActive, setAggregatedActive] = useState(false)

    // Expose focus method to parent
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          textareaRef.current?.focus()
        },
      }),
      []
    )

    // Use controlled value if provided, otherwise use internal state
    const message = controlledValue !== undefined ? controlledValue : internalMessage
    const setMessage =
      controlledValue !== undefined ? onControlledChange || (() => {}) : setInternalMessage

    // Load workflows on mount if we have a workflowId
    useEffect(() => {
      if (workflowId && workflows.length === 0) {
        ensureWorkflowsLoaded()
      }
    }, [workflowId])

    // Track the last chat ID we've seen to detect chat changes
    const [lastChatId, setLastChatId] = useState<string | undefined>(undefined)
    // Track if we just sent a message to avoid re-adding context after submit
    const [justSentMessage, setJustSentMessage] = useState(false)

    // Reset states when switching to a truly new chat
    useEffect(() => {
      const currentChatId = currentChat?.id

      // Detect when we're switching to a different chat
      if (lastChatId !== currentChatId) {
        // If switching to a new chat (undefined ID) from a different state
        // reset the disabled flag so each new chat starts fresh
        if (!currentChatId && lastChatId !== undefined) {
          setNewChatWorkflowDisabled(false)
        }

        // If a new chat just got an ID assigned, transfer the disabled state
        if (currentChatId && !lastChatId && newChatWorkflowDisabled) {
          setWorkflowAutoAddDisabledMap((prev) => ({
            ...prev,
            [currentChatId]: true,
          }))
          // Keep newChatWorkflowDisabled as false for the next new chat
          setNewChatWorkflowDisabled(false)
        }

        // Reset the "just sent" flag when switching chats
        setJustSentMessage(false)

        setLastChatId(currentChatId)
      }
    }, [currentChat?.id, lastChatId, newChatWorkflowDisabled])

    // Auto-add workflow context when message is empty and not disabled
    useEffect(() => {
      // Don't auto-add if disabled or no workflow
      if (!workflowId || workflowAutoAddDisabled) return

      // Don't auto-add right after sending a message
      if (justSentMessage) return

      // Only add when message is empty (new message being composed)
      if (message && message.trim().length > 0) return

      // Check if current_workflow context already exists
      const hasCurrentWorkflowContext = selectedContexts.some(
        (ctx) => ctx.kind === 'current_workflow' && (ctx as any).workflowId === workflowId
      )
      if (hasCurrentWorkflowContext) {
        return
      }

      const addWorkflowContext = async () => {
        // Double-check disabled state right before adding
        if (workflowAutoAddDisabled) return

        // Get workflow name
        let workflowName = 'Current Workflow'

        // Try loaded workflows first
        const existingWorkflow = workflows.find((w) => w.id === workflowId)
        if (existingWorkflow) {
          workflowName = existingWorkflow.name
        } else if (workflows.length === 0) {
          // If workflows not loaded yet, try to fetch this specific one
          try {
            const resp = await fetch(`/api/workflows/${workflowId}`)
            if (resp.ok) {
              const data = await resp.json()
              workflowName = data?.data?.name || 'Current Workflow'
            }
          } catch {}
        }

        // Add current_workflow context using functional update to prevent duplicates
        setSelectedContexts((prev) => {
          const alreadyHasCurrentWorkflow = prev.some(
            (ctx) => ctx.kind === 'current_workflow' && (ctx as any).workflowId === workflowId
          )
          if (alreadyHasCurrentWorkflow) return prev

          return [
            ...prev,
            { kind: 'current_workflow', workflowId, label: workflowName } as ChatContext,
          ]
        })
      }

      addWorkflowContext()
    }, [workflowId, workflowAutoAddDisabled, workflows.length, message, justSentMessage]) // Re-run when message changes

    // Auto-resize textarea and toggle vertical scroll when exceeding max height
    useEffect(() => {
      const textarea = textareaRef.current
      if (textarea) {
        const maxHeight = 120
        textarea.style.height = 'auto'
        const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
        textarea.style.height = `${nextHeight}px`
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
      }
    }, [message])

    // Close mention menu on outside click
    useEffect(() => {
      if (!showMentionMenu) return
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node | null
        if (
          mentionMenuRef.current &&
          !mentionMenuRef.current.contains(target) &&
          (!submenuRef.current || !submenuRef.current.contains(target)) &&
          textareaRef.current &&
          !textareaRef.current.contains(target as Node)
        ) {
          setShowMentionMenu(false)
          setOpenSubmenuFor(null)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showMentionMenu])

    const ensurePastChatsLoaded = async () => {
      if (isLoadingPastChats || pastChats.length > 0) return
      try {
        setIsLoadingPastChats(true)
        const resp = await fetch('/api/copilot/chats')
        if (!resp.ok) throw new Error(`Failed to load chats: ${resp.status}`)
        const data = await resp.json()
        const items = Array.isArray(data?.chats) ? data.chats : []

        if (workflows.length === 0) {
          await ensureWorkflowsLoaded()
        }

        const workspaceWorkflowIds = new Set(workflows.map((w) => w.id))

        const workspaceChats = items.filter(
          (c: any) => !c.workflowId || workspaceWorkflowIds.has(c.workflowId)
        )

        setPastChats(
          workspaceChats.map((c: any) => ({
            id: c.id,
            title: c.title ?? null,
            workflowId: c.workflowId ?? null,
            updatedAt: c.updatedAt,
          }))
        )
      } catch {
      } finally {
        setIsLoadingPastChats(false)
      }
    }

    const ensureWorkflowsLoaded = async () => {
      if (isLoadingWorkflows || workflows.length > 0) return
      try {
        setIsLoadingWorkflows(true)
        const resp = await fetch('/api/workflows')
        if (!resp.ok) throw new Error(`Failed to load workflows: ${resp.status}`)
        const data = await resp.json()
        const items = Array.isArray(data?.data) ? data.data : []
        // Filter workflows by workspace (same as sidebar)
        const workspaceFiltered = items.filter(
          (w: any) => w.workspaceId === workspaceId || !w.workspaceId
        )
        // Sort by creation date (newest first) for stable ordering, matching sidebar behavior
        const sorted = [...workspaceFiltered].sort((a: any, b: any) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return dateB - dateA // Newest first for stable ordering
        })
        setWorkflows(
          sorted.map((w: any) => ({
            id: w.id,
            name: w.name || 'Untitled Workflow',
            color: w.color,
          }))
        )
      } catch {
      } finally {
        setIsLoadingWorkflows(false)
      }
    }

    const ensureKnowledgeLoaded = async () => {
      if (isLoadingKnowledge || knowledgeBases.length > 0) return
      try {
        setIsLoadingKnowledge(true)
        // Filter by workspace like the Knowledge page does
        const resp = await fetch(`/api/knowledge?workspaceId=${workspaceId}`)
        if (!resp.ok) throw new Error(`Failed to load knowledge bases: ${resp.status}`)
        const data = await resp.json()
        const items = Array.isArray(data?.data) ? data.data : []
        // Sort by updatedAt desc
        const sorted = [...items].sort((a: any, b: any) => {
          const ta = new Date(a.updatedAt || a.createdAt || 0).getTime()
          const tb = new Date(b.updatedAt || b.createdAt || 0).getTime()
          return tb - ta
        })
        setKnowledgeBases(sorted.map((k: any) => ({ id: k.id, name: k.name || 'Untitled' })))
      } catch {
      } finally {
        setIsLoadingKnowledge(false)
      }
    }

    const ensureBlocksLoaded = async () => {
      if (isLoadingBlocks || blocksList.length > 0) return
      try {
        setIsLoadingBlocks(true)
        const { getAllBlocks } = await import('@/blocks')
        const all = getAllBlocks()
        const regularBlocks = all
          .filter((b: any) => b.type !== 'starter' && !b.hideFromToolbar && b.category === 'blocks')
          .map((b: any) => ({
            id: b.type,
            name: b.name || b.type,
            iconComponent: b.icon,
            bgColor: b.bgColor,
          }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name))

        const toolBlocks = all
          .filter((b: any) => b.type !== 'starter' && !b.hideFromToolbar && b.category === 'tools')
          .map((b: any) => ({
            id: b.type,
            name: b.name || b.type,
            iconComponent: b.icon,
            bgColor: b.bgColor,
          }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name))

        const mapped = [...regularBlocks, ...toolBlocks]
        setBlocksList(mapped)
      } catch {
      } finally {
        setIsLoadingBlocks(false)
      }
    }

    const ensureTemplatesLoaded = async () => {
      if (isLoadingTemplates || templatesList.length > 0) return
      try {
        setIsLoadingTemplates(true)
        const resp = await fetch('/api/templates?limit=50&offset=0')
        if (!resp.ok) throw new Error(`Failed to load templates: ${resp.status}`)
        const data = await resp.json()
        const items = Array.isArray(data?.data) ? data.data : []
        const mapped = items
          .map((t: any) => ({ id: t.id, name: t.name || 'Untitled Template', stars: t.stars || 0 }))
          .sort((a: any, b: any) => b.stars - a.stars)
        setTemplatesList(mapped)
      } catch {
      } finally {
        setIsLoadingTemplates(false)
      }
    }

    // Cleanup preview URLs on unmount
    useEffect(() => {
      return () => {
        attachedFiles.forEach((f) => {
          if (f.previewUrl) {
            URL.revokeObjectURL(f.previewUrl)
          }
        })
      }
    }, [])

    // Helper to read current caret position for filtering
    const getCaretPos = () => textareaRef.current?.selectionStart ?? message.length

    // Drag and drop handlers
    const handleDragEnter = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragCounter((prev) => {
        const newCount = prev + 1
        if (newCount === 1) {
          setIsDragging(true)
        }
        return newCount
      })
    }

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragCounter((prev) => {
        const newCount = prev - 1
        if (newCount === 0) {
          setIsDragging(false)
        }
        return newCount
      })
    }

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Add visual feedback for valid drop zone
      e.dataTransfer.dropEffect = 'copy'
    }

    const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      setDragCounter(0)

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await processFiles(e.dataTransfer.files)
      }
    }

    // Process dropped or selected files
    const processFiles = async (fileList: FileList) => {
      const userId = session?.user?.id

      if (!userId) {
        logger.error('User ID not available for file upload')
        return
      }

      // Process files one by one
      for (const file of Array.from(fileList)) {
        // Only accept image files
        if (!file.type.startsWith('image/')) {
          logger.warn(`File ${file.name} is not an image. Only image files are allowed.`)
          continue
        }

        // Create a preview URL for images
        let previewUrl: string | undefined
        if (file.type.startsWith('image/')) {
          previewUrl = URL.createObjectURL(file)
        }

        // Create a temporary file entry with uploading state
        const tempFile: AttachedFile = {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type,
          path: '',
          uploading: true,
          previewUrl,
        }

        setAttachedFiles((prev) => [...prev, tempFile])

        try {
          // Request presigned URL
          const presignedResponse = await fetch('/api/files/presigned?type=copilot', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileName: file.name,
              contentType: file.type,
              fileSize: file.size,
              userId,
            }),
          })

          if (!presignedResponse.ok) {
            throw new Error('Failed to get presigned URL')
          }

          const presignedData = await presignedResponse.json()

          logger.info(`Uploading file: ${presignedData.presignedUrl}`)
          const uploadHeaders = presignedData.uploadHeaders || {}
          const uploadResponse = await fetch(presignedData.presignedUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type,
              ...uploadHeaders,
            },
            body: file,
          })

          logger.info(`Upload response status: ${uploadResponse.status}`)

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text()
            logger.error(`Upload failed: ${errorText}`)
            throw new Error(`Failed to upload file: ${uploadResponse.status} ${errorText}`)
          }

          // Update file entry with success
          setAttachedFiles((prev) =>
            prev.map((f) =>
              f.id === tempFile.id
                ? {
                    ...f,
                    path: presignedData.fileInfo.path,
                    key: presignedData.fileInfo.key, // Store the actual storage key
                    uploading: false,
                  }
                : f
            )
          )
        } catch (error) {
          logger.error(`File upload failed: ${error}`)
          // Remove failed upload
          setAttachedFiles((prev) => prev.filter((f) => f.id !== tempFile.id))
        }
      }
    }

    const handleSubmit = async () => {
      const trimmedMessage = message.trim()
      if (!trimmedMessage || disabled || isLoading) return

      // Check for failed uploads and show user feedback
      const failedUploads = attachedFiles.filter((f) => !f.uploading && !f.key)
      if (failedUploads.length > 0) {
        logger.error(`Some files failed to upload: ${failedUploads.map((f) => f.name).join(', ')}`)
      }

      // Convert attached files to the format expected by the API
      const fileAttachments = attachedFiles
        .filter((f) => !f.uploading && f.key) // Only include successfully uploaded files with keys
        .map((f) => ({
          id: f.id,
          key: f.key!, // Use the actual storage key from the upload response
          filename: f.name,
          media_type: f.type,
          size: f.size,
        }))

      // Build contexts to send: hide current_workflow in UI but always include it in payload
      const uiContexts = selectedContexts.filter((c) => (c as any).kind !== 'current_workflow')
      const finalContexts: any[] = [...uiContexts]

      if (workflowId) {
        // Include current_workflow for the agent; label not shown in UI
        finalContexts.push({ kind: 'current_workflow', workflowId, label: 'Current Workflow' })
      }

      onSubmit(trimmedMessage, fileAttachments, finalContexts as any)

      // Clean up preview URLs before clearing
      attachedFiles.forEach((f) => {
        if (f.previewUrl) {
          URL.revokeObjectURL(f.previewUrl)
        }
      })

      // Clear the message and files after submit
      if (controlledValue !== undefined) {
        onControlledChange?.('')
      } else {
        setInternalMessage('')
      }
      setAttachedFiles([])

      // Clear @mention contexts after submission, but preserve current_workflow if not disabled
      setSelectedContexts((prev) => {
        // Keep current_workflow context if it's not disabled
        const currentWorkflowCtx = prev.find(
          (ctx) => ctx.kind === 'current_workflow' && !workflowAutoAddDisabled
        )
        return currentWorkflowCtx ? [currentWorkflowCtx] : []
      })

      // Mark that we just sent a message to prevent auto-add
      setJustSentMessage(true)

      setOpenSubmenuFor(null)
      setShowMentionMenu(false)
    }

    const handleAbort = () => {
      if (onAbort && isLoading) {
        onAbort()
      }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape' && showMentionMenu) {
        e.preventDefault()
        if (openSubmenuFor) {
          setOpenSubmenuFor(null)
          setSubmenuQueryStart(null)
        } else {
          setShowMentionMenu(false)
          // Reset all mention states so @ is treated as regular text
          setOpenSubmenuFor(null)
          setSubmenuQueryStart(null)
          setMentionActiveIndex(0)
          setSubmenuActiveIndex(0)
          setInAggregated(false)
        }
        return
      }
      if (showMentionMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        const caretPos = getCaretPos()
        const active = getActiveMentionQueryAtPosition(caretPos)
        const mainQ = (!openSubmenuFor ? active?.query || '' : '').toLowerCase()
        const filteredMain = !openSubmenuFor
          ? mentionOptions.filter((o) => o.toLowerCase().includes(mainQ))
          : []
        const isAggregate = !openSubmenuFor && mainQ.length > 0 && filteredMain.length === 0
        const aggregatedList =
          !openSubmenuFor && mainQ.length > 0
            ? [
                ...workflowBlocks
                  .filter((b) => (b.name || b.id).toLowerCase().includes(mainQ))
                  .map((b) => ({ type: 'Workflow Blocks' as const, value: b })),
                ...workflows
                  .filter((w) => (w.name || 'Untitled Workflow').toLowerCase().includes(mainQ))
                  .map((w) => ({ type: 'Workflows' as const, value: w })),
                ...blocksList
                  .filter((b) => (b.name || b.id).toLowerCase().includes(mainQ))
                  .map((b) => ({ type: 'Blocks' as const, value: b })),
                ...knowledgeBases
                  .filter((k) => (k.name || 'Untitled').toLowerCase().includes(mainQ))
                  .map((k) => ({ type: 'Knowledge' as const, value: k })),
                ...templatesList
                  .filter((t) => (t.name || 'Untitled Template').toLowerCase().includes(mainQ))
                  .map((t) => ({ type: 'Templates' as const, value: t })),
                ...pastChats
                  .filter((c) => (c.title || 'Untitled Chat').toLowerCase().includes(mainQ))
                  .map((c) => ({ type: 'Chats' as const, value: c })),
              ]
            : []

        if (openSubmenuFor === 'Chats' && pastChats.length > 0) {
          const q = getSubmenuQuery().toLowerCase()
          const filtered = pastChats.filter((c) =>
            (c.title || 'Untitled Chat').toLowerCase().includes(q)
          )
          setSubmenuActiveIndex((prev) => {
            const last = Math.max(0, filtered.length - 1)
            let next = prev
            if (filtered.length === 0) next = 0
            else if (e.key === 'ArrowDown') next = prev >= last ? 0 : prev + 1
            else next = prev <= 0 ? last : prev - 1
            requestAnimationFrame(() => scrollActiveItemIntoView(next))
            return next
          })
        } else if (openSubmenuFor === 'Workflows' && workflows.length > 0) {
          const q = getSubmenuQuery().toLowerCase()
          const filtered = workflows.filter((w) =>
            (w.name || 'Untitled Workflow').toLowerCase().includes(q)
          )
          setSubmenuActiveIndex((prev) => {
            const last = Math.max(0, filtered.length - 1)
            let next = prev
            if (filtered.length === 0) next = 0
            else if (e.key === 'ArrowDown') next = prev >= last ? 0 : prev + 1
            else next = prev <= 0 ? last : prev - 1
            requestAnimationFrame(() => scrollActiveItemIntoView(next))
            return next
          })
        } else if (openSubmenuFor === 'Knowledge' && knowledgeBases.length > 0) {
          const q = getSubmenuQuery().toLowerCase()
          const filtered = knowledgeBases.filter((k) =>
            (k.name || 'Untitled').toLowerCase().includes(q)
          )
          setSubmenuActiveIndex((prev) => {
            const last = Math.max(0, filtered.length - 1)
            let next = prev
            if (filtered.length === 0) next = 0
            else if (e.key === 'ArrowDown') next = prev >= last ? 0 : prev + 1
            else next = prev <= 0 ? last : prev - 1
            requestAnimationFrame(() => scrollActiveItemIntoView(next))
            return next
          })
        } else if (openSubmenuFor === 'Blocks' && blocksList.length > 0) {
          const q = getSubmenuQuery().toLowerCase()
          const filtered = blocksList.filter((b) => (b.name || b.id).toLowerCase().includes(q))
          setSubmenuActiveIndex((prev) => {
            const last = Math.max(0, filtered.length - 1)
            let next = prev
            if (filtered.length === 0) next = 0
            else if (e.key === 'ArrowDown') next = prev >= last ? 0 : prev + 1
            else next = prev <= 0 ? last : prev - 1
            requestAnimationFrame(() => scrollActiveItemIntoView(next))
            return next
          })
        } else if (openSubmenuFor === 'Workflow Blocks' && workflowBlocks.length > 0) {
          const q = getSubmenuQuery().toLowerCase()
          const filtered = workflowBlocks.filter((b) => (b.name || b.id).toLowerCase().includes(q))
          setSubmenuActiveIndex((prev) => {
            const last = Math.max(0, filtered.length - 1)
            let next = prev
            if (filtered.length === 0) next = 0
            else if (e.key === 'ArrowDown') next = prev >= last ? 0 : prev + 1
            else next = prev <= 0 ? last : prev - 1
            requestAnimationFrame(() => scrollActiveItemIntoView(next))
            return next
          })
        } else if (openSubmenuFor === 'Templates' && templatesList.length > 0) {
          const q = getSubmenuQuery().toLowerCase()
          const filtered = templatesList.filter((t) =>
            (t.name || 'Untitled Template').toLowerCase().includes(q)
          )
          setSubmenuActiveIndex((prev) => {
            const last = Math.max(0, filtered.length - 1)
            let next = prev
            if (filtered.length === 0) next = 0
            else if (e.key === 'ArrowDown') next = prev >= last ? 0 : prev + 1
            else next = prev <= 0 ? last : prev - 1
            requestAnimationFrame(() => scrollActiveItemIntoView(next))
            return next
          })
        } else if (openSubmenuFor === 'Logs' && logsList.length > 0) {
          const q = getSubmenuQuery().toLowerCase()
          const filtered = logsList.filter((l) =>
            [l.workflowName, l.trigger || ''].join(' ').toLowerCase().includes(q)
          )
          setSubmenuActiveIndex((prev) => {
            const last = Math.max(0, filtered.length - 1)
            let next = prev
            if (filtered.length === 0) next = 0
            else if (e.key === 'ArrowDown') next = prev >= last ? 0 : prev + 1
            else next = prev <= 0 ? last : prev - 1
            requestAnimationFrame(() => scrollActiveItemIntoView(next))
            return next
          })
        } else if (isAggregate) {
          const q = mainQ
          const aggregated = [
            ...workflows
              .filter((w) => (w.name || 'Untitled Workflow').toLowerCase().includes(q))
              .map((w) => ({ type: 'Workflows' as const, value: w })),
            ...blocksList
              .filter((b) => (b.name || b.id).toLowerCase().includes(q))
              .map((b) => ({ type: 'Blocks' as const, value: b })),
            ...knowledgeBases
              .filter((k) => (k.name || 'Untitled').toLowerCase().includes(q))
              .map((k) => ({ type: 'Knowledge' as const, value: k })),
            ...templatesList
              .filter((t) => (t.name || 'Untitled Template').toLowerCase().includes(q))
              .map((t) => ({ type: 'Templates' as const, value: t })),
            ...pastChats
              .filter((c) => (c.title || 'Untitled Chat').toLowerCase().includes(q))
              .map((c) => ({ type: 'Chats' as const, value: c })),
            ...logsList
              .filter((l) => (l.workflowName || 'Untitled Workflow').toLowerCase().includes(q))
              .map((l) => ({ type: 'Logs' as const, value: l })),
          ]
          setInAggregated(true)
          setSubmenuActiveIndex((prev) => {
            const last = Math.max(0, aggregated.length - 1)
            let next = prev
            if (aggregated.length === 0) next = 0
            else if (e.key === 'ArrowDown') next = prev >= last ? 0 : prev + 1
            else next = prev <= 0 ? last : prev - 1
            requestAnimationFrame(() => scrollActiveItemIntoView(next))
            return next
          })
        } else {
          // Navigate through main options, then into aggregated matches
          if (!inAggregated) {
            const lastMain = Math.max(0, filteredMain.length - 1)
            if (filteredMain.length === 0) {
              // jump straight into aggregated if any
              if (aggregatedList.length > 0) {
                setInAggregated(true)
                setSubmenuActiveIndex(0)
                requestAnimationFrame(() => scrollActiveItemIntoView(0))
              }
            } else if (e.key === 'ArrowDown' && mentionActiveIndex >= lastMain) {
              if (aggregatedList.length > 0) {
                setInAggregated(true)
                setSubmenuActiveIndex(0)
                requestAnimationFrame(() => scrollActiveItemIntoView(0))
              } else {
                setMentionActiveIndex(0)
                requestAnimationFrame(() => scrollActiveItemIntoView(0))
              }
            } else if (
              e.key === 'ArrowUp' &&
              mentionActiveIndex <= 0 &&
              aggregatedList.length > 0
            ) {
              setInAggregated(true)
              setSubmenuActiveIndex(Math.max(0, aggregatedList.length - 1))
              requestAnimationFrame(() =>
                scrollActiveItemIntoView(Math.max(0, aggregatedList.length - 1))
              )
            } else {
              setMentionActiveIndex((prev) => {
                const last = lastMain
                let next = prev
                if (filteredMain.length === 0) next = 0
                else if (e.key === 'ArrowDown') next = prev >= last ? last : prev + 1
                else next = prev <= 0 ? 0 : prev - 1
                requestAnimationFrame(() => scrollActiveItemIntoView(next))
                return next
              })
            }
          } else {
            // inside aggregated list
            setSubmenuActiveIndex((prev) => {
              const last = Math.max(0, aggregatedList.length - 1)
              let next = prev
              if (aggregatedList.length === 0) next = 0
              else if (e.key === 'ArrowDown') {
                if (prev >= last) {
                  // wrap to main
                  setInAggregated(false)
                  requestAnimationFrame(() => scrollActiveItemIntoView(0))
                  return prev
                }
                next = prev + 1
              } else {
                if (prev <= 0) {
                  // move to main last
                  setInAggregated(false)
                  setMentionActiveIndex(Math.max(0, filteredMain.length - 1))
                  requestAnimationFrame(() =>
                    scrollActiveItemIntoView(Math.max(0, filteredMain.length - 1))
                  )
                  return prev
                }
                next = prev - 1
              }
              requestAnimationFrame(() => scrollActiveItemIntoView(next))
              return next
            })
          }
        }
        return
      }
      if (showMentionMenu && e.key === 'ArrowRight') {
        e.preventDefault()
        if (inAggregated) return
        const caretPos = getCaretPos()
        const active = getActiveMentionQueryAtPosition(caretPos)
        const mainQ = (active?.query || '').toLowerCase()
        const filteredMain = mentionOptions.filter((o) => o.toLowerCase().includes(mainQ))
        const selected = filteredMain[mentionActiveIndex]
        if (selected === 'Chats') {
          resetActiveMentionQuery()
          setOpenSubmenuFor('Chats')
          setSubmenuActiveIndex(0)
          setSubmenuQueryStart(getCaretPos())
          void ensurePastChatsLoaded()
        } else if (selected === 'Workflows') {
          resetActiveMentionQuery()
          setOpenSubmenuFor('Workflows')
          setSubmenuActiveIndex(0)
          setSubmenuQueryStart(getCaretPos())
          void ensureWorkflowsLoaded()
        } else if (selected === 'Knowledge') {
          resetActiveMentionQuery()
          setOpenSubmenuFor('Knowledge')
          setSubmenuActiveIndex(0)
          setSubmenuQueryStart(getCaretPos())
          void ensureKnowledgeLoaded()
        } else if (selected === 'Blocks') {
          resetActiveMentionQuery()
          setOpenSubmenuFor('Blocks')
          setSubmenuActiveIndex(0)
          setSubmenuQueryStart(getCaretPos())
          void ensureBlocksLoaded()
        } else if (selected === 'Workflow Blocks') {
          resetActiveMentionQuery()
          setOpenSubmenuFor('Workflow Blocks')
          setSubmenuActiveIndex(0)
          setSubmenuQueryStart(getCaretPos())
          void ensureWorkflowBlocksLoaded()
        } else if (selected === 'Docs') {
          // No submenu; insert immediately
          resetActiveMentionQuery()
          insertDocsMention()
        } else if (selected === 'Templates') {
          resetActiveMentionQuery()
          setOpenSubmenuFor('Templates')
          setSubmenuActiveIndex(0)
          setSubmenuQueryStart(getCaretPos())
          void ensureTemplatesLoaded()
        } else if (selected === 'Logs') {
          resetActiveMentionQuery()
          setOpenSubmenuFor('Logs')
          setSubmenuActiveIndex(0)
          setSubmenuQueryStart(getCaretPos())
          void ensureLogsLoaded()
        }
        return
      }
      if (showMentionMenu && e.key === 'ArrowLeft') {
        if (openSubmenuFor) {
          e.preventDefault()
          setOpenSubmenuFor(null)
          setSubmenuQueryStart(null)
          return
        }
        if (inAggregated) {
          e.preventDefault()
          setInAggregated(false)
          return
        }
      }

      // Mention token behavior (outside of menus)
      const textarea = textareaRef.current
      const selStart = textarea?.selectionStart ?? 0
      const selEnd = textarea?.selectionEnd ?? selStart
      const selectionLength = Math.abs(selEnd - selStart)

      // Backspace: delete entire token if cursor is inside or right after token
      if (!showMentionMenu && e.key === 'Backspace') {
        const pos = selStart
        const ranges = computeMentionRanges()
        // If there is a selection intersecting a token, delete those tokens
        const target =
          selectionLength > 0
            ? ranges.find((r) => !(selEnd <= r.start || selStart >= r.end))
            : ranges.find((r) => pos > r.start && pos <= r.end)
        if (target) {
          e.preventDefault()
          deleteRange(target)
          return
        }
      }

      // Delete: if at start of token, delete whole token
      if (!showMentionMenu && e.key === 'Delete') {
        const pos = selStart
        const ranges = computeMentionRanges()
        const target = ranges.find((r) => pos >= r.start && pos < r.end)
        if (target) {
          e.preventDefault()
          deleteRange(target)
          return
        }
      }

      // Arrow navigation: jump over mention tokens, never land inside
      if (
        !showMentionMenu &&
        selectionLength === 0 &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        const textarea = textareaRef.current
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
      if (!showMentionMenu && (e.key.length === 1 || e.key === 'Space')) {
        const pos = selStart
        const ranges = computeMentionRanges()
        // Only block when caret is strictly inside a token with no selection
        const blocked =
          selectionLength === 0 && !!findRangeContaining(pos) && !!findRangeContaining(pos)?.label
        if (blocked) {
          e.preventDefault()
          // Move caret to end of the token
          const r = findRangeContaining(pos)
          if (r && textarea) {
            requestAnimationFrame(() => {
              textarea.setSelectionRange(r.end, r.end)
            })
          }
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!showMentionMenu) {
          handleSubmit()
        } else {
          const caretPos = getCaretPos()
          const active = getActiveMentionQueryAtPosition(caretPos)
          const mainQ = (active?.query || '').toLowerCase()
          const filteredMain = mentionOptions.filter((o) => o.toLowerCase().includes(mainQ))
          const isAggregate = !openSubmenuFor && mainQ.length > 0 && filteredMain.length === 0
          const selected = filteredMain[mentionActiveIndex]
          if (inAggregated) {
            const q = mainQ
            const aggregated: Array<{ type: string; value: any }> = [
              ...workflowBlocks
                .filter((b) => (b.name || b.id).toLowerCase().includes(q))
                .map((b) => ({ type: 'Workflow Blocks', value: b })),
              ...workflows
                .filter((w) => (w.name || 'Untitled Workflow').toLowerCase().includes(q))
                .map((w) => ({ type: 'Workflows', value: w })),
              ...blocksList
                .filter((b) => (b.name || b.id).toLowerCase().includes(q))
                .map((b) => ({ type: 'Blocks', value: b })),
              ...knowledgeBases
                .filter((k) => (k.name || 'Untitled').toLowerCase().includes(q))
                .map((k) => ({ type: 'Knowledge', value: k })),
              ...templatesList
                .filter((t) => (t.name || 'Untitled Template').toLowerCase().includes(q))
                .map((t) => ({ type: 'Templates', value: t })),
              ...pastChats
                .filter((c) => (c.title || 'Untitled Chat').toLowerCase().includes(q))
                .map((c) => ({ type: 'Chats', value: c })),
              ...logsList
                .filter((l) => (l.workflowName || 'Untitled Workflow').toLowerCase().includes(q))
                .map((l) => ({ type: 'Logs', value: l })),
            ]
            const idx = Math.max(0, Math.min(submenuActiveIndex, aggregated.length - 1))
            const chosen = aggregated[idx]
            if (chosen) {
              if (chosen.type === 'Chats') insertPastChatMention(chosen.value as any)
              else if (chosen.type === 'Workflows') insertWorkflowMention(chosen.value as any)
              else if (chosen.type === 'Knowledge') insertKnowledgeMention(chosen.value as any)
              else if (chosen.type === 'Workflow Blocks')
                insertWorkflowBlockMention(chosen.value as any)
              else if (chosen.type === 'Blocks') insertBlockMention(chosen.value as any)
              else if (chosen.type === 'Templates') insertTemplateMention(chosen.value as any)
              else if (chosen.type === 'Logs') insertLogMention(chosen.value as any)
            }
          } else if (!openSubmenuFor && selected === 'Chats') {
            resetActiveMentionQuery()
            setOpenSubmenuFor('Chats')
            setSubmenuActiveIndex(0)
            setSubmenuQueryStart(getCaretPos())
            void ensurePastChatsLoaded()
          } else if (openSubmenuFor === 'Chats') {
            const q = getSubmenuQuery().toLowerCase()
            const filtered = pastChats.filter((c) =>
              (c.title || 'Untitled Chat').toLowerCase().includes(q)
            )
            if (filtered.length > 0) {
              const chosen =
                filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
              insertPastChatMention(chosen)
              setSubmenuQueryStart(null)
            }
          } else if (!openSubmenuFor && selected === 'Workflows') {
            resetActiveMentionQuery()
            setOpenSubmenuFor('Workflows')
            setSubmenuActiveIndex(0)
            setSubmenuQueryStart(getCaretPos())
            void ensureWorkflowsLoaded()
          } else if (openSubmenuFor === 'Workflows') {
            const q = getSubmenuQuery().toLowerCase()
            const filtered = workflows.filter((w) =>
              (w.name || 'Untitled Workflow').toLowerCase().includes(q)
            )
            if (filtered.length > 0) {
              const chosen =
                filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
              insertWorkflowMention(chosen)
              setSubmenuQueryStart(null)
            }
          } else if (!openSubmenuFor && selected === 'Knowledge') {
            resetActiveMentionQuery()
            setOpenSubmenuFor('Knowledge')
            setSubmenuActiveIndex(0)
            setSubmenuQueryStart(getCaretPos())
            void ensureKnowledgeLoaded()
          } else if (openSubmenuFor === 'Knowledge') {
            const q = getSubmenuQuery().toLowerCase()
            const filtered = knowledgeBases.filter((k) =>
              (k.name || 'Untitled').toLowerCase().includes(q)
            )
            if (filtered.length > 0) {
              const chosen =
                filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
              insertKnowledgeMention(chosen)
              setSubmenuQueryStart(null)
            }
          } else if (!openSubmenuFor && selected === 'Blocks') {
            resetActiveMentionQuery()
            setOpenSubmenuFor('Blocks')
            setSubmenuActiveIndex(0)
            setSubmenuQueryStart(getCaretPos())
            void ensureBlocksLoaded()
          } else if (openSubmenuFor === 'Blocks') {
            const q = getSubmenuQuery().toLowerCase()
            const filtered = blocksList.filter((b) => (b.name || b.id).toLowerCase().includes(q))
            if (filtered.length > 0) {
              const chosen =
                filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
              insertBlockMention(chosen)
              setSubmenuQueryStart(null)
            }
          } else if (!openSubmenuFor && selected === 'Workflow Blocks') {
            resetActiveMentionQuery()
            setOpenSubmenuFor('Workflow Blocks')
            setSubmenuActiveIndex(0)
            setSubmenuQueryStart(getCaretPos())
            void ensureWorkflowBlocksLoaded()
          } else if (openSubmenuFor === 'Workflow Blocks') {
            const q = getSubmenuQuery().toLowerCase()
            const filtered = workflowBlocks.filter((b) =>
              (b.name || b.id).toLowerCase().includes(q)
            )
            if (filtered.length > 0) {
              const chosen =
                filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
              insertWorkflowBlockMention(chosen)
              setSubmenuQueryStart(null)
            }
          } else if (!openSubmenuFor && selected === 'Docs') {
            resetActiveMentionQuery()
            insertDocsMention()
          } else if (!openSubmenuFor && selected === 'Templates') {
            resetActiveMentionQuery()
            setOpenSubmenuFor('Templates')
            setSubmenuActiveIndex(0)
            setSubmenuQueryStart(getCaretPos())
            void ensureTemplatesLoaded()
          } else if (!openSubmenuFor && selected === 'Logs') {
            resetActiveMentionQuery()
            setOpenSubmenuFor('Logs')
            setSubmenuActiveIndex(0)
            setSubmenuQueryStart(getCaretPos())
            void ensureLogsLoaded()
          } else if (openSubmenuFor === 'Templates') {
            const q = getSubmenuQuery().toLowerCase()
            const filtered = templatesList.filter((t) =>
              (t.name || 'Untitled Template').toLowerCase().includes(q)
            )
            if (filtered.length > 0) {
              const chosen =
                filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
              insertTemplateMention(chosen)
              setSubmenuQueryStart(null)
            }
          } else if (openSubmenuFor === 'Logs' && logsList.length > 0) {
            const q = getSubmenuQuery().toLowerCase()
            const filtered = logsList.filter((l) =>
              [l.workflowName, l.trigger || ''].join(' ').toLowerCase().includes(q)
            )
            if (filtered.length > 0) {
              const chosen =
                filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
              insertLogMention(chosen)
              setSubmenuQueryStart(null)
            }
          } else if (isAggregate || inAggregated) {
            const q = mainQ
            const aggregated: Array<{ type: string; value: any }> = [
              ...workflowBlocks
                .filter((b) => (b.name || b.id).toLowerCase().includes(q))
                .map((b) => ({ type: 'Workflow Blocks', value: b })),
              ...workflows
                .filter((w) => (w.name || 'Untitled Workflow').toLowerCase().includes(q))
                .map((w) => ({ type: 'Workflows', value: w })),
              ...blocksList
                .filter((b) => (b.name || b.id).toLowerCase().includes(q))
                .map((b) => ({ type: 'Blocks', value: b })),
              ...knowledgeBases
                .filter((k) => (k.name || 'Untitled').toLowerCase().includes(q))
                .map((k) => ({ type: 'Knowledge', value: k })),
              ...templatesList
                .filter((t) => (t.name || 'Untitled Template').toLowerCase().includes(q))
                .map((t) => ({ type: 'Templates', value: t })),
              ...pastChats
                .filter((c) => (c.title || 'Untitled Chat').toLowerCase().includes(q))
                .map((c) => ({ type: 'Chats', value: c })),
              ...logsList
                .filter((l) => (l.workflowName || 'Untitled Workflow').toLowerCase().includes(q))
                .map((l) => ({ type: 'Logs', value: l })),
            ]
            const idx = Math.max(0, Math.min(submenuActiveIndex, aggregated.length - 1))
            const chosen = aggregated[idx]
            if (chosen) {
              if (chosen.type === 'Chats') insertPastChatMention(chosen.value)
              else if (chosen.type === 'Workflows') insertWorkflowMention(chosen.value)
              else if (chosen.type === 'Knowledge') insertKnowledgeMention(chosen.value)
              else if (chosen.type === 'Workflow Blocks') insertWorkflowBlockMention(chosen.value)
              else if (chosen.type === 'Blocks') insertBlockMention(chosen.value)
              else if (chosen.type === 'Templates') insertTemplateMention(chosen.value)
              else if (chosen.type === 'Logs') insertLogMention(chosen.value)
            }
          }
        }
      }
    }

    const getActiveMentionQueryAtPosition = (pos: number, textOverride?: string) => {
      const text = textOverride ?? message
      const before = text.slice(0, pos)
      const atIndex = before.lastIndexOf('@')
      if (atIndex === -1) return null
      // Ensure '@' starts a token (start or whitespace before)
      if (atIndex > 0 && !/\s/.test(before.charAt(atIndex - 1))) return null
      // If this '@' falls anywhere inside an existing mention token, ignore.
      // This also covers labels that themselves contain '@' characters.
      if (selectedContexts.length > 0) {
        const labels = selectedContexts.map((c) => c.label).filter(Boolean) as string[]
        for (const label of labels) {
          const token = `@${label}`
          let fromIndex = 0
          while (fromIndex <= text.length) {
            const idx = text.indexOf(token, fromIndex)
            if (idx === -1) break
            const end = idx + token.length
            if (atIndex >= idx && atIndex < end) {
              return null
            }
            fromIndex = end
          }
        }
      }
      const segment = before.slice(atIndex + 1)
      // Close the popup if user types space immediately after @ (just "@ " with nothing between)
      // This means they want to use @ as a regular character, not as a mention trigger
      if (segment.length > 0 && /^\s/.test(segment)) {
        return null
      }
      // Keep the popup open for valid queries
      return { query: segment, start: atIndex, end: pos }
    }

    const getSubmenuQuery = () => {
      const pos = getCaretPos()
      if (submenuQueryStart == null) return ''
      return message.slice(submenuQueryStart, pos)
    }

    const resetActiveMentionQuery = () => {
      const textarea = textareaRef.current
      if (!textarea) return
      const pos = textarea.selectionStart ?? message.length
      const active = getActiveMentionQueryAtPosition(pos)
      if (!active) return
      // Keep the '@' but clear everything typed after it
      const before = message.slice(0, active.start + 1)
      const after = message.slice(active.end)
      const next = `${before}${after}`
      if (controlledValue !== undefined) onControlledChange?.(next)
      else setInternalMessage(next)
      requestAnimationFrame(() => {
        const caretPos = before.length
        textarea.setSelectionRange(caretPos, caretPos)
        textarea.focus()
      })
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      if (controlledValue !== undefined) {
        onControlledChange?.(newValue)
      } else {
        setInternalMessage(newValue)
      }

      // Reset the "just sent" flag when user starts typing
      if (justSentMessage && newValue.length > 0) {
        setJustSentMessage(false)
      }

      const caret = e.target.selectionStart ?? newValue.length
      const active = getActiveMentionQueryAtPosition(caret, newValue)
      if (active) {
        setShowMentionMenu(true)
        setInAggregated(false)
        if (openSubmenuFor) {
          setSubmenuActiveIndex(0)
          requestAnimationFrame(() => scrollActiveItemIntoView(0))
        } else {
          setMentionActiveIndex(0)
          setSubmenuActiveIndex(0) // ensure aggregated lists also default to first
          requestAnimationFrame(() => scrollActiveItemIntoView(0))
        }
      } else {
        setShowMentionMenu(false)
        setOpenSubmenuFor(null)
        setSubmenuQueryStart(null)
      }
    }

    const handleSelectAdjust = () => {
      const textarea = textareaRef.current
      if (!textarea) return
      const pos = textarea.selectionStart ?? 0
      const r = findRangeContaining(pos)
      if (r) {
        // Snap caret to token boundary to avoid typing inside
        const snapPos = pos - r.start < r.end - pos ? r.start : r.end
        requestAnimationFrame(() => {
          textarea.setSelectionRange(snapPos, snapPos)
        })
      }
    }

    const insertAtCursor = (text: string) => {
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart ?? message.length
      const end = textarea.selectionEnd ?? message.length
      let before = message.slice(0, start)
      const after = message.slice(end)
      // Avoid duplicate '@' if user typed trigger
      if (before.endsWith('@') && text.startsWith('@')) {
        before = before.slice(0, -1)
      }
      const next = `${before}${text}${after}`
      if (controlledValue !== undefined) {
        onControlledChange?.(next)
      } else {
        setInternalMessage(next)
      }
      // Move cursor to after inserted text
      setTimeout(() => {
        const pos = before.length + text.length
        textarea.setSelectionRange(pos, pos)
        textarea.focus()
      }, 0)
    }

    const replaceActiveMentionWith = (label: string) => {
      const textarea = textareaRef.current
      if (!textarea) return false
      const pos = textarea.selectionStart ?? message.length
      const active = getActiveMentionQueryAtPosition(pos)
      if (!active) return false
      const before = message.slice(0, active.start)
      const after = message.slice(active.end)
      const insertion = `@${label} `
      const next = `${before}${insertion}${after}`.replace(/\s{2,}/g, ' ')
      if (controlledValue !== undefined) onControlledChange?.(next)
      else setInternalMessage(next)
      requestAnimationFrame(() => {
        const cursorPos = before.length + insertion.length
        textarea.setSelectionRange(cursorPos, cursorPos)
        textarea.focus()
      })
      return true
    }

    const insertPastChatMention = (chat: { id: string; title: string | null }) => {
      const label = chat.title || 'Untitled Chat'
      replaceActiveMentionWith(label)
      setSelectedContexts((prev) => {
        // Avoid duplicate contexts for same chat
        if (prev.some((c) => c.kind === 'past_chat' && (c as any).chatId === chat.id)) return prev
        return [...prev, { kind: 'past_chat', chatId: chat.id, label } as ChatContext]
      })
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    }

    const insertWorkflowMention = (wf: { id: string; name: string }) => {
      const label = wf.name || 'Untitled Workflow'
      const token = `@${label}`
      if (!replaceActiveMentionWith(label)) insertAtCursor(`${token} `)
      setSelectedContexts((prev) => {
        if (prev.some((c) => c.kind === 'workflow' && (c as any).workflowId === wf.id)) return prev
        return [...prev, { kind: 'workflow', workflowId: wf.id, label } as ChatContext]
      })
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    }

    const insertKnowledgeMention = (kb: { id: string; name: string }) => {
      const label = kb.name || 'Untitled'
      replaceActiveMentionWith(label)
      setSelectedContexts((prev) => {
        if (prev.some((c) => c.kind === 'knowledge' && (c as any).knowledgeId === kb.id))
          return prev
        return [...prev, { kind: 'knowledge', knowledgeId: kb.id, label } as any]
      })
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    }

    const insertBlockMention = (blk: { id: string; name: string }) => {
      const label = blk.name || blk.id
      replaceActiveMentionWith(label)
      setSelectedContexts((prev) => {
        if (prev.some((c) => c.kind === 'blocks' && (c as any).blockId === blk.id)) return prev
        return [...prev, { kind: 'blocks', blockId: blk.id, label } as any]
      })
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    }

    const insertTemplateMention = (tpl: { id: string; name: string }) => {
      const label = tpl.name || 'Untitled Template'
      replaceActiveMentionWith(label)
      setSelectedContexts((prev) => {
        if (prev.some((c) => c.kind === 'templates' && (c as any).templateId === tpl.id))
          return prev
        return [...prev, { kind: 'templates', templateId: tpl.id, label } as any]
      })
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    }

    const insertDocsMention = () => {
      const label = 'Docs'
      if (!replaceActiveMentionWith(label)) insertAtCursor(`@${label} `)
      setSelectedContexts((prev) => {
        if (prev.some((c) => c.kind === 'docs')) return prev
        return [...prev, { kind: 'docs', label } as any]
      })
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    }

    const handleFileSelect = () => {
      if (disabled || isLoading) {
        return
      }

      fileInputRef.current?.click()
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) {
        return
      }

      await processFiles(files)

      // Clear the input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    const removeFile = (fileId: string) => {
      // Clean up preview URL if it exists
      const file = attachedFiles.find((f) => f.id === fileId)
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl)
      }
      setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId))
    }

    const handleFileClick = (file: AttachedFile) => {
      // If file has been uploaded and has a storage key, open the file URL
      if (file.key) {
        const serveUrl = file.path
        window.open(serveUrl, '_blank')
      } else if (file.previewUrl) {
        // If file hasn't been uploaded yet but has a preview URL, open that
        window.open(file.previewUrl, '_blank')
      }
    }

    const formatFileSize = (bytes: number) => {
      if (bytes === 0) return '0 Bytes'
      const k = 1024
      const sizes = ['Bytes', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`
    }

    const isImageFile = (type: string) => {
      return type.startsWith('image/')
    }

    const getFileIcon = (mediaType: string) => {
      if (mediaType.startsWith('image/')) {
        return <Image className='h-5 w-5 text-muted-foreground' />
      }
      if (mediaType.includes('pdf')) {
        return <FileText className='h-5 w-5 text-red-500' />
      }
      if (mediaType.includes('text') || mediaType.includes('json') || mediaType.includes('xml')) {
        return <FileText className='h-5 w-5 text-blue-500' />
      }
      return <FileText className='h-5 w-5 text-muted-foreground' />
    }

    // Mention token utilities
    const computeMentionRanges = () => {
      const ranges: Array<{ start: number; end: number; label: string }> = []
      if (!message || selectedContexts.length === 0) return ranges
      // Build labels map for quick search
      const labels = selectedContexts.map((c) => c.label).filter(Boolean)
      if (labels.length === 0) return ranges
      // For each label, find all occurrences of @label (case-sensitive)
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
      // Sort by start
      ranges.sort((a, b) => a.start - b.start)
      return ranges
    }

    const findRangeContaining = (pos: number) => {
      const ranges = computeMentionRanges()
      // Consider strictly inside the token; allow typing at boundaries
      return ranges.find((r) => pos > r.start && pos < r.end)
    }

    const deleteRange = (range: { start: number; end: number; label: string }) => {
      const before = message.slice(0, range.start)
      const after = message.slice(range.end)
      const next = `${before}${after}`.replace(/\s{2,}/g, ' ')
      if (controlledValue !== undefined) {
        onControlledChange?.(next)
      } else {
        setInternalMessage(next)
      }
      // Remove corresponding context by label
      setSelectedContexts((prev) => prev.filter((c) => c.label !== range.label))
      // Place cursor at range.start
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (textarea) {
          textarea.setSelectionRange(range.start, range.start)
          textarea.focus()
        }
      })
    }

    // Keep selected contexts in sync with inline @label tokens so deleting inline tokens updates pills
    useEffect(() => {
      if (!message) {
        // When message is empty, preserve current_workflow if not disabled
        // Clear other contexts
        setSelectedContexts((prev) => {
          const currentWorkflowCtx = prev.find(
            (ctx) => ctx.kind === 'current_workflow' && !workflowAutoAddDisabled
          )
          return currentWorkflowCtx ? [currentWorkflowCtx] : []
        })
        return
      }
      const presentLabels = new Set<string>()
      const ranges = computeMentionRanges()
      for (const r of ranges) presentLabels.add(r.label)
      setSelectedContexts((prev) => {
        // Keep contexts that are mentioned in text OR are current_workflow (unless disabled)
        const filteredContexts = prev.filter((c) => {
          // Always preserve current_workflow context if it's not disabled
          // It should only be removable via the X button
          if (c.kind === 'current_workflow' && !workflowAutoAddDisabled) {
            return true
          }
          // For other contexts, check if they're mentioned in text
          return !!c.label && presentLabels.has(c.label!)
        })

        return filteredContexts
      })
    }, [message, workflowAutoAddDisabled])

    // Manage aggregate mode and preloading when needed
    useEffect(() => {
      if (!showMentionMenu || openSubmenuFor) {
        setAggregatedActive(false)
        setInAggregated(false)
        return
      }
      const q = (getActiveMentionQueryAtPosition(getCaretPos())?.query || '').trim().toLowerCase()
      const filteredMain = mentionOptions.filter((o) => o.toLowerCase().includes(q))
      const needAggregate = q.length > 0 && filteredMain.length === 0
      setAggregatedActive(needAggregate)
      // Prefetch all lists whenever there is any query so the Matches section has data
      if (q.length > 0) {
        void ensurePastChatsLoaded()
        void ensureWorkflowsLoaded()
        void ensureWorkflowBlocksLoaded()
        void ensureKnowledgeLoaded()
        void ensureBlocksLoaded()
        void ensureTemplatesLoaded()
        void ensureLogsLoaded()
      }
      if (needAggregate) {
        setSubmenuActiveIndex(0)
        requestAnimationFrame(() => scrollActiveItemIntoView(0))
      }
    }, [showMentionMenu, openSubmenuFor, message])

    // When switching into a submenu, select the first item and scroll to it
    useEffect(() => {
      if (openSubmenuFor) {
        setInAggregated(false)
        setSubmenuActiveIndex(0)
        requestAnimationFrame(() => scrollActiveItemIntoView(0))
      }
    }, [openSubmenuFor])

    const canSubmit = message.trim().length > 0 && !disabled && !isLoading
    const showAbortButton = isLoading && onAbort

    const handleModeToggle = () => {
      if (onModeChange) {
        // Toggle between Ask and Agent
        onModeChange(mode === 'ask' ? 'agent' : 'ask')
      }
    }

    const getModeIcon = () => {
      if (mode === 'ask') {
        return <MessageCircle className='h-3 w-3 text-muted-foreground' />
      }
      return <Package className='h-3 w-3 text-muted-foreground' />
    }

    const getModeText = () => {
      if (mode === 'ask') {
        return 'Ask'
      }
      return 'Agent'
    }

    // Depth toggle state comes from global store; access via useCopilotStore
    const { agentDepth, agentPrefetch, setAgentDepth, setAgentPrefetch } = useCopilotStore()

    // Ensure MAX mode is off for Fast and Balanced depths
    useEffect(() => {
      if (agentDepth < 2 && !agentPrefetch) {
        setAgentPrefetch(true)
      }
    }, [agentDepth, agentPrefetch, setAgentPrefetch])

    const cycleDepth = () => {
      // 8 modes: depths 0-3, each with prefetch off/on. Cycle depth, then toggle prefetch when wrapping.
      const nextDepth = agentDepth === 3 ? 0 : ((agentDepth + 1) as 0 | 1 | 2 | 3)
      if (nextDepth === 0 && agentDepth === 3) {
        setAgentPrefetch(!agentPrefetch)
      }
      setAgentDepth(nextDepth)
    }

    const getCollapsedModeLabel = () => {
      const base = getDepthLabelFor(agentDepth)
      return !agentPrefetch ? `${base} MAX` : base
    }

    const getDepthLabelFor = (value: 0 | 1 | 2 | 3) => {
      return value === 0 ? 'Fast' : value === 1 ? 'Balanced' : value === 2 ? 'Advanced' : 'Behemoth'
    }

    // Removed descriptive suffixes; concise labels only
    const getDepthDescription = (value: 0 | 1 | 2 | 3) => {
      if (value === 0)
        return 'Fastest and cheapest. Good for small edits, simple workflows, and small tasks'
      if (value === 1) return 'Balances speed and reasoning. Good fit for most tasks'
      if (value === 2)
        return 'More reasoning for larger workflows and complex edits, still balanced for speed'
      return 'Maximum reasoning power. Best for complex workflow building and debugging'
    }

    const getDepthIconFor = (value: 0 | 1 | 2 | 3) => {
      const colorClass = !agentPrefetch
        ? 'text-[var(--brand-primary-hover-hex)]'
        : 'text-muted-foreground'
      if (value === 0) return <Zap className={`h-3 w-3 ${colorClass}`} />
      if (value === 1) return <InfinityIcon className={`h-3 w-3 ${colorClass}`} />
      if (value === 2) return <Brain className={`h-3 w-3 ${colorClass}`} />
      return <BrainCircuit className={`h-3 w-3 ${colorClass}`} />
    }

    const getDepthIcon = () => getDepthIconFor(agentDepth)

    const scrollActiveItemIntoView = (index: number) => {
      const container = menuListRef.current
      if (!container) return
      const item = container.querySelector(`[data-idx="${index}"]`) as HTMLElement | null
      if (!item) return
      const tolerance = 8
      const itemTop = item.offsetTop
      const itemBottom = itemTop + item.offsetHeight
      const viewTop = container.scrollTop
      const viewBottom = viewTop + container.clientHeight
      const needsScrollUp = itemTop < viewTop + tolerance
      const needsScrollDown = itemBottom > viewBottom - tolerance
      if (needsScrollUp || needsScrollDown) {
        if (needsScrollUp) {
          container.scrollTop = Math.max(0, itemTop - tolerance)
        } else {
          container.scrollTop = itemBottom + tolerance - container.clientHeight
        }
      }
    }

    const handleOpenMentionMenuWithAt = () => {
      if (disabled || isLoading) return
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      const pos = textarea.selectionStart ?? message.length
      const needsSpaceBefore = pos > 0 && !/\s/.test(message.charAt(pos - 1))
      insertAtCursor(needsSpaceBefore ? ' @' : '@')
      // Open the menu at top level
      setShowMentionMenu(true)
      setOpenSubmenuFor(null)
      setMentionActiveIndex(0)
      setSubmenuActiveIndex(0)
      requestAnimationFrame(() => scrollActiveItemIntoView(0))
    }

    // Load recent logs (executions)
    const ensureLogsLoaded = async () => {
      if (isLoadingLogs || logsList.length > 0) return
      try {
        setIsLoadingLogs(true)
        const resp = await fetch(`/api/logs?workspaceId=${workspaceId}&limit=50&details=full`)
        if (!resp.ok) throw new Error(`Failed to load logs: ${resp.status}`)
        const data = await resp.json()
        const items = Array.isArray(data?.data) ? data.data : []
        const mapped = items.map((l: any) => ({
          id: l.id,
          executionId: l.executionId || l.id,
          level: l.level,
          trigger: l.trigger || null,
          createdAt: l.createdAt,
          workflowName:
            (l.workflow && (l.workflow.name || l.workflow.title)) ||
            l.workflowName ||
            'Untitled Workflow',
        }))
        setLogsList(mapped)
      } catch {
      } finally {
        setIsLoadingLogs(false)
      }
    }

    // Insert a logs mention
    const insertLogMention = (log: {
      id: string
      executionId?: string
      level: string
      trigger: string | null
      createdAt: string
      workflowName: string
    }) => {
      const label = log.workflowName
      replaceActiveMentionWith(label)
      setSelectedContexts((prev) => {
        if (prev.some((c) => c.kind === 'logs' && c.label === label)) return prev
        return [...prev, { kind: 'logs', executionId: log.executionId, label }]
      })
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    }

    // Helper to format timestamps
    const formatTimestamp = (iso: string) => {
      try {
        const d = new Date(iso)
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const dd = String(d.getDate()).padStart(2, '0')
        const hh = String(d.getHours()).padStart(2, '0')
        const min = String(d.getMinutes()).padStart(2, '0')
        return `${mm}-${dd} ${hh}:${min}`
      } catch {
        return iso
      }
    }

    // Get workflow blocks from the workflow store
    const workflowStoreBlocks = useWorkflowStore((state) => state.blocks)

    // Transform workflow store blocks into the format needed for the mention menu
    const [workflowBlocks, setWorkflowBlocks] = useState<
      Array<{ id: string; name: string; type: string; iconComponent?: any; bgColor?: string }>
    >([])
    const [isLoadingWorkflowBlocks, setIsLoadingWorkflowBlocks] = useState(false)

    // Sync workflow blocks from store whenever they change
    useEffect(() => {
      const syncWorkflowBlocks = async () => {
        if (!workflowId || !workflowStoreBlocks || Object.keys(workflowStoreBlocks).length === 0) {
          setWorkflowBlocks([])
          logger.debug('No workflow blocks to sync', {
            workflowId,
            hasBlocks: !!workflowStoreBlocks,
            blockCount: Object.keys(workflowStoreBlocks || {}).length,
          })
          return
        }

        try {
          // Map to display with block registry icons/colors
          const { registry: blockRegistry } = await import('@/blocks/registry')
          const mapped = Object.values(workflowStoreBlocks).map((b: any) => {
            const reg = (blockRegistry as any)[b.type]
            return {
              id: b.id,
              name: b.name || b.id,
              type: b.type,
              iconComponent: reg?.icon,
              bgColor: reg?.bgColor || '#6B7280',
            }
          })
          setWorkflowBlocks(mapped)
          logger.debug('Synced workflow blocks for mention menu', {
            count: mapped.length,
            blocks: mapped.map((b) => b.name),
          })
        } catch (error) {
          logger.debug('Failed to sync workflow blocks:', error)
        }
      }

      syncWorkflowBlocks()
    }, [workflowStoreBlocks, workflowId])

    const ensureWorkflowBlocksLoaded = async () => {
      // Since blocks are now synced from store via useEffect, this can be a no-op
      // or just ensure the blocks are loaded in the store
      if (!workflowId) return

      // Debug: Log current state
      logger.debug('ensureWorkflowBlocksLoaded called', {
        workflowId,
        storeBlocksCount: Object.keys(workflowStoreBlocks || {}).length,
        workflowBlocksCount: workflowBlocks.length,
      })

      // Blocks will be automatically synced from the store
    }

    const insertWorkflowBlockMention = (blk: { id: string; name: string }) => {
      const label = `${blk.name}`
      const token = `@${label}`
      if (!replaceActiveMentionWith(label)) insertAtCursor(`${token} `)
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
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    }

    return (
      <div className={cn('relative flex-none pb-4', className)}>
        <div
          className={cn(
            'rounded-[8px] border border-[#E5E5E5] bg-[#FFFFFF] p-2 shadow-xs transition-all duration-200 dark:border-[#414141] dark:bg-[var(--surface-elevated)]',
            isDragging &&
              'border-[var(--brand-primary-hover-hex)] bg-purple-50/50 dark:border-[var(--brand-primary-hover-hex)] dark:bg-purple-950/20'
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Attached Files Display with Thumbnails */}
          {attachedFiles.length > 0 && (
            <div className='mb-2 flex flex-wrap gap-1.5'>
              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className='group relative h-16 w-16 cursor-pointer overflow-hidden rounded-md border border-border/50 bg-muted/20 transition-all hover:bg-muted/40'
                  title={`${file.name} (${formatFileSize(file.size)})`}
                  onClick={() => handleFileClick(file)}
                >
                  {isImageFile(file.type) && file.previewUrl ? (
                    // For images, show actual thumbnail
                    <img
                      src={file.previewUrl}
                      alt={file.name}
                      className='h-full w-full object-cover'
                    />
                  ) : isImageFile(file.type) && file.key ? (
                    // For uploaded images without preview URL, use storage URL
                    <img
                      src={file.previewUrl || file.path}
                      alt={file.name}
                      className='h-full w-full object-cover'
                    />
                  ) : (
                    // For other files, show icon centered
                    <div className='flex h-full w-full items-center justify-center bg-background/50'>
                      {getFileIcon(file.type)}
                    </div>
                  )}

                  {/* Loading overlay */}
                  {file.uploading && (
                    <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                      <Loader2 className='h-4 w-4 animate-spin text-white' />
                    </div>
                  )}

                  {/* Remove button */}
                  {!file.uploading && (
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile(file.id)
                      }}
                      className='absolute top-0.5 right-0.5 h-5 w-5 bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100'
                    >
                      <X className='h-3 w-3' />
                    </Button>
                  )}

                  {/* Hover overlay effect */}
                  <div className='pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100' />
                </div>
              ))}
            </div>
          )}

          {/* Selected Context Pills */}
          {selectedContexts.filter((c) => c.kind !== 'current_workflow').length > 0 && (
            <div className='mb-2 flex flex-wrap gap-1.5'>
              {selectedContexts
                .filter((c) => c.kind !== 'current_workflow')
                .map((ctx, idx) => (
                  <span
                    key={`selctx-${idx}-${ctx.label}`}
                    className='inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_14%,transparent)] px-1.5 py-0.5 text-[11px] text-foreground'
                    title={ctx.label}
                  >
                    {ctx.kind === 'past_chat' ? (
                      <Bot className='h-3 w-3 text-muted-foreground' />
                    ) : ctx.kind === 'workflow' ? (
                      <Workflow className='h-3 w-3 text-muted-foreground' />
                    ) : ctx.kind === 'blocks' ? (
                      <Blocks className='h-3 w-3 text-muted-foreground' />
                    ) : ctx.kind === 'workflow_block' ? (
                      <Box className='h-3 w-3 text-muted-foreground' />
                    ) : ctx.kind === 'knowledge' ? (
                      <LibraryBig className='h-3 w-3 text-muted-foreground' />
                    ) : ctx.kind === 'templates' ? (
                      <Shapes className='h-3 w-3 text-muted-foreground' />
                    ) : ctx.kind === 'docs' ? (
                      <BookOpen className='h-3 w-3 text-muted-foreground' />
                    ) : ctx.kind === 'logs' ? (
                      <SquareChevronRight className='h-3 w-3 text-muted-foreground' />
                    ) : (
                      <Info className='h-3 w-3 text-muted-foreground' />
                    )}
                    <span className='max-w-[140px] truncate'>{ctx.label}</span>
                    <button
                      type='button'
                      onClick={() => {
                        // Remove only non-hidden contexts; current_workflow is never shown
                        setSelectedContexts((prev) => prev.filter((c) => c.label !== ctx.label))
                      }}
                      className='text-muted-foreground transition-colors hover:text-foreground'
                      title='Remove context'
                      aria-label='Remove context'
                    >
                      <X className='h-3 w-3' />
                    </button>
                  </span>
                ))}
            </div>
          )}

          {/* Textarea Field with overlay */}
          <div className='relative'>
            {/* Highlight overlay */}
            <div className='pointer-events-none absolute inset-0 z-[1] px-[2px] py-1'>
              <pre className='whitespace-pre-wrap font-sans text-foreground text-sm leading-[1.25rem]'>
                {(() => {
                  const elements: React.ReactNode[] = []
                  const remaining = message
                  const contexts = selectedContexts
                  if (contexts.length === 0 || !remaining) return remaining
                  // Build regex for all labels
                  const labels = contexts.map((c) => c.label).filter(Boolean)
                  const pattern = new RegExp(
                    `@(${labels.map((l) => l.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('|')})`,
                    'g'
                  )
                  let lastIndex = 0
                  let match: RegExpExecArray | null
                  while ((match = pattern.exec(remaining)) !== null) {
                    const i = match.index
                    const before = remaining.slice(lastIndex, i)
                    if (before) elements.push(before)
                    const mentionText = match[0]
                    const mentionLabel = match[1]
                    elements.push(
                      <span
                        key={`${mentionText}-${i}-${lastIndex}`}
                        className='rounded-[6px] bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_14%,transparent)]'
                      >
                        {mentionText}
                      </span>
                    )
                    lastIndex = i + mentionText.length
                  }
                  const tail = remaining.slice(lastIndex)
                  if (tail) elements.push(tail)
                  return elements
                })()}
              </pre>
            </div>
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onSelect={handleSelectAdjust}
              onMouseUp={handleSelectAdjust}
              placeholder={isDragging ? 'Drop files here...' : effectivePlaceholder}
              disabled={disabled}
              rows={1}
              className='relative z-[2] mb-2 min-h-[32px] w-full resize-none overflow-y-auto overflow-x-hidden border-0 bg-transparent px-[2px] py-1 font-sans text-sm text-transparent leading-[1.25rem] caret-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
              style={{ height: 'auto' }}
            />

            {showMentionMenu && (
              <>
                <div
                  ref={mentionMenuRef}
                  className={cn(
                    'absolute bottom-full left-0 z-50 mb-1 flex max-h-64 flex-col overflow-hidden rounded-[8px] border bg-popover p-1 text-foreground shadow-md',
                    openSubmenuFor === 'Blocks'
                      ? 'w-80'
                      : openSubmenuFor === 'Templates' ||
                          openSubmenuFor === 'Logs' ||
                          aggregatedActive
                        ? 'w-96'
                        : 'w-56'
                  )}
                >
                  {openSubmenuFor ? (
                    <>
                      <div className='px-2 py-1.5 text-muted-foreground text-xs'>
                        {openSubmenuFor === 'Chats'
                          ? 'Chats'
                          : openSubmenuFor === 'Workflows'
                            ? 'All workflows'
                            : openSubmenuFor === 'Knowledge'
                              ? 'Knowledge Bases'
                              : openSubmenuFor === 'Blocks'
                                ? 'Blocks'
                                : openSubmenuFor === 'Workflow Blocks'
                                  ? 'Workflow Blocks'
                                  : openSubmenuFor === 'Templates'
                                    ? 'Templates'
                                    : 'Logs'}
                      </div>
                      <div ref={menuListRef} className='flex-1 overflow-auto overscroll-contain'>
                        {isSubmenu('Chats') && (
                          <>
                            {isLoadingPastChats ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                Loading...
                              </div>
                            ) : pastChats.length === 0 ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                No past chats
                              </div>
                            ) : (
                              pastChats
                                .filter((c) =>
                                  (c.title || 'Untitled Chat')
                                    .toLowerCase()
                                    .includes(getSubmenuQuery().toLowerCase())
                                )
                                .map((chat, idx) => (
                                  <div
                                    key={chat.id}
                                    data-idx={idx}
                                    className={cn(
                                      'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                      submenuActiveIndex === idx && 'bg-muted'
                                    )}
                                    role='menuitem'
                                    aria-selected={submenuActiveIndex === idx}
                                    onMouseEnter={() => setSubmenuActiveIndex(idx)}
                                    onClick={() => {
                                      insertPastChatMention(chat)
                                      setSubmenuQueryStart(null)
                                    }}
                                  >
                                    <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                                      <Bot
                                        className='h-3.5 w-3.5 text-muted-foreground'
                                        strokeWidth={1.5}
                                      />
                                    </div>
                                    <span className='truncate'>
                                      {chat.title || 'Untitled Chat'}
                                    </span>
                                  </div>
                                ))
                            )}
                          </>
                        )}
                        {isSubmenu('Workflows') && (
                          <>
                            {isLoadingWorkflows ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                Loading...
                              </div>
                            ) : workflows.length === 0 ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                No workflows
                              </div>
                            ) : (
                              workflows
                                .filter((w) =>
                                  (w.name || 'Untitled Workflow')
                                    .toLowerCase()
                                    .includes(getSubmenuQuery().toLowerCase())
                                )
                                .map((wf, idx) => (
                                  <div
                                    key={wf.id}
                                    data-idx={idx}
                                    className={cn(
                                      'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                      submenuActiveIndex === idx && 'bg-muted'
                                    )}
                                    role='menuitem'
                                    aria-selected={submenuActiveIndex === idx}
                                    onMouseEnter={() => setSubmenuActiveIndex(idx)}
                                    onClick={() => {
                                      insertWorkflowMention(wf)
                                      setSubmenuQueryStart(null)
                                    }}
                                  >
                                    <div
                                      className='h-3.5 w-3.5 flex-shrink-0 rounded'
                                      style={{ backgroundColor: wf.color || '#3972F6' }}
                                    />
                                    <span className='truncate'>
                                      {wf.name || 'Untitled Workflow'}
                                    </span>
                                  </div>
                                ))
                            )}
                          </>
                        )}
                        {isSubmenu('Knowledge') && (
                          <>
                            {isLoadingKnowledge ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                Loading...
                              </div>
                            ) : knowledgeBases.length === 0 ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                No knowledge bases
                              </div>
                            ) : (
                              knowledgeBases
                                .filter((k) =>
                                  (k.name || 'Untitled')
                                    .toLowerCase()
                                    .includes(getSubmenuQuery().toLowerCase())
                                )
                                .map((kb, idx) => (
                                  <div
                                    key={kb.id}
                                    data-idx={idx}
                                    className={cn(
                                      'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                      submenuActiveIndex === idx && 'bg-muted'
                                    )}
                                    role='menuitem'
                                    aria-selected={submenuActiveIndex === idx}
                                    onMouseEnter={() => setSubmenuActiveIndex(idx)}
                                    onClick={() => {
                                      insertKnowledgeMention(kb)
                                      setSubmenuQueryStart(null)
                                    }}
                                  >
                                    <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
                                    <span className='truncate'>{kb.name || 'Untitled'}</span>
                                  </div>
                                ))
                            )}
                          </>
                        )}
                        {isSubmenu('Blocks') && (
                          <>
                            {isLoadingBlocks ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                Loading...
                              </div>
                            ) : blocksList.length === 0 ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                No blocks found
                              </div>
                            ) : (
                              blocksList
                                .filter((b) =>
                                  (b.name || b.id)
                                    .toLowerCase()
                                    .includes(getSubmenuQuery().toLowerCase())
                                )
                                .map((blk, idx) => (
                                  <div
                                    key={blk.id}
                                    data-idx={idx}
                                    className={cn(
                                      'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                      submenuActiveIndex === idx && 'bg-muted'
                                    )}
                                    role='menuitem'
                                    aria-selected={submenuActiveIndex === idx}
                                    onMouseEnter={() => setSubmenuActiveIndex(idx)}
                                    onClick={() => {
                                      insertBlockMention(blk)
                                      setSubmenuQueryStart(null)
                                    }}
                                  >
                                    <div
                                      className='relative flex h-4 w-4 items-center justify-center rounded-[3px]'
                                      style={{ backgroundColor: blk.bgColor || '#6B7280' }}
                                    >
                                      {blk.iconComponent && (
                                        <blk.iconComponent className='!h-3 !w-3 text-white' />
                                      )}
                                    </div>
                                    <span className='truncate'>{blk.name || blk.id}</span>
                                  </div>
                                ))
                            )}
                          </>
                        )}
                        {isSubmenu('Workflow Blocks') && (
                          <>
                            {isLoadingWorkflowBlocks ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                Loading...
                              </div>
                            ) : workflowBlocks.length === 0 ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                No blocks in this workflow
                              </div>
                            ) : (
                              workflowBlocks
                                .filter((b) =>
                                  (b.name || b.id)
                                    .toLowerCase()
                                    .includes(getSubmenuQuery().toLowerCase())
                                )
                                .map((blk, idx) => (
                                  <div
                                    key={blk.id}
                                    data-idx={idx}
                                    className={cn(
                                      'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                      submenuActiveIndex === idx && 'bg-muted'
                                    )}
                                    role='menuitem'
                                    aria-selected={submenuActiveIndex === idx}
                                    onMouseEnter={() => setSubmenuActiveIndex(idx)}
                                    onClick={() => {
                                      insertWorkflowBlockMention(blk)
                                      setSubmenuQueryStart(null)
                                    }}
                                  >
                                    <div
                                      className='relative flex h-4 w-4 items-center justify-center rounded-[3px]'
                                      style={{ backgroundColor: blk.bgColor || '#6B7280' }}
                                    >
                                      {blk.iconComponent && (
                                        <blk.iconComponent className='!h-3 !w-3 text-white' />
                                      )}
                                    </div>
                                    <span className='truncate'>{blk.name || blk.id}</span>
                                  </div>
                                ))
                            )}
                          </>
                        )}
                        {isSubmenu('Templates') && (
                          <>
                            {isLoadingTemplates ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                Loading...
                              </div>
                            ) : templatesList.length === 0 ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                No templates found
                              </div>
                            ) : (
                              templatesList
                                .filter((t) =>
                                  (t.name || 'Untitled Template')
                                    .toLowerCase()
                                    .includes(getSubmenuQuery().toLowerCase())
                                )
                                .map((tpl, idx) => (
                                  <div
                                    key={tpl.id}
                                    data-idx={idx}
                                    className={cn(
                                      'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                      submenuActiveIndex === idx && 'bg-muted'
                                    )}
                                    role='menuitem'
                                    aria-selected={submenuActiveIndex === idx}
                                    onMouseEnter={() => setSubmenuActiveIndex(idx)}
                                    onClick={() => {
                                      insertTemplateMention(tpl)
                                      setSubmenuQueryStart(null)
                                    }}
                                  >
                                    <div className='flex h-4 w-4 items-center justify-center'>
                                      ★
                                    </div>
                                    <span className='truncate'>{tpl.name}</span>
                                    <span className='ml-auto text-muted-foreground text-xs'>
                                      {tpl.stars}
                                    </span>
                                  </div>
                                ))
                            )}
                          </>
                        )}
                        {isSubmenu('Logs') && (
                          <>
                            {isLoadingLogs ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                Loading...
                              </div>
                            ) : logsList.length === 0 ? (
                              <div className='px-2 py-2 text-muted-foreground text-sm'>
                                No executions found
                              </div>
                            ) : (
                              logsList
                                .filter((l) =>
                                  [l.workflowName, l.trigger || '']
                                    .join(' ')
                                    .toLowerCase()
                                    .includes(getSubmenuQuery().toLowerCase())
                                )
                                .map((log, idx) => (
                                  <div
                                    key={log.id}
                                    data-idx={idx}
                                    className={cn(
                                      'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                      submenuActiveIndex === idx && 'bg-muted'
                                    )}
                                    role='menuitem'
                                    aria-selected={submenuActiveIndex === idx}
                                    onMouseEnter={() => setSubmenuActiveIndex(idx)}
                                    onClick={() => {
                                      insertLogMention(log)
                                      setSubmenuQueryStart(null)
                                    }}
                                  >
                                    {log.level === 'error' ? (
                                      <X className='h-4 w-4 text-red-500' />
                                    ) : (
                                      <Check className='h-4 w-4 text-green-500' />
                                    )}
                                    <span className='min-w-0 truncate'>{log.workflowName}</span>
                                    <span className='text-muted-foreground'>·</span>
                                    <span className='whitespace-nowrap'>
                                      {formatTimestamp(log.createdAt)}
                                    </span>
                                    <span className='text-muted-foreground'>·</span>
                                    <span className='capitalize'>
                                      {(log.trigger || 'manual').toLowerCase()}
                                    </span>
                                  </div>
                                ))
                            )}
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      {(() => {
                        const q = (
                          getActiveMentionQueryAtPosition(getCaretPos())?.query || ''
                        ).toLowerCase()
                        const filtered = mentionOptions.filter((label) =>
                          label.toLowerCase().includes(q)
                        )
                        if (q.length > 0 && filtered.length === 0) {
                          // Aggregated search view
                          const aggregated = [
                            ...workflowBlocks
                              .filter((b) => (b.name || b.id).toLowerCase().includes(q))
                              .map((b) => ({
                                type: 'Workflow Blocks' as const,
                                id: b.id,
                                value: b,
                                onClick: () => insertWorkflowBlockMention(b),
                              })),
                            ...workflows
                              .filter((w) =>
                                (w.name || 'Untitled Workflow').toLowerCase().includes(q)
                              )
                              .map((w) => ({
                                type: 'Workflows' as const,
                                id: w.id,
                                value: w,
                                onClick: () => insertWorkflowMention(w),
                              })),
                            ...blocksList
                              .filter((b) => (b.name || b.id).toLowerCase().includes(q))
                              .map((b) => ({
                                type: 'Blocks' as const,
                                id: b.id,
                                value: b,
                                onClick: () => insertBlockMention(b),
                              })),
                            ...knowledgeBases
                              .filter((k) => (k.name || 'Untitled').toLowerCase().includes(q))
                              .map((k) => ({
                                type: 'Knowledge' as const,
                                id: k.id,
                                value: k,
                                onClick: () => insertKnowledgeMention(k),
                              })),
                            ...templatesList
                              .filter((t) =>
                                (t.name || 'Untitled Template').toLowerCase().includes(q)
                              )
                              .map((t) => ({
                                type: 'Templates' as const,
                                id: t.id,
                                value: t,
                                onClick: () => insertTemplateMention(t),
                              })),
                            ...pastChats
                              .filter((c) => (c.title || 'Untitled Chat').toLowerCase().includes(q))
                              .map((c) => ({
                                type: 'Chats' as const,
                                id: c.id,
                                value: c,
                                onClick: () => insertPastChatMention(c),
                              })),
                            ...logsList
                              .filter((l) =>
                                (l.workflowName || 'Untitled Workflow').toLowerCase().includes(q)
                              )
                              .map((l) => ({
                                type: 'Logs' as const,
                                id: l.id,
                                value: l,
                                onClick: () => insertLogMention(l),
                              })),
                          ]
                          return (
                            <div
                              ref={menuListRef}
                              className='flex-1 overflow-auto overscroll-contain'
                            >
                              {aggregated.length === 0 ? (
                                <div className='px-2 py-2 text-muted-foreground text-sm'>
                                  No matches
                                </div>
                              ) : (
                                aggregated.map((item, idx) => (
                                  <div
                                    key={`${item.type}-${item.id}`}
                                    data-idx={idx}
                                    className={cn(
                                      'flex cursor-default items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                      submenuActiveIndex === idx && 'bg-muted'
                                    )}
                                    role='menuitem'
                                    aria-selected={submenuActiveIndex === idx}
                                    onMouseEnter={() => setSubmenuActiveIndex(idx)}
                                    onClick={() => item.onClick()}
                                  >
                                    {item.type === 'Chats' ? (
                                      <>
                                        <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                                          <Bot
                                            className='h-3.5 w-3.5 text-muted-foreground'
                                            strokeWidth={1.5}
                                          />
                                        </div>
                                        <span className='truncate'>
                                          {(item.value as any).title || 'Untitled Chat'}
                                        </span>
                                      </>
                                    ) : item.type === 'Workflows' ? (
                                      <>
                                        <div
                                          className='h-3.5 w-3.5 flex-shrink-0 rounded'
                                          style={{
                                            backgroundColor: (item.value as any).color || '#3972F6',
                                          }}
                                        />
                                        <span className='truncate'>
                                          {(item.value as any).name || 'Untitled Workflow'}
                                        </span>
                                      </>
                                    ) : item.type === 'Knowledge' ? (
                                      <>
                                        <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
                                        <span className='truncate'>
                                          {(item.value as any).name || 'Untitled'}
                                        </span>
                                      </>
                                    ) : item.type === 'Blocks' ? (
                                      <>
                                        <div
                                          className='relative flex h-4 w-4 items-center justify-center rounded-[3px]'
                                          style={{
                                            backgroundColor:
                                              (item.value as any).bgColor || '#6B7280',
                                          }}
                                        >
                                          {(() => {
                                            const Icon = (item.value as any).iconComponent
                                            return Icon ? (
                                              <Icon className='!h-3 !w-3 text-white' />
                                            ) : null
                                          })()}
                                        </div>
                                        <span className='truncate'>
                                          {(item.value as any).name || (item.value as any).id}
                                        </span>
                                      </>
                                    ) : item.type === 'Workflow Blocks' ? (
                                      <>
                                        <div
                                          className='relative flex h-4 w-4 items-center justify-center rounded-[3px]'
                                          style={{
                                            backgroundColor:
                                              (item.value as any).bgColor || '#6B7280',
                                          }}
                                        >
                                          {(() => {
                                            const Icon = (item.value as any).iconComponent
                                            return Icon ? (
                                              <Icon className='!h-3 !w-3 text-white' />
                                            ) : null
                                          })()}
                                        </div>
                                        <span className='truncate'>
                                          {(item.value as any).name || (item.value as any).id}
                                        </span>
                                      </>
                                    ) : item.type === 'Logs' ? (
                                      <>
                                        {(() => {
                                          const v = item.value as any
                                          return v.level === 'error' ? (
                                            <X className='h-3.5 w-3.5 text-red-500' />
                                          ) : (
                                            <Check className='h-3.5 w-3.5 text-green-500' />
                                          )
                                        })()}
                                        <span className='min-w-0 truncate'>
                                          {(item.value as any).workflowName}
                                        </span>
                                        <span className='text-muted-foreground'>·</span>
                                        <span className='whitespace-nowrap'>
                                          {formatTimestamp((item.value as any).createdAt)}
                                        </span>
                                        <span className='text-muted-foreground'>·</span>
                                        <span className='capitalize'>
                                          {(
                                            ((item.value as any).trigger as string) || 'manual'
                                          ).toLowerCase()}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <div className='flex h-4 w-4 items-center justify-center'>
                                          ★
                                        </div>
                                        <span className='truncate'>
                                          {(item.value as any).name || 'Untitled Template'}
                                        </span>
                                        {typeof (item.value as any).stars === 'number' && (
                                          <span className='ml-auto text-muted-foreground text-xs'>
                                            {(item.value as any).stars}
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )
                        }
                        // Filtered top-level options view
                        return (
                          <div
                            ref={menuListRef}
                            className='flex-1 overflow-auto overscroll-contain'
                          >
                            {filtered.map((label, idx) => (
                              <div
                                key={label}
                                data-idx={idx}
                                className={cn(
                                  'flex cursor-default items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                  !inAggregated && mentionActiveIndex === idx && 'bg-muted'
                                )}
                                role='menuitem'
                                aria-selected={!inAggregated && mentionActiveIndex === idx}
                                onMouseEnter={() => {
                                  setInAggregated(false)
                                  setMentionActiveIndex(idx)
                                }}
                                onClick={() => {
                                  if (label === 'Chats') {
                                    resetActiveMentionQuery()
                                    setOpenSubmenuFor('Chats')
                                    setSubmenuActiveIndex(0)
                                    setSubmenuQueryStart(getCaretPos())
                                    void ensurePastChatsLoaded()
                                  } else if (label === 'Workflows') {
                                    resetActiveMentionQuery()
                                    setOpenSubmenuFor('Workflows')
                                    setSubmenuActiveIndex(0)
                                    setSubmenuQueryStart(getCaretPos())
                                    void ensureWorkflowsLoaded()
                                  } else if (label === 'Knowledge') {
                                    resetActiveMentionQuery()
                                    setOpenSubmenuFor('Knowledge')
                                    setSubmenuActiveIndex(0)
                                    setSubmenuQueryStart(getCaretPos())
                                    void ensureKnowledgeLoaded()
                                  } else if (label === 'Blocks') {
                                    resetActiveMentionQuery()
                                    setOpenSubmenuFor('Blocks')
                                    setSubmenuActiveIndex(0)
                                    setSubmenuQueryStart(getCaretPos())
                                    void ensureBlocksLoaded()
                                  } else if (label === 'Workflow Blocks') {
                                    resetActiveMentionQuery()
                                    setOpenSubmenuFor('Workflow Blocks')
                                    setSubmenuActiveIndex(0)
                                    setSubmenuQueryStart(getCaretPos())
                                    void ensureWorkflowBlocksLoaded()
                                  } else if (label === 'Docs') {
                                    // No submenu; insert immediately
                                    insertDocsMention()
                                  } else if (label === 'Templates') {
                                    resetActiveMentionQuery()
                                    setOpenSubmenuFor('Templates')
                                    setSubmenuActiveIndex(0)
                                    setSubmenuQueryStart(getCaretPos())
                                    void ensureTemplatesLoaded()
                                  } else if (label === 'Logs') {
                                    resetActiveMentionQuery()
                                    setOpenSubmenuFor('Logs')
                                    setSubmenuActiveIndex(0)
                                    setSubmenuQueryStart(getCaretPos())
                                    void ensureLogsLoaded()
                                  }
                                }}
                              >
                                <div className='flex items-center gap-2'>
                                  {label === 'Chats' ? (
                                    <Bot className='h-3.5 w-3.5 text-muted-foreground' />
                                  ) : label === 'Workflows' ? (
                                    <Workflow className='h-3.5 w-3.5 text-muted-foreground' />
                                  ) : label === 'Blocks' ? (
                                    <Blocks className='h-3.5 w-3.5 text-muted-foreground' />
                                  ) : label === 'Workflow Blocks' ? (
                                    <Box className='h-3.5 w-3.5 text-muted-foreground' />
                                  ) : label === 'Knowledge' ? (
                                    <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
                                  ) : label === 'Docs' ? (
                                    <BookOpen className='h-3.5 w-3.5 text-muted-foreground' />
                                  ) : label === 'Templates' ? (
                                    <Shapes className='h-3.5 w-3.5 text-muted-foreground' />
                                  ) : label === 'Logs' ? (
                                    <SquareChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
                                  ) : (
                                    <div className='h-3.5 w-3.5' />
                                  )}
                                  <span>{label === 'Workflows' ? 'All workflows' : label}</span>
                                </div>
                                {label !== 'Docs' && (
                                  <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
                                )}
                              </div>
                            ))}

                            {(() => {
                              const aq = (
                                getActiveMentionQueryAtPosition(getCaretPos())?.query || ''
                              ).toLowerCase()
                              const filteredLen = mentionOptions.filter((label) =>
                                label.toLowerCase().includes(aq)
                              ).length
                              const aggregated = [
                                ...workflowBlocks
                                  .filter((b) => (b.name || b.id).toLowerCase().includes(aq))
                                  .map((b) => ({ type: 'Workflow Blocks' as const, value: b })),
                                ...workflows
                                  .filter((w) =>
                                    (w.name || 'Untitled Workflow').toLowerCase().includes(aq)
                                  )
                                  .map((w) => ({ type: 'Workflows' as const, value: w })),
                                ...blocksList
                                  .filter((b) => (b.name || b.id).toLowerCase().includes(aq))
                                  .map((b) => ({ type: 'Blocks' as const, value: b })),
                                ...knowledgeBases
                                  .filter((k) => (k.name || 'Untitled').toLowerCase().includes(aq))
                                  .map((k) => ({ type: 'Knowledge' as const, value: k })),
                                ...templatesList
                                  .filter((t) =>
                                    (t.name || 'Untitled Template').toLowerCase().includes(aq)
                                  )
                                  .map((t) => ({ type: 'Templates' as const, value: t })),
                                ...pastChats
                                  .filter((c) =>
                                    (c.title || 'Untitled Chat').toLowerCase().includes(aq)
                                  )
                                  .map((c) => ({ type: 'Chats' as const, value: c })),
                                ...logsList
                                  .filter((l) =>
                                    (l.workflowName || 'Untitled Workflow')
                                      .toLowerCase()
                                      .includes(aq)
                                  )
                                  .map((l) => ({ type: 'Logs' as const, value: l })),
                              ]
                              if (!aq || aq.length === 0 || aggregated.length === 0) return null
                              return (
                                <>
                                  <div className='my-1 h-px bg-border/70' />
                                  <div className='px-2 py-1 text-[11px] text-muted-foreground'>
                                    Matches
                                  </div>
                                  {aggregated.map((item, idx) => (
                                    <div
                                      key={`${item.type}-${(item.value as any).id}`}
                                      data-idx={filteredLen + idx}
                                      className={cn(
                                        'flex cursor-default items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                        inAggregated && submenuActiveIndex === idx && 'bg-muted'
                                      )}
                                      role='menuitem'
                                      aria-selected={inAggregated && submenuActiveIndex === idx}
                                      onMouseEnter={() => {
                                        setInAggregated(true)
                                        setSubmenuActiveIndex(idx)
                                      }}
                                      onClick={() => {
                                        if (item.type === 'Chats')
                                          insertPastChatMention(item.value as any)
                                        else if (item.type === 'Workflows')
                                          insertWorkflowMention(item.value as any)
                                        else if (item.type === 'Knowledge')
                                          insertKnowledgeMention(item.value as any)
                                        else if (item.type === 'Blocks')
                                          insertBlockMention(item.value as any)
                                        else if ((item as any).type === 'Workflow Blocks')
                                          insertWorkflowBlockMention(item.value as any)
                                        else if (item.type === 'Templates')
                                          insertTemplateMention(item.value as any)
                                        else if (item.type === 'Logs')
                                          insertLogMention(item.value as any)
                                      }}
                                    >
                                      {item.type === 'Chats' ? (
                                        <>
                                          <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                                            <Bot
                                              className='h-3.5 w-3.5 text-muted-foreground'
                                              strokeWidth={1.5}
                                            />
                                          </div>
                                          <span className='truncate'>
                                            {(item.value as any).title || 'Untitled Chat'}
                                          </span>
                                        </>
                                      ) : item.type === 'Workflows' ? (
                                        <>
                                          <div
                                            className='h-3.5 w-3.5 flex-shrink-0 rounded'
                                            style={{
                                              backgroundColor:
                                                (item.value as any).color || '#3972F6',
                                            }}
                                          />
                                          <span className='truncate'>
                                            {(item.value as any).name || 'Untitled Workflow'}
                                          </span>
                                        </>
                                      ) : item.type === 'Knowledge' ? (
                                        <>
                                          <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
                                          <span className='truncate'>
                                            {(item.value as any).name || 'Untitled'}
                                          </span>
                                        </>
                                      ) : item.type === 'Blocks' ? (
                                        <>
                                          <div
                                            className='relative flex h-4 w-4 items-center justify-center rounded-[3px]'
                                            style={{
                                              backgroundColor:
                                                (item.value as any).bgColor || '#6B7280',
                                            }}
                                          >
                                            {(() => {
                                              const Icon = (item.value as any).iconComponent
                                              return Icon ? (
                                                <Icon className='!h-3 !w-3 text-white' />
                                              ) : null
                                            })()}
                                          </div>
                                          <span className='truncate'>
                                            {(item.value as any).name || (item.value as any).id}
                                          </span>
                                        </>
                                      ) : item.type === 'Workflow Blocks' ? (
                                        <>
                                          <div
                                            className='relative flex h-4 w-4 items-center justify-center rounded-[3px]'
                                            style={{
                                              backgroundColor:
                                                (item.value as any).bgColor || '#6B7280',
                                            }}
                                          >
                                            {(() => {
                                              const Icon = (item.value as any).iconComponent
                                              return Icon ? (
                                                <Icon className='!h-3 !w-3 text-white' />
                                              ) : null
                                            })()}
                                          </div>
                                          <span className='truncate'>
                                            {(item.value as any).name || (item.value as any).id}
                                          </span>
                                        </>
                                      ) : item.type === 'Logs' ? (
                                        <>
                                          {(() => {
                                            const v = item.value as any
                                            return v.level === 'error' ? (
                                              <X className='h-3.5 w-3.5 text-red-500' />
                                            ) : (
                                              <Check className='h-3.5 w-3.5 text-green-500' />
                                            )
                                          })()}
                                          <span className='min-w-0 truncate'>
                                            {(item.value as any).workflowName}
                                          </span>
                                          <span className='text-muted-foreground'>·</span>
                                          <span className='whitespace-nowrap'>
                                            {formatTimestamp((item.value as any).createdAt)}
                                          </span>
                                          <span className='text-muted-foreground'>·</span>
                                          <span className='capitalize'>
                                            {(
                                              ((item.value as any).trigger as string) || 'manual'
                                            ).toLowerCase()}
                                          </span>
                                        </>
                                      ) : (
                                        <>
                                          <div className='flex h-4 w-4 items-center justify-center'>
                                            ★
                                          </div>
                                          <span className='truncate'>
                                            {(item.value as any).name || 'Untitled Template'}
                                          </span>
                                          {typeof (item.value as any).stars === 'number' && (
                                            <span className='ml-auto text-muted-foreground text-xs'>
                                              {(item.value as any).stars}
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  ))}
                                </>
                              )
                            })()}
                          </div>
                        )
                      })()}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Bottom Row: Mode Selector + Attach Button + Send Button */}
          <div className='flex items-center justify-between'>
            {/* Left side: Mode Selector and Depth (if Agent) */}
            <div className='flex items-center gap-1.5'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={!onModeChange}
                    className='flex h-6 items-center gap-1.5 rounded-full border px-2 py-1 font-medium text-xs'
                  >
                    {getModeIcon()}
                    <span>{getModeText()}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' className='p-0'>
                  <TooltipProvider>
                    <div className='w-[160px] p-1'>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem
                            onSelect={() => onModeChange?.('ask')}
                            className={cn(
                              'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                              mode === 'ask' && 'bg-muted/40'
                            )}
                          >
                            <span className='flex items-center gap-1.5'>
                              <MessageCircle className='h-3 w-3 text-muted-foreground' />
                              Ask
                            </span>
                            {mode === 'ask' && <Check className='h-3 w-3 text-muted-foreground' />}
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent
                          side='right'
                          sideOffset={6}
                          align='center'
                          className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
                        >
                          Ask mode can help answer questions about your workflow, tell you about
                          Sim, and guide you in building/editing.
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem
                            onSelect={() => onModeChange?.('agent')}
                            className={cn(
                              'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                              mode === 'agent' && 'bg-muted/40'
                            )}
                          >
                            <span className='flex items-center gap-1.5'>
                              <Package className='h-3 w-3 text-muted-foreground' />
                              Agent
                            </span>
                            {mode === 'agent' && (
                              <Check className='h-3 w-3 text-muted-foreground' />
                            )}
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent
                          side='right'
                          sideOffset={6}
                          align='center'
                          className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
                        >
                          Agent mode can build, edit, and interact with your workflows (Recommended)
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </DropdownMenuContent>
              </DropdownMenu>
              {
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className={cn(
                        'flex h-6 items-center gap-1.5 rounded-full border px-2 py-1 font-medium text-xs',
                        !agentPrefetch
                          ? 'border-[var(--brand-primary-hover-hex)] text-[var(--brand-primary-hover-hex)] hover:bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_8%,transparent)] hover:text-[var(--brand-primary-hover-hex)]'
                          : 'border-border text-foreground'
                      )}
                      title='Choose mode'
                    >
                      {getDepthIcon()}
                      <span>{getCollapsedModeLabel()}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='start' className='p-0'>
                    <TooltipProvider delayDuration={100} skipDelayDuration={0}>
                      <div className='w-[260px] p-3'>
                        <div className='mb-3 flex items-center justify-between'>
                          <div className='flex items-center gap-1.5'>
                            <span className='font-medium text-xs'>MAX mode</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type='button'
                                  className='h-3.5 w-3.5 rounded text-muted-foreground transition-colors hover:text-foreground'
                                  aria-label='MAX mode info'
                                >
                                  <Info className='h-3.5 w-3.5' />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                side='right'
                                sideOffset={6}
                                align='center'
                                className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
                              >
                                Significantly increases depth of reasoning
                                <br />
                                <span className='text-[10px] text-muted-foreground italic'>
                                  Only available in Advanced and Behemoth modes
                                </span>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Switch
                            checked={!agentPrefetch}
                            disabled={agentDepth < 2}
                            title={
                              agentDepth < 2
                                ? 'MAX mode is only available for Advanced or Expert'
                                : undefined
                            }
                            onCheckedChange={(checked) => {
                              if (agentDepth < 2) return
                              setAgentPrefetch(!checked)
                            }}
                          />
                        </div>
                        <div className='my-2 flex justify-center'>
                          <div className='h-px w-[100%] bg-border' />
                        </div>
                        <div className='mb-3'>
                          <div className='mb-2 flex items-center justify-between'>
                            <span className='font-medium text-xs'>Mode</span>
                            <div className='flex items-center gap-1'>
                              {getDepthIconFor(agentDepth)}
                              <span className='text-muted-foreground text-xs'>
                                {getDepthLabelFor(agentDepth)}
                              </span>
                            </div>
                          </div>
                          <div className='relative'>
                            <CopilotSlider
                              min={0}
                              max={3}
                              step={1}
                              value={[agentDepth]}
                              onValueChange={(val) =>
                                setAgentDepth((val?.[0] ?? 0) as 0 | 1 | 2 | 3)
                              }
                            />
                            <div className='pointer-events-none absolute inset-0'>
                              <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-[33.333%] h-2 w-[3px] bg-background' />
                              <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-[66.667%] h-2 w-[3px] bg-background' />
                            </div>
                          </div>
                        </div>
                        <div className='mt-3 text-[11px] text-muted-foreground'>
                          {getDepthDescription(agentDepth)}
                        </div>
                      </div>
                    </TooltipProvider>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
              <Button
                variant='ghost'
                size='icon'
                onClick={handleOpenMentionMenuWithAt}
                disabled={disabled || isLoading}
                className='h-4 w-4 text-muted-foreground hover:text-foreground'
                title='Insert @'
              >
                <AtSign className='h-1.5 w-1.5' strokeWidth={1.25} />
              </Button>
            </div>

            {/* Right side: Attach Button + Send Button */}
            <div className='flex items-center gap-1'>
              {/* Attach Button */}
              <Button
                variant='ghost'
                size='icon'
                onClick={handleFileSelect}
                disabled={disabled || isLoading}
                className='h-6 w-6 text-muted-foreground hover:text-foreground'
                title='Attach file'
              >
                <Paperclip className='h-3 w-3' />
              </Button>

              {/* Send Button */}
              {showAbortButton ? (
                <Button
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
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  size='icon'
                  className='h-6 w-6 rounded-full bg-[var(--brand-primary-hover-hex)] text-white shadow-[0_0_0_0_var(--brand-primary-hover-hex)] transition-all duration-200 hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                >
                  {isLoading ? (
                    <Loader2 className='h-3 w-3 animate-spin' />
                  ) : (
                    <ArrowUp className='h-3 w-3' />
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type='file'
            onChange={handleFileChange}
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
