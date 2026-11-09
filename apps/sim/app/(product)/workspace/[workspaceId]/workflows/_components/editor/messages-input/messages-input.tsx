'use client'

import { type MutableRefObject, useId, useImperativeHandle, useRef, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { generateShortId } from '@sim/utils/id'
import { isEqual } from 'es-toolkit'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { getActiveWorkflowSearchHighlight } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import {
  extractStreamingMessages,
  type Message,
  type MessageRole,
  messagesJson,
  parseMessages,
  toMessages,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/messages-input/messages'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/messages-input/messages-input.module.css'
import { ReferenceField } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field'
import type { WandControlHandlers } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/wand-control'
import {
  type SubBlockConfig,
  useAccessibleReferencePrefixes,
  useSubBlockInput,
  useSubBlockValue,
  useWand,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'

interface MessagesInputProps {
  blockId: string
  subBlockId: string
  config: SubBlockConfig
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  /** Lets the sub-block's label row stream an AI-written history into the messages. */
  wandControlRef?: MutableRefObject<WandControlHandlers | null>
}

/** The messages on screen, each with the stable key its row keeps while the list reorders. */
interface MessageRows {
  ids: string[]
  messages: Message[]
}

const DEFAULT_MESSAGES: Message[] = [{ role: 'user', content: '' }]

const ROLE_OPTIONS = [
  { label: 'System', value: 'system' },
  { label: 'User', value: 'user' },
  { label: 'Assistant', value: 'assistant' },
]

const withIds = (messages: Message[]): MessageRows => ({
  ids: messages.map(() => generateShortId()),
  messages,
})

/** Keeps the keys of rows that are still there, adding keys for rows that arrived. */
function fitIds(ids: string[], count: number): string[] {
  if (ids.length >= count) return ids.slice(0, count)
  return [...ids, ...Array.from({ length: count - ids.length }, () => generateShortId())]
}

function insertAt<Item>(items: Item[], index: number, item: Item): Item[] {
  return [...items.slice(0, index), item, ...items.slice(index)]
}

function swap<Item>(items: Item[], from: number, to: number): Item[] {
  const next = [...items]
  next[from] = items[to]
  next[to] = items[from]
  return next
}

/**
 * The Agent block's message history, stored as `[{ role, content }]`: each message picks its role
 * and takes references after `<` and secrets after `{{`; messages are added below, removed and
 * moved, and Tab steps between them. The AI prompt streams a whole history in, message by message.
 */
export function MessagesInput({
  blockId,
  subBlockId,
  config,
  isPreview = false,
  previewValue,
  disabled = false,
  wandControlRef,
}: MessagesInputProps) {
  const baseId = useId()
  const textareas = useRef<Map<string, HTMLTextAreaElement> | null>(null)
  textareas.current ??= new Map()
  const streamBuffer = useRef('')
  const activeSearchTarget = useActiveSearchTarget()
  const { workspaceId } = useWorkflowScope()
  const [stored, setStored] = useSubBlockValue<Message[]>(blockId, subBlockId, false)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const controller = useSubBlockInput({ blockId, subBlockId, config, isPreview, disabled })

  const storedMessages = toMessages(stored)
  const source =
    (isPreview ? toMessages(previewValue) : null) ??
    (storedMessages && storedMessages.length > 0 ? storedMessages : null)
  const [rows, setRows] = useState<MessageRows>(() => withIds(source ?? DEFAULT_MESSAGES))
  const [syncedSource, setSyncedSource] = useState(source)
  if (source !== syncedSource) {
    setSyncedSource(source)
    if (source && !isEqual(rows.messages, source)) setRows(withIds(source))
  }

  const wand = useWand({
    workspaceId,
    wandConfig: config.wandConfig,
    currentValue: messagesJson(rows.messages),
    onStreamStart: () => {
      streamBuffer.current = ''
      setRows(withIds([{ role: 'system', content: '' }]))
    },
    onStreamChunk: (chunk) => {
      streamBuffer.current += chunk
      const extracted = extractStreamingMessages(streamBuffer.current)
      if (extracted.length === 0) return
      setRows((prev) => ({ ids: fitIds(prev.ids, extracted.length), messages: extracted }))
    },
    onGeneratedContent: (content) => {
      const trimmed = content.trim()
      const next: Message[] | null =
        parseMessages(content) ?? (trimmed ? [{ role: 'system', content: trimmed }] : null)
      if (!next) return
      setRows(withIds(next))
      setStored(next)
    },
  })

  useImperativeHandle(
    wandControlRef,
    () => ({
      onWandTrigger: (prompt: string) => {
        wand.generateStream({ prompt })
      },
      isWandActive: wand.isPromptVisible,
      isWandStreaming: wand.isStreaming,
    }),
    [wand]
  )

  const isReadOnly = isPreview || disabled

  const commit = (next: MessageRows) => {
    if (isReadOnly) return
    setRows(next)
    setStored(next.messages)
  }

  const updateMessage = (index: number, patch: Partial<Message>) =>
    commit({
      ids: rows.ids,
      messages: rows.messages.map((message, at) =>
        at === index ? { ...message, ...patch } : message
      ),
    })

  const addMessageAfter = (index: number) =>
    commit({
      ids: insertAt(rows.ids, index + 1, generateShortId()),
      messages: insertAt(rows.messages, index + 1, { role: 'user', content: '' }),
    })

  const deleteMessage = (index: number) =>
    commit({
      ids: rows.ids.filter((_, at) => at !== index),
      messages: rows.messages.filter((_, at) => at !== index),
    })

  const moveMessage = (index: number, offset: number) => {
    const target = index + offset
    if (target < 0 || target >= rows.messages.length) return
    commit({ ids: swap(rows.ids, index, target), messages: swap(rows.messages, index, target) })
  }

  const textareaAt = (index: number) => {
    const id = rows.ids[index]
    return id === undefined ? undefined : textareas.current?.get(id)
  }

  return (
    <div className={styles.messages}>
      {rows.messages.map((message, index) => {
        const rowId = rows.ids[index] ?? `fallback-${index}`
        return (
          <div
            key={rowId}
            role='group'
            aria-label={`Message ${index + 1}`}
            className={styles.message}
          >
            <div
              className={styles.header}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('button, [role="menu"]')) return
                textareaAt(index)?.focus()
              }}
            >
              <span className={styles.role}>
                <ChoiceMenu
                  label='Message role'
                  options={ROLE_OPTIONS}
                  value={message.role}
                  onValueChange={(next) => updateMessage(index, { role: next as MessageRole })}
                  disabled={isReadOnly}
                />
              </span>
              {!isReadOnly && (
                <span className={styles.actions}>
                  {rows.messages.length > 1 && (
                    <>
                      <IconButton
                        label='Delete message'
                        icon='I105'
                        size='compact'
                        onClick={() => deleteMessage(index)}
                      />
                      <IconButton
                        label='Move message up'
                        icon='I023'
                        size='compact'
                        disabled={index === 0}
                        onClick={() => moveMessage(index, -1)}
                      />
                      <IconButton
                        label='Move message down'
                        icon='I102'
                        size='compact'
                        disabled={index === rows.messages.length - 1}
                        onClick={() => moveMessage(index, 1)}
                      />
                    </>
                  )}
                  <IconButton
                    label='Add message below'
                    icon='I074'
                    size='compact'
                    onClick={() => addMessageAfter(index)}
                  />
                </span>
              )}
            </div>
            <ReferenceField
              id={`${baseId}-${rowId}`}
              label={`Message ${index + 1} content`}
              blockId={blockId}
              value={message.content}
              onChange={(next) => updateMessage(index, { content: next })}
              controller={controller}
              fieldKey={`message-${index}`}
              secrets
              multiline
              placeholder='Enter message content…'
              disabled={isReadOnly}
              accessiblePrefixes={accessiblePrefixes}
              searchHighlight={getActiveWorkflowSearchHighlight({
                activeSearchTarget,
                subBlockId,
                valuePath: [index, 'content'],
              })}
              onKeyDown={(event) => {
                if (event.key !== 'Tab' || isReadOnly) return
                const next = textareaAt(index + (event.shiftKey ? -1 : 1))
                if (!next) return
                event.preventDefault()
                next.focus()
                next.setSelectionRange(next.value.length, next.value.length)
              }}
              fieldRef={(element) => {
                if (element instanceof HTMLTextAreaElement) textareas.current?.set(rowId, element)
                else textareas.current?.delete(rowId)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
