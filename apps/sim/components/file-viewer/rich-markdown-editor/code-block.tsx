'use client'

import { lazy, Suspense, useContext, useEffect, useState } from 'react'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { StatusTag } from '@sim/emcn/status'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { looksLikeMermaid, MermaidDiagram } from '@/components/file-viewer/mermaid-diagram'
import { MarkdownCodeBlock } from '@/components/file-viewer/rich-markdown-editor/code-block-schema'
import { detectLanguage } from '@/components/file-viewer/rich-markdown-editor/detect-language'
import { MarkdownStreamingContext } from '@/components/file-viewer/rich-markdown-editor/markdown-streaming-context'
import styles from '@/components/file-viewer/rich-markdown-editor/node-views.module.css'
import { ToolbarButton, ToolbarMenu } from '@/components/file-viewer/rich-markdown-editor/toolbar'
import { useEditorEditable } from '@/components/file-viewer/rich-markdown-editor/use-editor-editable'
import { DASHBOARD_EMBED_LANGUAGE } from '@/lib/dashboards/embed-language'
import { DIFF_EMBED_LANGUAGE } from '@/lib/diff/embed-language'

/** Kept out of the editor's bundle until a document holds a dashboard fence. */
const DashboardEmbed = lazy(() =>
  import('@/components/file-viewer/rich-markdown-editor/dashboard-embed').then((module) => ({
    default: module.DashboardEmbed,
  }))
)

/** Kept out of the editor's bundle until a document holds a diff fence. */
const DiffEmbed = lazy(() =>
  import('@/components/file-viewer/rich-markdown-editor/diff-embed').then((module) => ({
    default: module.DiffEmbed,
  }))
)

const PLAIN = 'plain'
const MERMAID = 'mermaid'

/** Languages the Prism highlighter registers; every non-plain value has a grammar. */
const LANGUAGE_OPTIONS = [
  { value: PLAIN, label: 'Plain text' },
  { value: 'bash', label: 'Bash' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'css', label: 'CSS' },
  { value: 'go', label: 'Go' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'markup', label: 'HTML' },
  { value: 'php', label: 'PHP' },
  { value: 'python', label: 'Python' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'sql', label: 'SQL' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'yaml', label: 'YAML' },
] as const

/**
 * A code block with hover controls: language, line wrap and copy. Mermaid renders as its diagram
 * whenever the caret is outside the block (always when read-only) and as editable source while the
 * caret is inside; the source stays mounted so the node is still an ordinary code block. A
 * ```dashboard fence renders live panels and a ```diff fence its changes the same way.
 */
function CodeBlockView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const [wrap, setWrap] = useState(() => node.attrs.language === DIFF_EMBED_LANGUAGE)
  const [editingInline, setEditingInline] = useState(false)
  const [peekSource, setPeekSource] = useState(false)
  const editable = useEditorEditable(editor)
  const isStreaming = useContext(MarkdownStreamingContext)

  const explicitLanguage = node.attrs.language as string | null
  const text = node.textContent
  const isMermaid = explicitLanguage === MERMAID || (!explicitLanguage && looksLikeMermaid(text))
  const isDashboard = explicitLanguage === DASHBOARD_EMBED_LANGUAGE
  const isDiff = explicitLanguage === DIFF_EMBED_LANGUAGE
  const isRendered = isMermaid || isDashboard || isDiff

  useEffect(() => {
    if (!isRendered || !editable) {
      setEditingInline(false)
      return
    }
    const sync = () => {
      const pos = typeof getPos === 'function' ? getPos() : null
      if (typeof pos !== 'number') {
        setEditingInline(false)
        return
      }
      const size = editor.state.doc.nodeAt(pos)?.nodeSize ?? 0
      const { from } = editor.state.selection
      setEditingInline(editor.isFocused && from > pos && from < pos + size)
    }
    sync()
    editor.on('selectionUpdate', sync)
    editor.on('focus', sync)
    editor.on('blur', sync)
    return () => {
      editor.off('selectionUpdate', sync)
      editor.off('focus', sync)
      editor.off('blur', sync)
    }
  }, [editor, getPos, isRendered, editable])

  const showSource = editable ? editingInline : peekSource
  /** A dashboard or diff waits for its whole fence: a partial spec mid-stream would render broken. */
  const deferEmbed = isStreaming && (isDashboard || isDiff)
  const showRendered = isRendered && text.trim().length > 0 && !showSource && !deferEmbed
  const language = explicitLanguage ?? (isRendered ? null : detectLanguage(text)) ?? PLAIN
  const label =
    LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ??
    explicitLanguage ??
    'Plain text'

  const toggleSource = () => {
    if (!editable) {
      setPeekSource((value) => !value)
      return
    }
    const pos = typeof getPos === 'function' ? getPos() : null
    if (typeof pos !== 'number') return
    if (editingInline) {
      editor.commands.setNodeSelection(pos)
      return
    }
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .run()
  }

  return (
    <NodeViewWrapper>
      <div className={styles.codeBlock} data-source-open={(isRendered && showSource) || undefined}>
        <div className={styles.codeControls} contentEditable={false}>
          {isRendered && (
            <ToolbarButton
              label={
                showSource
                  ? isDashboard
                    ? 'Show dashboard'
                    : isDiff
                      ? 'Show diff'
                      : 'Show diagram'
                  : 'Show source'
              }
              onClick={toggleSource}
            />
          )}
          {!isRendered &&
            (editable ? (
              <ToolbarMenu
                label='Code language'
                triggerText={label}
                actions={LANGUAGE_OPTIONS.map((option) => ({
                  id: option.value,
                  label: option.label,
                  checked: option.value === language,
                  onSelect: () =>
                    updateAttributes({ language: option.value === PLAIN ? null : option.value }),
                }))}
              />
            ) : (
              <StatusTag label={label} />
            ))}
          {(isDiff || (!isRendered && editable)) && (
            <ToolbarButton label='Wrap' pressed={wrap} onClick={() => setWrap((value) => !value)} />
          )}
          <CopyButton label={isDiff ? 'Copy diff' : 'Copy code'} text={text} size='compact' />
        </div>
        <pre className={styles.codeSource} data-wrap={wrap} hidden={showRendered}>
          <NodeViewContent<'code'> as='code' />
        </pre>
        {showRendered && (
          <div
            className={isDiff || isDashboard ? styles.embed : styles.diagram}
            contentEditable={false}
            onMouseDown={(event) => {
              const target = event.target
              if (
                !(target instanceof Element) ||
                !event.currentTarget.contains(target) ||
                target.closest('button, input')
              )
                return
              event.preventDefault()
              const pos = typeof getPos === 'function' ? getPos() : null
              if (typeof pos === 'number') editor.commands.setNodeSelection(pos)
            }}
          >
            {isDashboard ? (
              <Suspense fallback={null}>
                <DashboardEmbed source={text} />
              </Suspense>
            ) : isDiff ? (
              <Suspense fallback={null}>
                <DiffEmbed source={text} wrapLines={wrap} />
              </Suspense>
            ) : (
              <MermaidDiagram definition={text} />
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

/**
 * The code block with its hover controls. `language` drives Prism highlighting and the fence's
 * info string on save; wrap is a view preference only.
 */
export const CodeBlockWithLanguage = MarkdownCodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
})
