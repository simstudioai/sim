'use client'

import { useRef } from 'react'
import { IconButton } from '@sim/emcn/button'
import { useCompactViewport } from '@sim/emcn/layout/use-compact-viewport'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ComposerSuggestions } from '@sim/emcn/menu/suggestions'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { ComposerInput } from '@sim/emcn-platform/composer-input'
import styles from '@/app/(product)/_components/composer/composer.module.css'
import { MessageAttachments } from '@/app/(product)/_components/composer/message-attachments'
import type { ComposerController } from '@/app/(product)/_components/composer/model'
import { ComposerResourceMenu } from '@/app/(product)/_components/composer/resource-menu'
import { useComposerReferences } from '@/app/(product)/_components/composer/use-composer-references'
import {
  type PromptHistoryEntry,
  usePromptHistory,
} from '@/app/(product)/_components/composer/use-prompt-history'
import { useComposerFocus } from '@/app/(product)/_components/session/composer-host'

interface MessageComposerProps {
  composer: ComposerController
  placeholder: string
  focusTarget?: string
  /** Returns false to keep the draft, when the message was refused before it went anywhere. */
  onSubmit: (draft: ComposerController['draft']) => false | undefined
  onStop?: () => void
  /** Messages sent earlier, which Up and Down recall into an empty draft. */
  history?: readonly PromptHistoryEntry[]
}

export function MessageComposer({
  composer,
  placeholder,
  focusTarget,
  onSubmit,
  onStop,
  history,
}: MessageComposerProps) {
  const compact = useCompactViewport()
  const { draft, settings, drop } = composer
  const { text, attachments: files } = draft
  const refs = useComposerReferences(composer)
  useComposerFocus(focusTarget, refs.editor)
  const recall = usePromptHistory(composer, history, refs.editor)
  const picker = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const uploading = files.some((file) => file.uploading)
  function submit() {
    if (uploading) return
    if (!text.trim() && !files.length) return
    if (onSubmit({ text: text.trim(), attachments: files }) === false) return
    composer.clear()
  }
  const settingsMenu = settings && <ComposerSettingsMenu settings={settings} />
  return (
    <div
      className={styles.composer}
      data-material='reading'
      data-elevation='composer'
      data-dragging={drop?.dragging || undefined}
      onDragEnter={drop?.onDragEnter}
      onDragOver={drop?.onDragOver}
      onDragLeave={drop?.onDragLeave}
      onDrop={drop?.onDrop}
    >
      <MessageAttachments items={refs.attachments} onRemove={composer.removeAttachment} />
      <ComposerInput
        density={compact ? 'compact' : 'standard'}
        label={placeholder}
        placeholder={placeholder}
        inputRef={refs.editor}
        value={text}
        marks={refs.marks}
        caretAnchorRef={refs.anchor}
        anchorOffset={refs.trigger?.start}
        listId={refs.trigger ? refs.listId : undefined}
        activeOptionId={
          refs.trigger && refs.rows.length ? `${refs.listId}-${refs.active}` : undefined
        }
        onValueChange={refs.update}
        onFocus={refs.focus}
        onBlur={refs.blur}
        onCursorChange={refs.cursor}
        onEditorKeyDown={(event) => {
          refs.onKeyDown(event)
          recall(event)
        }}
        onSubmit={submit}
        onPasteFiles={composer.addFiles}
        onPasteText={composer.addPastedText}
      />
      {refs.trigger && (
        <ComposerSuggestions
          id={refs.listId}
          label={refs.trigger.prefix === '/' ? 'Skills and MCP servers' : 'Workspace resources'}
          empty={
            refs.loading
              ? 'Loading…'
              : refs.trigger.prefix === '/'
                ? 'No skills or MCP servers'
                : 'No results'
          }
          grouped={refs.trigger.prefix === '@'}
          items={refs.rows}
          active={refs.active}
          onHighlight={refs.highlight}
          onSelect={refs.selectRow}
          onDismiss={refs.dismiss}
          input={refs.editor}
          anchor={refs.anchor}
        />
      )}
      <div className={styles.toolbar} data-type='T060'>
        <div className={styles.actions}>
          <ComposerResourceMenu
            items={refs.browse}
            onSelect={refs.selectResource}
            onOpenChange={(open) => {
              if (open) composer.onPickerOpen?.()
            }}
            onWorkspaceOpen={composer.onBrowseWorkspace}
            onSearchChange={composer.onBrowseSearch}
            moreFor={composer.browseMore}
            onUploadFiles={() => picker.current?.click()}
            onUploadFolder={() => folder.current?.click()}
          />
          <IconButton
            tooltip
            label={composer.referencesDisabled ? 'Attach image' : 'Attach file'}
            icon='I117'
            onClick={() => picker.current?.click()}
          />
          {!composer.referencesDisabled && (
            <IconButton tooltip label='Skills' icon='I044' onClick={refs.insertSlash} />
          )}
          {settings?.plan && (
            <SegmentedControl
              label='Mode'
              options={[
                { value: 'build', label: 'Build' },
                { value: 'plan', label: 'Plan' },
              ]}
              value={settings.plan.active ? 'plan' : 'build'}
              onSelect={(value) => settings.plan?.onChange(value === 'plan')}
            />
          )}
        </div>
        <div className={styles.actions}>
          {settingsMenu}
          {composer.voice ? (
            <IconButton
              tooltip
              label={composer.voice.listening ? 'Stop voice input' : 'Voice input'}
              icon='I083'
              onClick={composer.voice.toggle}
            />
          ) : (
            <IconButton tooltip label='Voice input' icon='I083' disabled />
          )}
          {onStop ? (
            <IconButton
              tooltip
              label='Stop response'
              icon='I035'
              variant='solid'
              onClick={onStop}
            />
          ) : (
            <IconButton
              tooltip
              label='Send message'
              icon='I023'
              variant='solid'
              disabled={uploading || (!text.trim() && !files.length)}
              onClick={submit}
            />
          )}
        </div>
      </div>
      <input
        ref={picker}
        type='file'
        hidden
        multiple
        accept={composer.accept}
        onChange={(e) => {
          composer.addFiles(Array.from(e.currentTarget.files ?? []))
          e.currentTarget.value = ''
        }}
      />
      <input
        ref={(node) => {
          folder.current = node
          node?.setAttribute('webkitdirectory', '')
        }}
        type='file'
        hidden
        multiple
        onChange={(e) => {
          composer.addFiles(Array.from(e.currentTarget.files ?? []))
          e.currentTarget.value = ''
        }}
      />
    </div>
  )
}

interface ComposerSettingsMenuProps {
  settings: NonNullable<ComposerController['settings']>
}

function ComposerSettingsMenu({ settings }: ComposerSettingsMenuProps) {
  const { effort, model, fastMode } = settings
  const actions: MenuAction[] = []
  if (effort) {
    const [first, ...rest] = effort.options.map((option) => ({
      id: option.id,
      label: option.label,
      checked: option.id === effort.value,
      onSelect: () => effort.onChange(option.id),
    }))
    if (first) actions.push({ id: 'effort', label: 'Reasoning effort', children: [first, ...rest] })
  }
  if (model) {
    const [first, ...rest] = model.options.map((option) => ({
      id: option.id,
      label: option.label,
      checked: option.id === model.value,
      onSelect: () => model.onChange(option.id),
    }))
    if (first) actions.push({ id: 'model', label: 'Model', children: [first, ...rest] })
  }
  if (fastMode) {
    actions.push({
      id: 'fast',
      label: 'Fast mode',
      checked: fastMode.enabled,
      onSelect: () => fastMode.onChange(!fastMode.enabled),
    })
  }
  return actions.length ? <ActionMenu label='Model settings' icon='I069' actions={actions} /> : null
}
