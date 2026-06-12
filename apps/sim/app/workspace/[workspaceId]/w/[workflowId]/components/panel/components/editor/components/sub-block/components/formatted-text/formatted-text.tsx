import type { ReactNode } from 'react'
import { splitReferenceSegment } from '@/lib/workflows/sanitization/references'
import type { WorkflowSearchRange } from '@/lib/workflows/search-replace/types'
import { WORKFLOW_SEARCH_HIGHLIGHT_CLASS } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/constants'
import { normalizeName, REFERENCE } from '@/executor/constants'
import { createCombinedPattern } from '@/executor/utils/reference-validation'

export interface WorkflowSearchTextHighlight {
  range?: WorkflowSearchRange
  rawValue?: string
}

export interface HighlightContext {
  accessiblePrefixes?: Set<string>
  availableEnvVars?: Set<string>
  highlightAll?: boolean
  workflowSearchHighlight?: WorkflowSearchTextHighlight | null
}

const SYSTEM_PREFIXES = new Set(['loop', 'parallel', 'variable'])

export function getValidWorkflowSearchRange(
  text: string,
  highlight?: WorkflowSearchTextHighlight | null
): WorkflowSearchRange | null {
  const range = highlight?.range
  if (!range || !highlight?.rawValue) return null
  if (range.start < 0 || range.end <= range.start || range.end > text.length) return null
  return text.slice(range.start, range.end) === highlight.rawValue ? range : null
}

function withoutWorkflowSearchHighlight(context?: HighlightContext): HighlightContext | undefined {
  if (!context?.workflowSearchHighlight) return context
  return {
    ...context,
    workflowSearchHighlight: undefined,
  }
}

function formatDisplayTextInternal(
  text: string,
  context: HighlightContext | undefined,
  keyPrefix: string
): ReactNode[] {
  if (!text) return []

  const workflowSearchRange = getValidWorkflowSearchRange(text, context?.workflowSearchHighlight)
  if (workflowSearchRange) {
    const baseContext = withoutWorkflowSearchHighlight(context)
    return [
      ...formatDisplayTextInternal(
        text.slice(0, workflowSearchRange.start),
        baseContext,
        `${keyPrefix}before-`
      ),
      <mark key={`${keyPrefix}workflow-search`} className={WORKFLOW_SEARCH_HIGHLIGHT_CLASS}>
        {formatDisplayTextInternal(
          text.slice(workflowSearchRange.start, workflowSearchRange.end),
          baseContext,
          `${keyPrefix}match-`
        )}
      </mark>,
      ...formatDisplayTextInternal(
        text.slice(workflowSearchRange.end),
        baseContext,
        `${keyPrefix}after-`
      ),
    ]
  }

  const shouldHighlightReference = (reference: string): boolean => {
    if (!reference.startsWith('<') || !reference.endsWith('>')) {
      return false
    }

    if (context?.highlightAll) {
      return true
    }

    const inner = reference.slice(1, -1)
    const [prefix] = inner.split('.')
    const normalizedPrefix = normalizeName(prefix)

    if (SYSTEM_PREFIXES.has(normalizedPrefix)) {
      return true
    }

    if (context?.accessiblePrefixes?.has(normalizedPrefix)) {
      return true
    }

    return false
  }

  const shouldHighlightEnvVar = (varName: string): boolean => {
    if (context?.highlightAll) {
      return true
    }
    if (context?.availableEnvVars === undefined) {
      return true
    }
    return context.availableEnvVars.has(varName)
  }

  const nodes: ReactNode[] = []
  const regex = createCombinedPattern()
  let lastIndex = 0
  let key = 0

  const pushPlainText = (value: string) => {
    if (!value) return
    nodes.push(<span key={`${keyPrefix}${key++}`}>{value}</span>)
  }

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const matchText = match[0]
    const index = match.index

    if (index > lastIndex) {
      pushPlainText(text.slice(lastIndex, index))
    }

    if (matchText.startsWith(REFERENCE.ENV_VAR_START)) {
      const varName = matchText.slice(2, -2).trim()
      if (shouldHighlightEnvVar(varName)) {
        nodes.push(
          <span key={`${keyPrefix}${key++}`} className='text-[var(--brand-secondary)]'>
            {matchText}
          </span>
        )
      } else {
        nodes.push(<span key={`${keyPrefix}${key++}`}>{matchText}</span>)
      }
    } else {
      const split = splitReferenceSegment(matchText)

      if (split && shouldHighlightReference(split.reference)) {
        pushPlainText(split.leading)
        nodes.push(
          <span key={`${keyPrefix}${key++}`} className='text-[var(--brand-secondary)]'>
            {split.reference}
          </span>
        )
      } else {
        nodes.push(<span key={`${keyPrefix}${key++}`}>{matchText}</span>)
      }
    }

    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    pushPlainText(text.slice(lastIndex))
  }

  return nodes
}

/**
 * Formats text by highlighting block references (<...>), environment variables ({{...}}),
 * and the active workflow search range.
 */
export function formatDisplayText(text: string, context?: HighlightContext): ReactNode[] {
  return formatDisplayTextInternal(text, context, '')
}
