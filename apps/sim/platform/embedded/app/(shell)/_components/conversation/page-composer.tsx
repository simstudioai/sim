'use client'

import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import {
  COMPOSER_FIELD_HEIGHT_CLASSES,
  ComposerAttachments,
  ComposerFileTargets,
  type ConversationComposerProps,
  useComposer,
} from '@/app/_organization-conversation/composer'
import { InputToolbar } from '@/app/workspace/[workspaceId]/home/components/user-input/components/input-toolbar'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { PromptEditor } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor'
import { useAnimatedPlaceholder } from '@/hooks/use-animated-placeholder'
import { IconButton } from '@/platform/design-system/components/button/button'
import { SegmentedControl } from '@/platform/design-system/components/segmented-control/segmented-control'
import { Surface } from '@/platform/design-system/components/surface/surface'
import hostBridge from '@/platform/design-system/styles/host-bridge.module.css'
import conversationStyles from '@/platform/embedded/app/(shell)/_components/conversation/conversation.module.css'
import {
  BodyDialog,
  MicrophoneHelp,
} from '@/platform/embedded/app/(shell)/_components/conversation/dialogs'
import styles from '@/platform/embedded/app/(shell)/_components/conversation/page-composer.module.css'
import { SearchInputBar } from '@/platform/embedded/app/(shell)/_components/conversation/search-input-bar'

const PLAN_OPTIONS = [
  { value: 'build', label: 'Build' },
  { value: 'plan', label: 'Plan' },
] as const

const MODEL_SELECTOR_OPTIONS = { showEffortChevron: true } as const

/** A surface holding only design-system controls, so the legacy field and selector can sit around it. */
function ControlIsland({ children }: { children: ReactNode }) {
  return (
    <Surface>
      <div className={styles.controls}>{children}</div>
    </Surface>
  )
}

/**
 * The design's composer, on every organization destination. The field and the model selector are
 * legacy components, so the frame cannot be a surface: its material comes from a surface painted
 * behind it, and each group of design-system controls sits in a surface of its own beside them.
 */
export function PageComposer(props: ConversationComposerProps) {
  const { files, requestMode, onPlanChange, isInitialView, isSending, onStop } = props
  const composer = useComposer({ ...props, waitsForFullLists: true })
  const { editor, voice, imagesOnly } = composer
  const animatedPlaceholder = useAnimatedPlaceholder(
    !imagesOnly && isInitialView && !composer.value
  )
  const leadingControls = (
    <ControlIsland>
      {!imagesOnly && (
        <>
          <IconButton
            tooltip
            label='Add resources'
            icon='I074'
            onClick={composer.openResourceMenu}
          />
          <IconButton tooltip label='Attach file' icon='I117' onClick={files.handleFileSelect} />
          <IconButton
            tooltip
            label='Skills'
            icon='I044'
            onClick={() => editor.insertSlashTrigger()}
          />
        </>
      )}
      {onPlanChange && (
        <SegmentedControl
          label='Mode'
          options={PLAN_OPTIONS}
          value={requestMode === 'plan' ? 'plan' : 'build'}
          onSelect={() => onPlanChange()}
        />
      )}
    </ControlIsland>
  )
  const voiceControl = voice.isSupported && (
    <MicButton
      audioLevels={voice.audioLevels}
      isListening={voice.isListening}
      onToggle={voice.toggleListening}
    />
  )
  const submitControl = (
    <ControlIsland>
      {isSending ? (
        <IconButton label='Stop generation' icon='I035' variant='solid' onClick={onStop} />
      ) : (
        <IconButton
          label='Send'
          icon='I023'
          variant='solid'
          disabled={!composer.canSend}
          onClick={composer.submit}
        />
      )}
    </ControlIsland>
  )
  return (
    <div
      {...composer.frameProps}
      className={`${hostBridge.palette} ${conversationStyles.font} ${styles.frame}`}
    >
      <div className={styles.backdrop} aria-hidden='true'>
        <Surface>
          <div className={styles.material} data-material='reading' data-elevation='composer' />
        </Surface>
      </div>
      {imagesOnly ? (
        <SearchInputBar
          fieldClassName={styles.field}
          attachments={<ComposerAttachments files={files} />}
          inputRef={editor.textareaRef}
          value={editor.value}
          onChange={(text) => editor.setValue(text)}
          onSubmit={composer.submit}
          onPaste={editor.handlePaste}
          onKeyDown={(event) => editor.handleKeyDown(event, composer.keyPolicy)}
          placeholder={isInitialView ? 'Ask about your sources' : 'Ask a follow-up'}
          aria-label='Ask Sim'
          leadingControls={leadingControls}
          voiceControl={voiceControl}
          submitControl={submitControl}
        />
      ) : (
        <>
          <ComposerAttachments files={files} />
          <PromptEditor
            editor={editor}
            placeholder={isInitialView ? animatedPlaceholder : 'Send message to Sim'}
            aria-label='Ask Sim'
            onSubmit={composer.submit}
            {...composer.keyPolicy}
            className={cn(COMPOSER_FIELD_HEIGHT_CLASSES, styles.field)}
          />
          <InputToolbar
            plan={requestMode === 'plan'}
            modelSelectorOptions={MODEL_SELECTOR_OPTIONS}
            leadingControls={leadingControls}
            voiceControl={voiceControl}
            submitControl={submitControl}
          />
        </>
      )}
      <ComposerFileTargets files={files} imagesOnly={imagesOnly} />
      {voice.permissionHelpOpen && (
        <BodyDialog>
          <MicrophoneHelp onClose={() => voice.setPermissionHelpOpen(false)} />
        </BodyDialog>
      )}
    </div>
  )
}
