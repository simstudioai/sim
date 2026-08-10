import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import remarkBreaks from 'remark-breaks'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import { Button, cn, handleKeyboardActivation, Tooltip } from '@sim/emcn'
import { ChevronsDownUp, Expand } from '@sim/emcn/icons'
import { getEmbedInfo } from '@sim/utils/media-embed'
import { BLOCK_DIMENSIONS, clampNoteBlockHeight, estimateNoteBlockHeight } from '../dimensions'
import { OverflowSpan } from '../lib/overflow-span'
import { useActionMenuSwell } from '../workflow-block/use-action-menu-swell'
import {
  WorkflowBlockBorder,
  type WorkflowBorderPort,
} from '../workflow-block/workflow-block-border'
import { DEFAULT_NOTE_COLOR, getNoteColorOption, type NoteColor } from './note-colors'

const EMBED_SCALE = 0.78
const EMBED_INVERSE_SCALE = `${(1 / EMBED_SCALE) * 100}%`
const ACTION_MENU_RIGHT_INSET_PX = 24
const ACTION_MENU_AMPLITUDE = 7
const EDIT_CLICK_TOLERANCE_PX = 4

type NoteEditingField = 'title' | 'content' | null

export interface NoteContentEditorProps {
  value: string
  selectionClassName: string
  onChange: (content: string) => void
  onBlur: () => void
  onCancel: () => void
}

interface EditPointerStart {
  field: Exclude<NoteEditingField, null>
  x: number
  y: number
}

interface NotePointerStart {
  x: number
  y: number
}

/**
 * Compact markdown renderer for note blocks with tight spacing
 */
const NOTE_REMARK_PLUGINS = [remarkBreaks]

const NOTE_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className='mb-1 break-words text-current text-sm leading-[1.25rem] last:mb-0'>{children}</p>
  ),
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className='mt-3 mb-3 break-words font-semibold text-current text-lg first:mt-0'>
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className='mt-2.5 mb-2.5 break-words font-semibold text-base text-current first:mt-0'>
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className='mt-2 mb-2 break-words font-semibold text-current text-sm first:mt-0'>
      {children}
    </h3>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <h4 className='mt-2 mb-2 break-words font-semibold text-current text-xs first:mt-0'>
      {children}
    </h4>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className='mt-1 mb-1 list-disc space-y-1 break-words pl-6 text-current text-sm'>
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className='mt-1 mb-1 list-decimal space-y-1 break-words pl-6 text-current text-sm'>
      {children}
    </ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className='break-words'>{children}</li>,
  inlineCode: ({ children }: { children?: ReactNode }) => (
    <code className='whitespace-normal rounded bg-black/10 px-1 py-0.5 font-mono text-current text-xs'>
      {children}
    </code>
  ),
  code: ({ children, className, ...props }: { children?: ReactNode; className?: string }) => (
    <code
      {...props}
      className='block whitespace-pre-wrap break-words rounded bg-black/15 p-2 text-current text-xs'
    >
      {children}
    </code>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    const embedInfo = href ? getEmbedInfo(href) : null
    if (embedInfo) {
      return (
        <span className='my-2 block w-full'>
          <a
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            className='mb-1 block break-all font-medium text-current underline underline-offset-2 opacity-90 hover-hover:opacity-100'
          >
            {children}
          </a>
          <span className='block w-full overflow-hidden rounded-md'>
            {embedInfo.type === 'iframe' && (
              <span
                className='block overflow-hidden'
                style={{
                  width: '100%',
                  aspectRatio: embedInfo.aspectRatio || '16/9',
                }}
              >
                <iframe
                  src={embedInfo.url}
                  title='Media'
                  allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                  allowFullScreen
                  loading='lazy'
                  className='origin-top-left'
                  style={{
                    width: EMBED_INVERSE_SCALE,
                    height: EMBED_INVERSE_SCALE,
                    transform: `scale(${EMBED_SCALE})`,
                  }}
                />
              </span>
            )}
            {embedInfo.type === 'video' && (
              <video
                src={embedInfo.url}
                controls
                preload='metadata'
                className='aspect-video w-full'
              >
                <track kind='captions' src='' default />
              </video>
            )}
            {embedInfo.type === 'audio' && (
              <audio src={embedInfo.url} controls preload='metadata' className='w-full'>
                <track kind='captions' src='' default />
              </audio>
            )}
          </span>
        </span>
      )
    }
    return (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='break-all font-medium text-current underline underline-offset-2 opacity-90 hover-hover:opacity-100'
      >
        {children}
      </a>
    )
  },
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className='break-words font-semibold text-current'>{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className='break-words text-current opacity-80'>{children}</em>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className='my-4 break-words border-current/25 border-l-2 pl-4 text-current italic [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-2'>
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className='my-2 max-w-full overflow-x-auto'>
      <table className='w-full border-collapse text-xs'>{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className='border-current/20 border-b'>{children}</thead>
  ),
  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className='border-current/20 border-b last:border-b-0'>{children}</tr>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className='px-2 py-1 text-left font-semibold text-current'>{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className='px-2 py-1 text-current opacity-90'>{children}</td>
  ),
}

const NoteMarkdown = memo(function NoteMarkdown({ content }: { content: string }) {
  return (
    <Streamdown mode='static' remarkPlugins={NOTE_REMARK_PLUGINS} components={NOTE_COMPONENTS}>
      {content}
    </Streamdown>
  )
})

/**
 * Props for the pure note renderer. The container resolves the markdown content
 * (from the block's subblock value), enabled/ring visual state, and the select
 * handler; the editor-only action bar is injected via the `actionBar` slot.
 */
export interface NoteBlockViewProps {
  name?: string
  /** Markdown content; an empty string renders the placeholder. */
  content: string
  noteColor?: NoteColor
  isEnabled: boolean
  isFocused: boolean
  isExpanded?: boolean
  canEdit?: boolean
  hasRing: boolean
  ringStyles: string
  /** Notifies the host while keeping Note selection out of the side editor. */
  onSelect: () => void
  /** Persists an inline title edit and reports whether validation succeeded. */
  onNameChange?: (name: string) => boolean
  /** Persists inline note content as the user types. */
  onContentChange?: (content: string) => void
  /** Publishes the measured, clamped canvas height to the editor container. */
  onHeightChange?: (height: number) => void
  onExpandedChange?: (expanded: boolean) => void
  /** Renders a WYSIWYG markdown editor supplied by the host application. */
  renderContentEditor?: (props: NoteContentEditorProps) => ReactNode
  /** Editor-only action bar; omit in read-only / preview contexts. */
  actionBar?: ReactNode
}

/**
 * Pure renderer for a canvas Note card with a title and markdown body. Compact
 * Notes remain draggable; expanded Notes provide stable inline editing without
 * store, socket, or permission coupling.
 */
export function NoteBlockView({
  name,
  content,
  noteColor = DEFAULT_NOTE_COLOR,
  isEnabled,
  isFocused,
  isExpanded = false,
  canEdit = false,
  hasRing,
  ringStyles,
  onSelect,
  onNameChange,
  onContentChange,
  onHeightChange,
  onExpandedChange,
  renderContentEditor,
  actionBar,
}: NoteBlockViewProps) {
  const colorOption = getNoteColorOption(noteColor)
  const showActionMenu = Boolean(actionBar)
  const noteLayoutRef = useRef<HTMLDivElement>(null)
  const scrollRegionRef = useRef<HTMLElement>(null)
  const contentMeasureRef = useRef<HTMLDivElement>(null)
  const contentEditorRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const contentInputRef = useRef<HTMLTextAreaElement>(null)
  const editPointerStartRef = useRef<EditPointerStart>(null)
  const notePointerStartRef = useRef<NotePointerStart>(null)
  const expandedAnchorHeightRef = useRef(estimateNoteBlockHeight(content))
  const [editingField, setEditingField] = useState<NoteEditingField>(null)
  const [draftName, setDraftName] = useState(name ?? '')
  const [draftContent, setDraftContent] = useState(content)
  const [compactHeight, setCompactHeight] = useState(() => estimateNoteBlockHeight(content))
  const [isHovered, setIsHovered] = useState(false)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const activeContent = editingField === 'content' ? draftContent : content
  const isEmpty = activeContent.trim().length === 0
  const hasVisualFocus = isFocused || isExpanded
  const isInlineEditable = isExpanded && canEdit
  const hasCustomContentEditor = Boolean(renderContentEditor)
  const blockWidth = isExpanded ? BLOCK_DIMENSIONS.NOTE_EXPANDED_WIDTH : BLOCK_DIMENSIONS.NOTE_WIDTH
  const blockHeight = isExpanded ? BLOCK_DIMENSIONS.NOTE_EXPANDED_HEIGHT : compactHeight
  if (!isExpanded) expandedAnchorHeightRef.current = compactHeight
  const layoutHeight = isExpanded ? expandedAnchorHeightRef.current : compactHeight
  const isContentScrollable = canScrollUp || canScrollDown

  useEffect(() => {
    if (!isInlineEditable) setEditingField(null)
  }, [isInlineEditable])

  useEffect(() => {
    if (!isExpanded || !onExpandedChange) return

    const handleCanvasPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return
      if (noteLayoutRef.current?.contains(event.target)) return
      if (!event.target.closest('.react-flow__pane, .react-flow__node')) return

      onExpandedChange(false)
    }

    document.addEventListener('pointerdown', handleCanvasPointerDown, true)
    return () => document.removeEventListener('pointerdown', handleCanvasPointerDown, true)
  }, [isExpanded, onExpandedChange])

  useEffect(() => {
    if (editingField === 'title') {
      const input = titleInputRef.current
      input?.focus()
      input?.setSelectionRange(input.value.length, input.value.length)
      return
    }
    if (editingField === 'content') {
      const input = contentInputRef.current
      input?.focus()
      input?.setSelectionRange(input.value.length, input.value.length)
    }
  }, [editingField])

  function startEditing(
    event: ReactMouseEvent<HTMLElement>,
    field: Exclude<NoteEditingField, null>
  ) {
    event.stopPropagation()
    if (!isInlineEditable) return

    const pointerStart = editPointerStartRef.current
    editPointerStartRef.current = null
    const isKeyboardActivation = event.detail === 0
    const isIntentionalClick =
      pointerStart?.field === field &&
      Math.abs(event.clientX - pointerStart.x) <= EDIT_CLICK_TOLERANCE_PX &&
      Math.abs(event.clientY - pointerStart.y) <= EDIT_CLICK_TOLERANCE_PX
    if (!isKeyboardActivation && !isIntentionalClick) return

    if (field === 'title') setDraftName(name ?? '')
    if (field === 'content') setDraftContent(content)
    setEditingField(field)
  }

  function recordEditPointerStart(
    event: ReactPointerEvent<HTMLElement>,
    field: Exclude<NoteEditingField, null>
  ) {
    editPointerStartRef.current = {
      field,
      x: event.clientX,
      y: event.clientY,
    }
  }

  function recordNotePointerStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (!hasVisualFocus || isExpanded || !canEdit || event.button !== 0) return
    notePointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    }
  }

  function handleNoteClick(event: ReactMouseEvent<HTMLDivElement>) {
    const pointerStart = notePointerStartRef.current
    notePointerStartRef.current = null

    if (!hasVisualFocus) {
      onSelect()
      return
    }

    if (!isExpanded && canEdit && onExpandedChange) {
      const isKeyboardActivation = event.detail === 0
      const isIntentionalClick =
        pointerStart !== null &&
        Math.abs(event.clientX - pointerStart.x) <= EDIT_CLICK_TOLERANCE_PX &&
        Math.abs(event.clientY - pointerStart.y) <= EDIT_CLICK_TOLERANCE_PX
      if (isKeyboardActivation || isIntentionalClick) {
        onExpandedChange(true)
        return
      }
    }

    onSelect()
  }

  function finishTitleEditing() {
    const currentName = name ?? ''
    const nextName = draftName.trim()
    if (nextName !== currentName) {
      const didSave = onNameChange?.(nextName) ?? false
      if (!didSave) setDraftName(currentName)
    }
    setEditingField(null)
  }

  function cancelTitleEditing() {
    setDraftName(name ?? '')
    setEditingField(null)
  }
  const updateScrollFades = useCallback(() => {
    const scrollRegion = scrollRegionRef.current
    if (!scrollRegion) return
    const maxScrollTop = Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight)
    setCanScrollUp(scrollRegion.scrollTop > 1)
    setCanScrollDown(scrollRegion.scrollTop < maxScrollTop - 1)
  }, [])
  const setScrollRegion = useCallback(
    (node: HTMLElement | null) => {
      scrollRegionRef.current = node
      updateScrollFades()
    },
    [updateScrollFades]
  )

  const measureBlockHeight = useCallback(() => {
    let contentHeight =
      BLOCK_DIMENSIONS.NOTE_CONTENT_PADDING + BLOCK_DIMENSIONS.NOTE_MIN_CONTENT_HEIGHT

    if (!isEmpty) {
      if (editingField === 'content' && contentInputRef.current) {
        const input = contentInputRef.current
        const previousHeight = input.style.height
        input.style.height = '0px'
        const measuredHeight = input.scrollHeight
        contentHeight =
          measuredHeight > 0
            ? measuredHeight
            : estimateNoteBlockHeight(activeContent) - BLOCK_DIMENSIONS.HEADER_HEIGHT
        input.style.height = previousHeight
      } else if (editingField === 'content' && contentEditorRef.current) {
        const measuredHeight = contentEditorRef.current.scrollHeight
        contentHeight =
          measuredHeight > 0
            ? measuredHeight
            : estimateNoteBlockHeight(activeContent) - BLOCK_DIMENSIONS.HEADER_HEIGHT
      } else if (contentMeasureRef.current) {
        const measuredHeight = contentMeasureRef.current.scrollHeight
        contentHeight =
          measuredHeight > 0
            ? measuredHeight
            : estimateNoteBlockHeight(activeContent) - BLOCK_DIMENSIONS.HEADER_HEIGHT
      } else {
        contentHeight = estimateNoteBlockHeight(activeContent) - BLOCK_DIMENSIONS.HEADER_HEIGHT
      }
    }

    const nextCompactHeight = clampNoteBlockHeight(contentHeight)
    setCompactHeight((currentHeight) =>
      currentHeight === nextCompactHeight ? currentHeight : nextCompactHeight
    )
    onHeightChange?.(nextCompactHeight)
  }, [activeContent, editingField, isEmpty, onHeightChange])

  useLayoutEffect(() => {
    measureBlockHeight()
  }, [measureBlockHeight])

  useEffect(() => {
    if (editingField === 'content' || !contentMeasureRef.current) return
    const observer = new ResizeObserver(measureBlockHeight)
    observer.observe(contentMeasureRef.current)
    return () => observer.disconnect()
  }, [editingField, measureBlockHeight])

  useEffect(() => {
    if (!hasVisualFocus && scrollRegionRef.current) {
      scrollRegionRef.current.scrollTop = 0
    }
    updateScrollFades()
  }, [content, editingField, hasVisualFocus, updateScrollFades])

  const {
    rootRef: actionMenuRootRef,
    hostRef: actionMenuHostRef,
    width: actionMenuWidth,
    swellOpen: actionMenuSwellOpen,
    contentVisible: actionMenuContentVisible,
    setReady: setActionMenuSwellReady,
    onFocusCapture: handleActionMenuFocus,
    onBlurCapture: handleActionMenuBlur,
  } = useActionMenuSwell({
    enabled: showActionMenu,
    forceOpen: hasVisualFocus,
    maxWidth: blockWidth - ACTION_MENU_RIGHT_INSET_PX * 2,
  })
  const borderPorts = useMemo<WorkflowBorderPort[]>(
    () =>
      showActionMenu
        ? [
            {
              id: 'action-menu',
              side: 'top',
              position: { fromEnd: ACTION_MENU_RIGHT_INSET_PX + actionMenuWidth / 2 },
              plateau: actionMenuWidth,
              restAmplitude: actionMenuSwellOpen ? ACTION_MENU_AMPLITUDE : 0,
              hoverAmplitude: ACTION_MENU_AMPLITUDE,
              magnetizable: false,
            },
          ]
        : [],
    [actionMenuSwellOpen, actionMenuWidth, showActionMenu]
  )

  return (
    <div
      ref={noteLayoutRef}
      data-note-layout=''
      className='relative w-[320px]'
      style={{ height: layoutHeight }}
    >
      <div
        ref={actionMenuRootRef}
        className='group -translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2'
        data-action-menu-ready={actionMenuContentVisible ? '' : undefined}
        data-node-selected={hasVisualFocus ? '' : undefined}
        data-note-expanded={isExpanded ? '' : undefined}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
      >
        {showActionMenu && (
          <>
            <div
              aria-hidden='true'
              data-workflow-action-bar-bridge=''
              className='-top-[28px] pointer-events-auto absolute inset-x-0 z-10 h-[28px]'
            />
            <div
              ref={actionMenuHostRef}
              onFocusCapture={handleActionMenuFocus}
              onBlurCapture={handleActionMenuBlur}
            >
              {actionBar}
            </div>
          </>
        )}
        <div
          data-note-card=''
          role={isInlineEditable ? undefined : 'button'}
          tabIndex={isInlineEditable ? -1 : 0}
          className={cn(
            'relative z-20 select-none rounded-2xl transition-[color,width,height] [transition-duration:150ms,280ms,280ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
            isExpanded
              ? 'nodrag w-[520px] cursor-default'
              : [
                  'note-drag-handle w-[320px] [&:active]:cursor-grabbing',
                  hasVisualFocus ? 'cursor-text' : 'cursor-grab',
                ],
            colorOption.textClassName
          )}
          style={{ height: blockHeight }}
          onPointerDown={recordNotePointerStart}
          onClick={handleNoteClick}
          onTransitionEnd={updateScrollFades}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget) {
              handleKeyboardActivation(event, () => {
                if (hasVisualFocus && !isExpanded && canEdit && onExpandedChange) {
                  onExpandedChange(true)
                  return
                }
                onSelect()
              })
            }
          }}
        >
          <WorkflowBlockBorder
            ports={borderPorts}
            cursorSwellEnabled={false}
            hasRing={hasRing}
            ringStyles={ringStyles}
            isSelected={hasVisualFocus}
            selectedSilhouetteColor={colorOption.selectedSilhouetteColor}
            silhouetteColorOverride={
              !hasVisualFocus && isHovered ? colorOption.hoverSilhouetteColor : undefined
            }
            bodyFill={colorOption.fill}
            width={blockWidth}
            initialHeight={blockHeight}
            onActionMenuReadyChange={setActionMenuSwellReady}
          />

          <div className='relative z-10 flex h-10 items-center justify-between px-2'>
            <div className='flex min-w-0 flex-1 items-center transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]'>
              {editingField === 'title' ? (
                <input
                  ref={titleInputRef}
                  aria-label='Note title'
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={finishTitleEditing}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      finishTitleEditing()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelTitleEditing()
                    }
                  }}
                  className={cn(
                    'nodrag nopan nowheel h-7 w-full min-w-0 select-text border-none bg-transparent px-0 text-current text-md caret-current outline-none focus-visible:outline-none',
                    colorOption.selectionClassName,
                    !isEnabled && 'opacity-50'
                  )}
                />
              ) : isInlineEditable ? (
                <button
                  type='button'
                  aria-label='Edit note title'
                  onPointerDown={(event) => recordEditPointerStart(event, 'title')}
                  onClick={(event) => startEditing(event, 'title')}
                  className={cn(
                    'min-w-0 flex-1 cursor-text rounded-sm bg-transparent text-left outline-offset-1 focus-visible:outline-2 focus-visible:outline-current/50',
                    !isEnabled && 'opacity-50'
                  )}
                >
                  <OverflowSpan value={name ?? ''} className='truncate text-current text-md' />
                </button>
              ) : (
                <OverflowSpan
                  value={name ?? ''}
                  className={cn('truncate text-current text-md', !isEnabled && 'opacity-50')}
                />
              )}
            </div>
            {canEdit && onExpandedChange && (
              <Tooltip.Root preferAbove>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    aria-label={isExpanded ? 'Collapse note' : 'Expand note'}
                    aria-pressed={isExpanded}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      onExpandedChange(!isExpanded)
                    }}
                    className='nodrag nopan nowheel pointer-events-none ml-1 size-[24px] shrink-0 rounded-md border-none bg-transparent p-0 text-current opacity-0 transition-[background-color,color,opacity,transform] duration-150 hover-hover:bg-current/10 hover-hover:opacity-100 active:scale-[0.96] group-hover:pointer-events-auto group-hover:opacity-70 group-data-[node-selected]:pointer-events-auto group-data-[node-selected]:opacity-70'
                  >
                    <span className='relative size-[14px]'>
                      <Expand
                        className={cn(
                          'absolute inset-0 size-[14px] transition-[opacity,scale,filter] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                          isExpanded
                            ? 'scale-[0.25] opacity-0 blur-[4px]'
                            : 'scale-100 opacity-100 blur-0'
                        )}
                      />
                      <ChevronsDownUp
                        className={cn(
                          'absolute inset-0 size-[14px] transition-[opacity,scale,filter] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                          isExpanded
                            ? 'scale-100 opacity-100 blur-0'
                            : 'scale-[0.25] opacity-0 blur-[4px]'
                        )}
                      />
                    </span>
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='right'>
                  {isExpanded ? 'Collapse note' : 'Expand note'}
                </Tooltip.Content>
              </Tooltip.Root>
            )}
          </div>

          <div
            ref={setScrollRegion}
            data-note-scroll-region=''
            role='region'
            aria-label={`${name || 'Note'} content`}
            tabIndex={hasVisualFocus && !canEdit && !isEmpty ? 0 : -1}
            onScroll={updateScrollFades}
            className={cn(
              'scrollbar-none relative z-10 h-[calc(100%_-_40px)] max-w-full overflow-x-hidden break-words px-2 pt-0 pb-0 text-current [contain:layout]',
              isContentScrollable &&
                editingField !== 'content' &&
                'nowheel allow-scroll touch-pan-y',
              !isEmpty && editingField !== 'content' && 'overflow-y-auto',
              editingField === 'content' &&
                (hasCustomContentEditor
                  ? 'nowheel allow-scroll touch-pan-y overflow-y-auto'
                  : 'overflow-hidden'),
              editingField !== 'content' &&
                canScrollUp &&
                canScrollDown && [
                  '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0px,black_12px,black_calc(100%_-_12px),transparent_100%)]',
                  '[mask-image:linear-gradient(to_bottom,transparent_0px,black_12px,black_calc(100%_-_12px),transparent_100%)]',
                ],
              editingField !== 'content' &&
                canScrollUp &&
                !canScrollDown && [
                  '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0px,black_12px)]',
                  '[mask-image:linear-gradient(to_bottom,transparent_0px,black_12px)]',
                ],
              editingField !== 'content' &&
                !canScrollUp &&
                canScrollDown && [
                  '[-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%_-_12px),transparent_100%)]',
                  '[mask-image:linear-gradient(to_bottom,black_calc(100%_-_12px),transparent_100%)]',
                ],
              !isEnabled && 'opacity-50'
            )}
          >
            {editingField === 'content' && renderContentEditor ? (
              <div
                ref={contentEditorRef}
                className='nodrag nopan nowheel min-h-full w-full'
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {renderContentEditor({
                  value: draftContent,
                  selectionClassName: colorOption.selectionClassName,
                  onChange: (nextContent) => {
                    setDraftContent(nextContent)
                    onContentChange?.(nextContent)
                  },
                  onBlur: () => setEditingField(null),
                  onCancel: () => setEditingField(null),
                })}
              </div>
            ) : editingField === 'content' ? (
              <textarea
                ref={contentInputRef}
                aria-label='Note content'
                placeholder='Add note…'
                value={draftContent}
                onChange={(event) => {
                  const nextContent = event.target.value
                  setDraftContent(nextContent)
                  onContentChange?.(nextContent)
                }}
                onBlur={() => setEditingField(null)}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' || (event.key === 'Enter' && event.metaKey)) {
                    event.preventDefault()
                    setEditingField(null)
                  }
                }}
                className={cn(
                  'nodrag nopan nowheel scrollbar-none h-full w-full select-text resize-none border-none bg-transparent px-0 pt-0.5 pb-2 text-current text-sm leading-[1.25rem] caret-current outline-none focus-visible:outline-none',
                  colorOption.inputPlaceholderClassName,
                  colorOption.selectionClassName
                )}
              />
            ) : (
              <>
                {isInlineEditable && (
                  <button
                    type='button'
                    aria-label='Edit note content'
                    onPointerDown={(event) => recordEditPointerStart(event, 'content')}
                    onClick={(event) => startEditing(event, 'content')}
                    className='absolute inset-0 z-20 w-full cursor-text rounded-sm bg-transparent outline-offset-1 focus-visible:outline-2 focus-visible:outline-current/50'
                  />
                )}
                <div
                  ref={contentMeasureRef}
                  className={cn(
                    'relative max-w-full pt-0.5 pb-2',
                    !isExpanded && 'pointer-events-none'
                  )}
                >
                  {isEmpty ? (
                    <p className={cn('text-sm', colorOption.placeholderClassName)}>Add note…</p>
                  ) : (
                    <NoteMarkdown content={content} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
