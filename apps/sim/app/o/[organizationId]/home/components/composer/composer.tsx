'use client'

import { useEffect, useRef } from 'react'
import { Chip, ComposerActionButton, cn, Tooltip, toast } from '@sim/emcn'
import { ArrowUp, Paperclip, Plus, Search, Slash, StopFilled } from '@sim/emcn/icons'
import { escapeRegExp } from '@sim/utils/string'
import { useQueries } from '@tanstack/react-query'
import {
  ASSISTANT_IMAGE_ACCEPT_ATTRIBUTE,
  isAssistantImageType,
} from '@/lib/uploads/shared/assistant-images'
import { MOTHERSHIP_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { SearchInputBar } from '@/app/o/[organizationId]/components/search-input-bar'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { AttachedFilesList } from '@/app/workspace/[workspaceId]/home/components/user-input/components/attached-files-list/attached-files-list'
import { ConversationModeSelector } from '@/app/workspace/[workspaceId]/home/components/user-input/components/conversation-mode-selector'
import { DropOverlay } from '@/app/workspace/[workspaceId]/home/components/user-input/components/drop-overlay/drop-overlay'
import { InputToolbar } from '@/app/workspace/[workspaceId]/home/components/user-input/components/input-toolbar'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'
import {
  PromptEditor,
  usePromptEditor,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor'
import { organizationSkillOptions } from '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/organization-skill-options'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import type { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { SKILL_CHIP_TRIGGER } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import { getSkillsQueryOptions } from '@/hooks/queries/skills'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useAnimatedPlaceholder } from '@/hooks/use-animated-placeholder'
import { useChatInputFocus } from '@/hooks/use-chat-input-focus'
import { useVoiceInput } from '@/hooks/use-voice-input'
import type { ChatContext } from '@/stores/panel'

interface ComposerProps {
  searchEnabled?: boolean
  requestMode?: ChatRequestMode
  onModeChange?: (mode: ChatRequestMode) => void
  showModeSelector?: boolean
  value: string
  files: ReturnType<typeof useFileAttachments>
  /** On the empty home the placeholder types itself and the field is taller; in a chat it is the plain footer input. */
  isInitialView: boolean
  isSending: boolean
  onChange: (value: string, contexts?: ChatContext[]) => void
  restoredContexts?: ChatContext[]
  onSubmit: (text: string, contexts?: ChatContext[]) => void
  onStop: () => void
}

/**
 * The organization home composer: a question to the Assistant. Wears the
 * workspace chat input's chrome — the framed field and the send control — and
 * carries only the controls that are wired for the organization.
 */
export function Composer({
  searchEnabled = true,
  requestMode = 'assistant',
  onModeChange,
  showModeSelector = false,
  value,
  files,
  isInitialView,
  isSending,
  onChange,
  onSubmit,
  restoredContexts,
  onStop,
}: ComposerProps) {
  const imagesOnly = requestMode === 'assistant'
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
    // A queued skill may belong to a workspace whose picker has never opened here.
    // Restore its existing chip from the saved context, without rediscovering it.
    let restoredText = editorRef.current.getValue()
    for (const context of restoredContexts) {
      if (context.kind !== 'skill') continue
      restoredText = restoredText.replace(
        new RegExp(`(^|\\s)/${escapeRegExp(context.label)}(?=\\s|$)`, 'g'),
        `$1${SKILL_CHIP_TRIGGER}${context.label}`
      )
    }
    editorRef.current.setValue(restoredText, { chipify: false })
    editorRef.current.setContexts(restoredContexts)
  }, [restoredContexts])
  useChatInputFocus({ textareaRef })
  const voice = useVoiceInput({
    organizationId: organization.id,
    getValue: () => editor.getPlainValue(),
    onChange: (text) => editor.setValue(text),
  })
  const canSubmit =
    !files.attachedFiles.some((file) => file.uploading) &&
    (value.trim().length > 0 || files.attachedFiles.some((file) => file.key))
  const animatedPlaceholder = useAnimatedPlaceholder(
    isInitialView && !value,
    imagesOnly ? 'search' : 'build'
  )
  const placeholder = isInitialView ? animatedPlaceholder : 'Send message to Sim'

  const submit = () => {
    if (!canSubmit) return
    voice.resetTranscript()
    const contexts = imagesOnly ? [] : editor.getActiveContexts()
    onSubmit(editor.getPlainValue(), contexts.length ? contexts : undefined)
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

  const promptEditor = (
    <PromptEditor
      editor={editor}
      placeholder={placeholder}
      aria-label='Ask Sim'
      onSubmit={submit}
      className={cn('max-h-[200px]', isInitialView && 'min-h-[56px]')}
    />
  )

  const leadingControls = (
    <>
      {imagesOnly && !showModeSelector && (
        <Search className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      )}
      {!imagesOnly && contextPicker('resources', Plus, 'Add resources')}

      {!imagesOnly && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Chip
              shape='round'
              leftIcon={Paperclip}
              onClick={files.handleFileSelect}
              aria-label='Attach file'
            />
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Attach file</Tooltip.Content>
        </Tooltip.Root>
      )}
      {!imagesOnly && contextPicker('skills', Slash, 'Skills')}
      {showModeSelector && (
        <ConversationModeSelector
          value={requestMode}
          searchEnabled={searchEnabled}
          onChange={
            onModeChange
              ? (mode) => {
                  if (
                    mode === 'assistant' &&
                    (editor.getActiveContexts().length > 0 ||
                      files.attachedFiles.some((file) => !isAssistantImageType(file.type)))
                  ) {
                    toast.info(
                      'Remove resource and skill mentions and non-image attachments before switching to Ask.'
                    )
                    return
                  }
                  onModeChange(mode)
                }
              : undefined
          }
        />
      )}
    </>
  )
  const voiceControl = voice.isSupported && (
    <MicButton
      audioLevelsRef={voice.audioLevelsRef}
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

  const attachmentList = files.attachedFiles.length ? (
    <AttachedFilesList
      attachedFiles={files.attachedFiles}
      onFileClick={files.handleFileClick}
      onRemoveFile={files.removeFile}
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
        !imagesOnly &&
          'rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
        !imagesOnly && isInitialView && 'shadow-ambient'
      )}
    >
      {!imagesOnly && attachmentList}
      {!imagesOnly && promptEditor}

      {imagesOnly ? (
        <SearchInputBar
          floating={isInitialView}
          attachments={attachmentList}
          inputRef={textareaRef}
          value={editor.value}
          onChange={(text) => editor.setValue(text)}
          onSubmit={submit}
          onPaste={editor.handlePaste}
          placeholder={placeholder}
          aria-label='Ask Sim'
          leadingControls={leadingControls}
          voiceControl={voiceControl}
          submitControl={submitControl}
        />
      ) : (
        <InputToolbar
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
