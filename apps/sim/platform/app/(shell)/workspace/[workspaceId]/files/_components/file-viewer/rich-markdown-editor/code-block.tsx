'use client'

import { lazy, Suspense, useEffect, useState } from 'react'
import { CopyButton } from '@sim/emcn/button/copy-button'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { MermaidDiagram } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/mermaid-diagram'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/node-views.module.css'
import {
  ToolbarButton,
  ToolbarMenu,
} from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/toolbar'
import {
  DASHBOARD_EMBED_LANGUAGE,
  DIFF_EMBED_LANGUAGE,
  detectLanguage,
  MarkdownCodeBlock,
  useEditorEditable,
} from '@/platform/lib/data/files/markdown'

/** Kept out of the editor's bundle until a document holds a dashboard fence. */
const DashboardEmbed = lazy(() =>
  import(
    '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/dashboard-embed'
  ).then((module) => ({ default: module.DashboardEmbed }))
)

/** Kept out of the editor's bundle until a document holds a diff fence. */
const DiffEmbed = lazy(() =>
  import(
    '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/diff-embed'
  ).then((module) => ({ default: module.DiffEmbed }))
)

const PLAIN = 'plain'
const MERMAID = 'mermaid'

/** First-line keywords that open a Mermaid definition, so an untagged fence renders as a diagram. */
const MERMAID_OPENERS =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|zenuml|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/

function looksLikeMermaid(text: string): boolean {
  const firstLine = text.split('\n').find((line) => line.trim().length > 0)
  return firstLine !== undefined && MERMAID_OPENERS.test(firstLine.trim())
}

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
  const showRendered = isRendered && text.trim().length > 0 && !showSource
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
              <span className={styles.codeLanguage} data-type='T052'>
                {label}
              </span>
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
              if (!(target instanceof Element) || target.closest('button, input')) return
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
