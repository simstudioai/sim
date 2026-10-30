'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import {
  Chip,
  ComposerActionButton,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Tooltip,
  toast,
} from '@sim/emcn'
import { ArrowUp, Paperclip, Plus, Search, Slash, StopFilled } from '@sim/emcn/icons'
import { useQueries } from '@tanstack/react-query'
import { UNAVAILABLE_CONTEXT_NOTICE } from '@/lib/mothership/chat/context'
import { ASSISTANT_IMAGE_ACCEPT_ATTRIBUTE } from '@/lib/uploads/shared/assistant-images'
import { MOTHERSHIP_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { SearchInputBar } from '@/app/o/[organizationId]/components/search-input-bar'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { AttachedFilesList } from '@/app/workspace/[workspaceId]/home/components/user-input/components/attached-files-list/attached-files-list'
import { DropOverlay } from '@/app/workspace/[workspaceId]/home/components/user-input/components/drop-overlay/drop-overlay'
import { InputToolbar } from '@/app/workspace/[workspaceId]/home/components/user-input/components/input-toolbar'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'
import type { ModelSelectorOptions } from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-selector'
import {
  PromptEditor,
  usePromptEditor,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor'
import { organizationSkillOptions } from '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/organization-skill-options'
import { usePromptHistory } from '@/app/workspace/[workspaceId]/home/components/user-input/hooks/use-prompt-history'
import type { ChatMessage, ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import type { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { filterContextsPresentInMessage } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import { getSkillsQueryOptions } from '@/hooks/queries/skills'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useAnimatedPlaceholder } from '@/hooks/use-animated-placeholder'
import { useChatInputFocus } from '@/hooks/use-chat-input-focus'
import { useVoiceInput } from '@/hooks/use-voice-input'
import type { ChatContext } from '@/stores/panel'

interface ComposerProps {
  requestMode?: ChatRequestMode
  onPlanChange?: () => void
  value: string
  files: ReturnType<typeof useFileAttachments>
  /** On the empty home the placeholder types itself and the field is taller; in a chat it is the plain footer input. */
  isInitialView: boolean
  isSending: boolean
  onChange: (value: string, contexts?: ChatContext[]) => void
  restoredContexts?: ChatContext[]
  onSubmit: (text: string, contexts?: ChatContext[]) => undefined | false
  onSendQueuedHead?: () => void
  onEditQueuedTail?: () => boolean
  messages?: readonly ChatMessage[]
  onStop: () => void
  compact?: boolean
  attachments?: ReactNode
  resourceActions?: ReactNode
  modelSelectorOptions?: ModelSelectorOptions
}

/** Organization composer with scoped resources, attachments, voice, and draft restoration. */
export function Composer({
  requestMode = 'assistant',
  onPlanChange,
  value,
  files,
  isInitialView,
  isSending,
  onChange,
  onSubmit,
  onSendQueuedHead,
  onEditQueuedTail,
  messages,
  restoredContexts,
  onStop,
  compact = false,
  attachments,
  resourceActions,
  modelSelectorOptions,
}: ComposerProps) {
  const attachedFilesRef = useRef(files.attachedFiles)
  attachedFilesRef.current = files.attachedFiles
  const imagesOnly = requestMode === 'assistant'
  const searchInput = imagesOnly && !compact
  const hasAdditionalAttachments = Boolean(attachments)
  const { organization } = useOrganizationContext()
  const { data: allWorkspaces = [] } = useWorkspacesQuery(!imagesOnly)
  const workspaces = (imagesOnly ? [] : allWorkspaces).filter(
    (workspace) => workspace.organizationId === organization.id
  )
  const skillQueries = useQueries({
    queries: workspaces.map((workspace) => getSkillsQueryOptions(workspace.id)),
  })
  const skills = imagesOnly
    ? []
    : organizationSkillOptions(
        workspaces.map((workspace, index) => ({
          ...workspace,
          skills: skillQueries[index].isPlaceholderData ? [] : (skillQueries[index].data ?? []),
        }))
      )
  const editor = usePromptEditor({
    workspaceId: '',
    availableSkills: skills,
    organizationId: organization.id,
    contextsEnabled: !imagesOnly,
    initialValue: value,
    initialContexts: restoredContexts,
    onPasteFiles: files.processFiles,
  })
  const history = usePromptHistory({
    editor,
    attachedFiles: files.attachedFiles,
    restoreAttachedFiles: files.restoreAttachedFiles,
    getMessages: () => messages ?? [],
  })
  const { textareaRef } = editor
  const editorRef = useRef(editor)
  editorRef.current = editor
  const lastPublished = useRef(value)
  useEffect(() => {
    if (value !== lastPublished.current) {
      editorRef.current.setValue(value)
      if (!value) editorRef.current.setContexts([])
      lastPublished.current = value
      if (value) textareaRef.current?.focus()
    }
  }, [value, textareaRef])
  const lastContexts = useRef(editor.contexts)
  useEffect(() => {
    if (editorRef.current.getValue() !== editor.value) return
    const plainValue = editorRef.current.getPlainValue()
    if (plainValue !== lastPublished.current || editor.contexts !== lastContexts.current) {
      lastPublished.current = plainValue
      lastContexts.current = editor.contexts
      onChange(plainValue, editor.contexts.length ? editor.contexts : undefined)
    }
  }, [editor.value, editor.contexts, onChange])
  useEffect(() => {
    if (!restoredContexts) return
    history.reset()
    const { hasUnavailableContexts } = editorRef.current.restorePrompt(
      editorRef.current.getPlainValue(),
      restoredContexts
    )
    if (hasUnavailableContexts) toast.info(UNAVAILABLE_CONTEXT_NOTICE)
  }, [restoredContexts, history.reset])
  useChatInputFocus({ textareaRef })
  const voice = useVoiceInput({
    organizationId: organization.id,
    getValue: () => editor.getPlainValue(),
    onChange: (text) => editor.setValue(text),
  })
  const canSubmit =
    !files.attachedFiles.some((file) => file.uploading) &&
    (value.trim().length > 0 ||
      files.attachedFiles.some((file) => file.key) ||
      hasAdditionalAttachments)
  const animatedPlaceholder = useAnimatedPlaceholder(
    !compact && !imagesOnly && isInitialView && !value
  )
  const placeholder = isInitialView && !compact ? animatedPlaceholder : 'Send message to Sim'

  const submit = () => {
    if (attachedFilesRef.current.some((file) => file.uploading)) return
    const hasPayload =
      editor.getValue().trim().length > 0 ||
      attachedFilesRef.current.some((file) => file.key) ||
      hasAdditionalAttachments
    if (!hasPayload) {
      if (isSending) onSendQueuedHead?.()
      return
    }
    const contexts = imagesOnly
      ? filterContextsPresentInMessage(
          editor.contexts.filter((context) => context.kind === 'browser_page'),
          editor.getPlainValue()
        )
      : editor.getActiveContexts()
    if (onSubmit(editor.getPlainValue(), contexts.length ? contexts : undefined) === false) return
    attachedFilesRef.current = []
    voice.resetTranscript()
    history.reset()
    editor.clear()
  }

  const contextPicker = (kind: 'resources' | 'skills', icon: typeof Plus, label: string) => (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Chip
          shape='round'
          leftIcon={icon}
          aria-label={label}
          onClick={(event) => {
            if (kind === 'skills') editor.insertSlashTrigger()
            else {
              const rect = event.currentTarget.getBoundingClientRect()
              editor.openResourceMenu({ left: rect.left, top: rect.top })
            }
          }}
        />
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>{label}</Tooltip.Content>
    </Tooltip.Root>
  )

  const recallQueuedTail = () => {
    if (hasAdditionalAttachments || attachedFilesRef.current.length > 0) return false
    return onEditQueuedTail?.() ?? false
  }
  const promptEditor = (
    <PromptEditor
      editor={editor}
      resourceActions={resourceActions}
      placeholder={placeholder}
      aria-label='Ask Sim'
      onSubmit={submit}
      onNavigateHistory={hasAdditionalAttachments ? undefined : history.navigate}
      onArrowUpOnEmpty={recallQueuedTail}
      className={cn(
        'max-h-[200px] max-md:max-h-[min(200px,calc(var(--mobile-viewport-height,100dvh)*0.25))]',
        isInitialView && !compact && 'min-h-[56px] max-md:min-h-0'
      )}
    />
  )

  const leadingControls = (
    <>
      {searchInput && <Search className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
      {imagesOnly && resourceActions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip shape='round' leftIcon={Plus} aria-label='Add resources' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>{resourceActions}</DropdownMenuContent>
        </DropdownMenu>
      )}
      {!imagesOnly && contextPicker('resources', Plus, 'Add resources')}

      {(!imagesOnly || compact) && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Chip
              shape='round'
              leftIcon={Paperclip}
              onClick={files.handleFileSelect}
              aria-label={imagesOnly ? 'Attach image' : 'Attach file'}
            />
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            {imagesOnly ? 'Attach image' : 'Attach file'}
          </Tooltip.Content>
        </Tooltip.Root>
      )}
      {!imagesOnly && contextPicker('skills', Slash, 'Skills')}
      {onPlanChange && (
        <Chip
          shape='round'
          active={requestMode === 'plan'}
          aria-pressed={requestMode === 'plan'}
          onClick={onPlanChange}
        >
          Plan
        </Chip>
      )}
    </>
  )
  const voiceControl = voice.isSupported && (
    <MicButton
      audioLevels={voice.audioLevels}
      isListening={voice.isListening}
      onToggle={voice.toggleListening}
    />
  )
  const submitControl = isSending ? (
    <ComposerActionButton type='button' onClick={onStop} aria-label='Stop generation' active>
      <StopFilled className='block size-[14px] fill-white dark:fill-black' />
    </ComposerActionButton>
  ) : (
    <ComposerActionButton
      type='button'
      onClick={submit}
      disabled={!canSubmit}
      aria-label='Send'
      active={canSubmit}
    >
      <ArrowUp className='block size-[16px] text-white dark:text-black' />
    </ComposerActionButton>
  )

  const attachmentList =
    files.attachedFiles.length || attachments ? (
      <AttachedFilesList
        attachedFiles={files.attachedFiles}
        onFileClick={files.handleFileClick}
        onRemoveFile={files.removeFile}
        additionalAttachments={attachments}
      />
    ) : null

  return (
    <div
      onDragEnter={files.handleDragEnter}
      onDragLeave={files.handleDragLeave}
      onDragOver={files.handleDragOver}
      onDrop={files.handleDrop}
      className={cn(
        inter.className,
        'relative z-10 mx-auto w-full max-w-chat',
        !searchInput &&
          'rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
        !searchInput && !compact && isInitialView && 'shadow-ambient'
      )}
    >
      {!searchInput && attachmentList}
      {!searchInput && promptEditor}

      {searchInput ? (
        <SearchInputBar
          floating={isInitialView}
          attachments={attachmentList}
          inputRef={textareaRef}
          value={editor.value}
          onChange={(text) => editor.setValue(text)}
          onSubmit={submit}
          onPaste={editor.handlePaste}
          onKeyDown={(event) =>
            editor.handleKeyDown(event, {
              onNavigateHistory: hasAdditionalAttachments ? undefined : history.navigate,
              onArrowUpOnEmpty: recallQueuedTail,
            })
          }
          placeholder={isInitialView ? 'Ask about your sources' : 'Ask a follow-up'}
          aria-label='Ask Sim'
          leadingControls={leadingControls}
          voiceControl={voiceControl}
          submitControl={submitControl}
        />
      ) : (
        <InputToolbar
          plan={requestMode === 'plan'}
          showModelSelector={!imagesOnly}
          modelSelectorOptions={imagesOnly ? undefined : modelSelectorOptions}
          leadingControls={leadingControls}
          voiceControl={voiceControl}
          submitControl={submitControl}
        />
      )}

      <input
        ref={files.fileInputRef}
        type='file'
        accept={imagesOnly ? ASSISTANT_IMAGE_ACCEPT_ATTRIBUTE : MOTHERSHIP_ACCEPT_ATTRIBUTE}
        onChange={files.handleFileChange}
        className='hidden'
        multiple
      />
      {files.isDragging && <DropOverlay imagesOnly={imagesOnly} />}
      <MicrophonePermissionHelp
        open={voice.permissionHelpOpen}
        onOpenChange={voice.setPermissionHelpOpen}
      />
    </div>
  )
}
