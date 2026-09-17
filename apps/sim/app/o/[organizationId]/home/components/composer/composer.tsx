'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, Chip, ChipDropdown, cn, Tooltip, toast } from '@sim/emcn'
import { ArrowUp, Paperclip, Plus, Search, Slash } from '@sim/emcn/icons'
import { useQueries } from '@tanstack/react-query'
import {
  ASSISTANT_IMAGE_ACCEPT_ATTRIBUTE,
  isAssistantImageType,
} from '@/lib/uploads/shared/assistant-images'
import { MOTHERSHIP_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { SearchInputBar } from '@/app/o/[organizationId]/components/search-input-bar'
import { SearchLevelSelector } from '@/app/o/[organizationId]/home/components/composer/search-level-selector'
import type { SearchLevel } from '@/app/o/[organizationId]/home/search-params'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { AttachedFilesList } from '@/app/workspace/[workspaceId]/home/components/user-input/components/attached-files-list/attached-files-list'
import {
  SEND_BUTTON_ACTIVE,
  SEND_BUTTON_BASE,
  SEND_BUTTON_DISABLED,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
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
import {
  escapeRegex,
  SKILL_CHIP_TRIGGER,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import { getSkillsQueryOptions } from '@/hooks/queries/skills'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useAnimatedPlaceholder } from '@/hooks/use-animated-placeholder'
import { useChatInputFocus } from '@/hooks/use-chat-input-focus'
import { useVoiceInput } from '@/hooks/use-voice-input'
import type { ChatContext } from '@/stores/panel'

const CONVERSATION_MODES = [
  { value: 'assistant', label: 'Search' },
  { value: 'agent', label: 'Build' },
] as const

interface ComposerProps {
  requestMode?: ChatRequestMode
  assistantSearchLevel?: SearchLevel
  onAssistantSearchLevelChange?: (level: SearchLevel) => void
  onModeChange?: (mode: ChatRequestMode) => void
  showModeSelector?: boolean
  value: string
  files: ReturnType<typeof useFileAttachments>
  /** On the empty home the placeholder types itself and the field is taller; in a chat it is the plain footer input. */
  isInitialView: boolean
  isSending: boolean
  onChange: (value: string) => void
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
  requestMode = 'assistant',
  onModeChange,
  assistantSearchLevel = 'adaptive',
  onAssistantSearchLevelChange,
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
  const [modeSelectorOpen, setModeSelectorOpen] = useState(false)
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
  useEffect(() => {
    if (editorRef.current.getValue() !== editor.value) return
    if (editor.value !== lastPublished.current) {
      lastPublished.current = editor.value
      onChange(editor.value)
    }
  }, [editor.value, onChange])
  useEffect(() => {
    if (!restoredContexts) return
    // A queued skill may belong to a workspace whose picker has never opened here.
    // Restore its existing chip from the saved context, without rediscovering it.
    let restoredText = editorRef.current.getValue()
    for (const context of restoredContexts) {
      if (context.kind !== 'skill') continue
      restoredText = restoredText.replace(
        new RegExp(`(^|\\s)/${escapeRegex(context.label)}(?=\\s|$)`, 'g'),
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
      {showModeSelector && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span className='inline-flex shrink-0'>
              <ChipDropdown
                variant='ghost'
                iconOnly={imagesOnly}
                leftIcon={imagesOnly ? Search : undefined}
                aria-label='Conversation mode'
                options={CONVERSATION_MODES}
                value={requestMode}
                disabled={!onModeChange}
                align='start'
                matchTriggerWidth={false}
                showSelectedCheck={false}
                onOpenChange={setModeSelectorOpen}
                onChange={(mode) => {
                  if ((mode !== 'assistant' && mode !== 'agent') || mode === requestMode) return
                  if (
                    mode === 'assistant' &&
                    (editor.getActiveContexts().length > 0 ||
                      files.attachedFiles.some((file) => !isAssistantImageType(file.type)))
                  ) {
                    toast.info(
                      'Remove resource and skill mentions and non-image attachments before switching to Search.'
                    )
                    return
                  }
                  onModeChange?.(mode)
                }}
              />
            </span>
          </Tooltip.Trigger>
          {!modeSelectorOpen && <Tooltip.Content side='top'>Select mode</Tooltip.Content>}
        </Tooltip.Root>
      )}
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
    </>
  )
  const voiceControl = voice.isSupported && (
    <MicButton
      audioLevelsRef={voice.audioLevelsRef}
      isListening={voice.isListening}
      onToggle={voice.toggleListening}
    />
  )
  const searchLevelControl = imagesOnly && onAssistantSearchLevelChange && (
    <SearchLevelSelector value={assistantSearchLevel} onChange={onAssistantSearchLevelChange} />
  )
  const submitControl = isSending ? (
    <Button
      type='button'
      variant='ghost'
      onClick={onStop}
      aria-label='Stop generation'
      className={cn(SEND_BUTTON_BASE, SEND_BUTTON_ACTIVE)}
    >
      <svg
        className='block size-[14px] fill-white dark:fill-black'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
      </svg>
    </Button>
  ) : (
    <Button
      type='button'
      variant='ghost'
      onClick={submit}
      disabled={!canSubmit}
      aria-label='Send'
      className={cn(SEND_BUTTON_BASE, canSubmit ? SEND_BUTTON_ACTIVE : SEND_BUTTON_DISABLED)}
    >
      <ArrowUp className='block size-[16px] text-white dark:text-black' />
    </Button>
  )

  return (
    <div
      onDragEnter={files.handleDragEnter}
      onDragLeave={files.handleDragLeave}
      onDragOver={files.handleDragOver}
      onDrop={files.handleDrop}
      className={cn(
        'relative z-10 mx-auto w-full max-w-chat',
        !imagesOnly &&
          'rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
        !imagesOnly && isInitialView && 'shadow-ambient'
      )}
    >
      <AttachedFilesList
        attachedFiles={files.attachedFiles}
        onFileClick={files.handleFileClick}
        onRemoveFile={files.removeFile}
      />
      {!imagesOnly && promptEditor}

      {imagesOnly ? (
        <SearchInputBar
          floating={isInitialView}
          inputRef={textareaRef}
          value={editor.value}
          onChange={(text) => editor.setValue(text)}
          onSubmit={submit}
          onPaste={editor.handlePaste}
          placeholder={placeholder}
          aria-label='Ask Sim'
          leadingControls={leadingControls}
          selectionControl={searchLevelControl}
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
