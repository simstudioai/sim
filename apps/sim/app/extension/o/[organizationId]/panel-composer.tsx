'use client'

import type { ReactNode } from 'react'
import {
  Chip,
  ComposerActionButton,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Tooltip,
} from '@sim/emcn'
import { ArrowUp, Paperclip, Plus, Slash, StopFilled } from '@sim/emcn/icons'
import { inter } from '@/app/_styles/fonts/inter/inter'
import {
  COMPOSER_FIELD_HEIGHT_CLASSES,
  ComposerAttachments,
  ComposerFileTargets,
  type ConversationComposerProps,
  useComposer,
} from '@/app/o/[organizationId]/home/components/composer'
import { InputToolbar } from '@/app/workspace/[workspaceId]/home/components/user-input/components/input-toolbar'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'
import type { ModelSelectorOptions } from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-selector'
import { PromptEditor } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor'

interface PanelComposerProps extends ConversationComposerProps {
  attachments?: ReactNode
  resourceActions?: ReactNode
  toolbarActions?: ReactNode
  modelSelectorOptions?: ModelSelectorOptions
}

/** The composer in the extension's side panel. */
export function PanelComposer({
  attachments,
  resourceActions,
  toolbarActions,
  modelSelectorOptions,
  ...props
}: PanelComposerProps) {
  const composer = useComposer({
    ...props,
    waitsForFullLists: false,
    hasAdditionalAttachments: Boolean(attachments),
  })
  const { editor, voice, files, imagesOnly, requestMode, onPlanChange } = composer
  const attachLabel = imagesOnly ? 'Attach image' : 'Attach file'
  return (
    <div
      {...composer.frameProps}
      className={cn(
        'relative z-10 mx-auto w-full max-w-chat',
        inter.className,
        'rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]'
      )}
    >
      <ComposerAttachments files={files} additional={attachments} />
      <PromptEditor
        editor={editor}
        resourceActions={resourceActions}
        placeholder='Send message to Sim'
        aria-label='Ask Sim'
        onSubmit={composer.submit}
        {...composer.keyPolicy}
        className={COMPOSER_FIELD_HEIGHT_CLASSES}
      />
      <InputToolbar
        plan={requestMode === 'plan'}
        showModelSelector={!imagesOnly}
        modelSelectorOptions={imagesOnly ? undefined : modelSelectorOptions}
        leadingControls={
          <>
            {imagesOnly && resourceActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Chip shape='round' leftIcon={Plus} aria-label='Add resources' />
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start'>{resourceActions}</DropdownMenuContent>
              </DropdownMenu>
            )}
            {!imagesOnly && (
              <ContextPicker
                icon={Plus}
                label='Add resources'
                onClick={composer.openResourceMenu}
              />
            )}
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Chip
                  shape='round'
                  leftIcon={Paperclip}
                  onClick={files.handleFileSelect}
                  aria-label={attachLabel}
                />
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>{attachLabel}</Tooltip.Content>
            </Tooltip.Root>
            {!imagesOnly && (
              <ContextPicker
                icon={Slash}
                label='Skills'
                onClick={() => editor.insertSlashTrigger()}
              />
            )}
            {toolbarActions}
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
        }
        voiceControl={
          voice.isSupported && (
            <MicButton
              audioLevels={voice.audioLevels}
              isListening={voice.isListening}
              onToggle={voice.toggleListening}
            />
          )
        }
        submitControl={
          composer.isSending ? (
            <ComposerActionButton
              type='button'
              onClick={composer.onStop}
              aria-label='Stop generation'
              active
            >
              <StopFilled className='block size-[14px] fill-white dark:fill-black' />
            </ComposerActionButton>
          ) : (
            <ComposerActionButton
              type='button'
              onClick={composer.submit}
              disabled={!composer.canSend}
              aria-label='Send'
              active={composer.canSend}
            >
              <ArrowUp className='block size-[16px] text-white dark:text-black' />
            </ComposerActionButton>
          )
        }
      />
      <ComposerFileTargets files={files} imagesOnly={imagesOnly} />
      <MicrophonePermissionHelp
        open={voice.permissionHelpOpen}
        onOpenChange={voice.setPermissionHelpOpen}
      />
    </div>
  )
}

interface ContextPickerProps {
  icon: typeof Plus
  label: string
  onClick: (event: { currentTarget: Element }) => void
}

function ContextPicker({ icon, label, onClick }: ContextPickerProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Chip shape='round' leftIcon={icon} aria-label={label} onClick={onClick} />
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}
