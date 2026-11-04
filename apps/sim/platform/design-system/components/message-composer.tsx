'use client'

import { useRef, useState } from 'react'
import { generateId } from '@sim/utils/id'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { ActionMenu, type MenuAction } from '@/platform/design-system/components/action-menu'
import styles from '@/platform/design-system/components/composer.module.css'
import { useComposerDraft } from '@/platform/design-system/components/composer-drafts'
import { ComposerInput } from '@/platform/design-system/components/composer-input'
import { IconButton } from '@/platform/design-system/components/controls'
import { MessageAttachments } from '@/platform/design-system/components/message-attachments'
import { useCompactViewport } from '@/platform/design-system/components/use-compact-viewport'
import type {
  ChatAttachment,
  ComposerDraft,
  ConversationData,
} from '@/platform/design-system/models/conversation'

const GROUPS: readonly [string, IconName][] = [
  ['Chats', 'I073'],
  ['Dashboards', 'I025'],
  ['Tables', 'I033'],
  ['Files', 'I015'],
  ['Knowledge bases', 'I082'],
  ['Workflows', 'I118'],
  ['Logs', 'I075'],
]
interface MessageComposerProps {
  draftKey: string
  placeholder: string
  references?: ConversationData['references']
  initialAttachments?: ChatAttachment[]
  onSubmit: (draft: ComposerDraft) => void
  onStop?: () => void
}

function attachment(file: File): ChatAttachment {
  const image = file.type.startsWith('image/')
  const text = file.type.startsWith('text/')
  return {
    id: generateId(),
    name: file.name,
    kind: image ? 'image' : text ? 'text' : 'document',
    metadata: file.type || 'File',
    file,
  }
}

export function MessageComposer({
  draftKey,
  placeholder,
  references = [],
  initialAttachments = [],
  onSubmit,
  onStop,
}: MessageComposerProps) {
  const compact = useCompactViewport()
  const [{ text, attachments: files }, updateDraft] = useComposerDraft(draftKey, {
    text: '',
    attachments: initialAttachments,
  })
  const [slash, setSlash] = useState<'typed' | 'button' | null>(null)
  const [notice, setNotice] = useState('')
  const editor = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  function addFiles(items: File[]) {
    const added = items.map(attachment)
    updateDraft((draft) => ({ ...draft, attachments: [...draft.attachments, ...added] }))
  }
  function addReference(group: string, name: string) {
    const reference: ChatAttachment = { id: generateId(), kind: 'reference', name, metadata: group }
    updateDraft((draft) => ({
      text: draft.text === '/' ? '' : draft.text,
      attachments: [...draft.attachments, reference],
    }))
    requestAnimationFrame(() => editor.current?.focus())
  }
  const resources: MenuAction[] = GROUPS.map(([group, icon]) => {
    const items = references.find((item) => item.group === group)?.items ?? []
    const [first, ...rest] = items.map((item) => ({
      id: item.id,
      label: item.name,
      onSelect: () => addReference(group, item.name),
    }))
    return first
      ? { id: group, label: group, icon, children: [first, ...rest] }
      : {
          id: group,
          label: group,
          icon,
          onSelect: () => setNotice(`No ${group.toLowerCase()} available`),
        }
  })
  const upload: MenuAction[] = [
    { id: 'upload', label: 'Upload files', icon: 'I117', onSelect: () => picker.current?.click() },
    { id: 'folder', label: 'Upload folder', icon: 'I100', onSelect: () => folder.current?.click() },
  ]
  const tools: MenuAction[] = [
    {
      id: 'browser',
      label: 'Browser',
      icon: 'I041',
      separatorBefore: true,
      onSelect: () => addReference('Tool', 'Browser'),
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: 'I107',
      onSelect: () => addReference('Tool', 'Terminal'),
    },
  ]
  function submit() {
    if (!text.trim() && !files.length) return
    onSubmit({ text: text.trim(), attachments: files })
    updateDraft(() => ({ text: '', attachments: [] }))
    setNotice('')
  }
  return (
    <div
      className={styles.composer}
      data-material='reading'
      onKeyDownCapture={(event) => {
        if (
          slash !== 'typed' ||
          !(event.target instanceof HTMLElement) ||
          event.target.role !== 'menu'
        )
          return
        if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
          event.stopPropagation()
          editor.current?.focus()
          setSlash(null)
        }
      }}
    >
      <MessageAttachments
        items={files}
        onRemove={(id) =>
          updateDraft((draft) => ({
            ...draft,
            attachments: draft.attachments.filter((file) => file.id !== id),
          }))
        }
      />
      <ComposerInput
        density={compact ? 'compact' : 'standard'}
        label={placeholder}
        placeholder={placeholder}
        inputRef={editor}
        value={text}
        onValueChange={(value) => {
          updateDraft((draft) => ({ ...draft, text: value }))
          setSlash(value === '/' ? 'typed' : null)
        }}
        onSubmit={submit}
        onPasteFiles={addFiles}
        onPasteText={(value) => {
          const pasted: ChatAttachment = {
            id: generateId(),
            kind: 'text',
            name: 'Pasted text',
            metadata: `${value.length.toLocaleString()} characters`,
            content: value,
          }
          updateDraft((draft) => ({ ...draft, attachments: [...draft.attachments, pasted] }))
        }}
      />
      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <ActionMenu
            label='Add attachment'
            icon='I074'
            actions={[...upload, ...resources, ...tools]}
          />
          <ActionMenu
            label='Commands'
            icon='I044'
            open={Boolean(slash)}
            onOpenChange={(open) => setSlash(open ? 'button' : null)}
            actions={[...resources, ...tools]}
          />
        </div>
        <div className={styles.actions}>
          <IconButton label='Voice input unavailable' icon='I083' disabled />
          {onStop ? (
            <IconButton label='Stop response' icon='I035' variant='solid' onClick={onStop} />
          ) : (
            <IconButton
              label='Send message'
              icon='I023'
              variant='solid'
              disabled={!text.trim() && !files.length}
              onClick={submit}
            />
          )}
        </div>
      </div>
      {notice && (
        <span role='status' data-type='T052'>
          {notice}
        </span>
      )}
      <input
        ref={picker}
        type='file'
        hidden
        multiple
        onChange={(e) => {
          addFiles(Array.from(e.currentTarget.files ?? []))
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
          addFiles(Array.from(e.currentTarget.files ?? []))
          e.currentTarget.value = ''
        }}
      />
    </div>
  )
}
