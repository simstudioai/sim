'use client'

import type { ReactNode } from 'react'
import { splitReferenceSegment } from '@/lib/workflows/sanitization/references'
import { normalizeName, REFERENCE } from '@/executor/constants'
import { createCombinedPattern } from '@/executor/utils/reference-validation'

export interface HighlightContext {
  accessiblePrefixes?: Set<string>
  availableEnvVars?: Set<string>
  highlightAll?: boolean
}

const SYSTEM_PREFIXES = new Set(['start', 'loop', 'parallel', 'variable'])

/**
 * Formats text by highlighting block references (<...>) and environment variables ({{...}})
 * Used in code editor, long inputs, and short inputs for consistent syntax highlighting
 */
export function formatDisplayText(text: string, context?: HighlightContext): ReactNode[] {
  if (!text) return []

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
    nodes.push(<span key={key++}>{value}</span>)
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
          <span key={key++} className='text-[var(--brand-secondary)]'>
            {matchText}
          </span>
        )
      } else {
        nodes.push(<span key={key++}>{matchText}</span>)
      }
    } else {
      const split = splitReferenceSegment(matchText)

      if (split && shouldHighlightReference(split.reference)) {
        pushPlainText(split.leading)
        nodes.push(
          <span key={key++} className='text-[var(--brand-secondary)]'>
            {split.reference}
          </span>
        )
      } else {
        nodes.push(<span key={key++}>{matchText}</span>)
      }
    }

    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    pushPlainText(text.slice(lastIndex))
  }

  return nodes
}
