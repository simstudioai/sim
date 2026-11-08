'use client'

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { Switch } from '@sim/emcn/switch'
import { useNotificationTrayClearance } from '@/platform/app/(shell)/_components/notification-tray/tray-clearance'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]/_components/chunk-editor/chunk-editor.module.css'
import {
  type ChunkData,
  type DocumentData,
  readChunkContent,
  useAutosave,
  useCreateChunk,
  useUpdateChunk,
} from '@/platform/lib/data/knowledge'
import { getAccurateTokenCount, getTokenStrings } from '@/platform/lib/data/knowledge/tokens'
import { toast } from '@/platform/shared/toast'

/** The longest chunk the API accepts. */
const MAX_CHUNK_LENGTH = 10_000
const TOKEN_TINTS = 4
const VALIDATION_NOTICE = 'knowledge-chunk-validation'

export type ChunkSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * The box collapses to read its content height, which drops the scroll range to zero for a moment;
 * the scroller's offset is kept across the read so the reader's place holds.
 */
function syncHeight(textarea: HTMLTextAreaElement, scroller: HTMLElement) {
  const { scrollTop } = scroller
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
  scroller.scrollTop = scrollTop
}

interface ChunkEditorProps {
  mode: 'edit' | 'create'
  chunk?: ChunkData
  document: DocumentData
  knowledgeBaseId: string
  canEdit: boolean
  maxChunkSize?: number
  onDirtyChange: (dirty: boolean) => void
  onSaveStatusChange: (status: ChunkSaveStatus) => void
  /** Filled with this editor's save, for the page's Save button and Cmd+S. */
  saveRef: RefObject<(() => Promise<void>) | null>
  onCreated?: (chunkId: string) => void
}

/**
 * A chunk's content, edited in place. Edits save themselves 1.5 seconds after typing stops; a new
 * chunk is created on demand. The token count is exact, and Tokenizer colors each token in turn.
 * Returning to the tab re-reads the chunk, so an untouched draft takes someone else's change.
 */
export function ChunkEditor({
  mode,
  chunk,
  document: documentData,
  knowledgeBaseId,
  canEdit,
  maxChunkSize,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  onCreated,
}: ChunkEditorProps) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  /** The footer sits on the window's bottom edge, so the notification tray rises above its count. */
  const footer = useRef<HTMLDivElement | null>(null)
  useNotificationTrayClearance(footer)
  const scrollEdges = useScrollEdges<HTMLDivElement>('vertical', { viewport: scroller })
  const preservedScroll = useRef(0)
  const updateChunk = useUpdateChunk()
  const createChunk = useCreateChunk()
  const creating = mode === 'create'
  const connectorDocument = Boolean(documentData.connectorId)
  const initial = chunk?.content ?? ''
  const [content, setContent] = useState(creating ? '' : initial)
  const [savedContent, setSavedContent] = useState(initial)
  const [tokenizer, setTokenizer] = useState(false)
  const [hoveredToken, setHoveredToken] = useState<number | null>(null)
  const saved = useRef(initial)
  const latest = useRef(content)
  latest.current = content

  const chunkId = chunk?.id
  useEffect(() => {
    if (creating || !chunkId) return
    const controller = new AbortController()
    const reread = async () => {
      if (window.document.visibilityState !== 'visible') return
      const server = await readChunkContent(
        knowledgeBaseId,
        documentData.id,
        chunkId,
        controller.signal
      ).catch(() => null)
      if (server === null || server === saved.current) return
      const clean = latest.current === saved.current
      saved.current = server
      setSavedContent(server)
      if (clean) setContent(server)
    }
    window.document.addEventListener('visibilitychange', reread)
    return () => {
      window.document.removeEventListener('visibilitychange', reread)
      controller.abort()
    }
  }, [creating, chunkId, knowledgeBaseId, documentData.id])

  useEffect(() => {
    if (creating) textarea.current?.focus()
  }, [creating])

  async function save() {
    const trimmed = latest.current.trim()
    const fail = (message: string): never => {
      toast.error(message, { noticeId: VALIDATION_NOTICE })
      throw new Error(message)
    }
    if (trimmed.length === 0) fail('Content cannot be empty')
    if (trimmed.length > MAX_CHUNK_LENGTH)
      fail('Content exceeds maximum length (10,000 characters)')
    toast.dismiss(VALIDATION_NOTICE)
    if (creating) {
      const created = await createChunk.mutateAsync({
        knowledgeBaseId,
        documentId: documentData.id,
        content: trimmed,
        enabled: true,
      })
      onCreated?.(created.id)
      return
    }
    if (!chunkId) return
    const sent = latest.current
    await updateChunk.mutateAsync({
      knowledgeBaseId,
      documentId: documentData.id,
      chunkId,
      content: trimmed,
    })
    saved.current = sent
    setSavedContent(sent)
  }

  const autosave = useAutosave({
    content,
    savedContent,
    onSave: save,
    enabled: canEdit && !creating && !connectorDocument,
  })
  const dirty = creating ? content.trim().length > 0 : autosave.isDirty

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    onSaveStatusChange(autosave.saveStatus)
  }, [autosave.saveStatus, onSaveStatusChange])

  saveRef.current = creating ? save : autosave.saveImmediately
  useEffect(
    () => () => {
      saveRef.current = null
    },
    [saveRef]
  )

  useLayoutEffect(() => {
    if (textarea.current && scroller.current) syncHeight(textarea.current, scroller.current)
  }, [content, tokenizer])

  /** A width change re-wraps lines without changing the content, so the box measures again. */
  useLayoutEffect(() => {
    const box = textarea.current
    const view = scroller.current
    if (!box || !view) return
    const observer = new ResizeObserver(() => syncHeight(box, view))
    observer.observe(view)
    return () => observer.disconnect()
  }, [tokenizer])

  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = preservedScroll.current
  }, [tokenizer])

  const tokens = tokenizer && content ? getTokenStrings(content) : []
  const tokenCount = !content ? 0 : tokenizer ? tokens.length : getAccurateTokenCount(content)

  return (
    <div className={styles.editor}>
      <div ref={scrollEdges} className={styles.scroller}>
        {tokenizer ? (
          <div className={styles.page} data-type='T060'>
            {tokens.map((token, index) => (
              <span
                key={index}
                className={styles.token}
                data-tint={index % TOKEN_TINTS}
                onMouseEnter={() => setHoveredToken(index)}
                onMouseLeave={() => setHoveredToken(null)}
              >
                {token}
              </span>
            ))}
          </div>
        ) : (
          <textarea
            ref={textarea}
            className={styles.input}
            data-type='T060'
            aria-label='Chunk content'
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={
              creating
                ? 'Enter the content for this chunk…'
                : canEdit
                  ? 'Enter chunk content…'
                  : connectorDocument
                    ? 'This chunk is synced from a connector and cannot be edited'
                    : 'Read-only view'
            }
            readOnly={!canEdit}
            spellCheck={false}
          />
        )}
      </div>
      <div ref={footer} className={styles.footer}>
        <span className={styles.tokenizer}>
          <span className={styles.secondary} data-type='T052' aria-hidden='true'>
            Tokenizer
          </span>
          <Switch
            label='Tokenizer'
            checked={tokenizer}
            onCheckedChange={(next) => {
              preservedScroll.current = scroller.current?.scrollTop ?? 0
              setTokenizer(next)
            }}
          />
          {tokenizer && hoveredToken !== null && (
            <span className={styles.secondary} data-type='T052'>
              Token #{hoveredToken + 1}
            </span>
          )}
        </span>
        <span className={styles.secondary} data-type='T052'>
          {tokenCount.toLocaleString()}
          {maxChunkSize !== undefined && `/${maxChunkSize.toLocaleString()}`} tokens
        </span>
      </div>
    </div>
  )
}
