'use client'

import { useState } from 'react'
import { SafeMarkdown } from '@/components/interfaces/safe-markdown'

function isValuesEnvelope(output: unknown): output is { values: unknown[] } {
  return (
    !!output &&
    typeof output === 'object' &&
    !Array.isArray(output) &&
    Array.isArray((output as { values?: unknown }).values)
  )
}

function CompactObject({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value)
  if (entries.length === 0) {
    return <p className='text-[var(--text-secondary)] text-sm'>Empty object</p>
  }

  return (
    <dl className='space-y-2'>
      {entries.map(([key, nested]) => (
        <div key={key} className='grid gap-0.5'>
          <dt className='font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-wide'>
            {key}
          </dt>
          <dd className='break-words text-[var(--text-primary)] text-sm'>
            <ResultValue value={nested} depth={1} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ResultValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [expanded, setExpanded] = useState(false)

  if (value === null || value === undefined) {
    return <span className='text-[var(--text-tertiary)]'>—</span>
  }

  if (typeof value === 'string') {
    // Short plain strings render as text; longer / markdown-ish as SafeMarkdown
    if (value.length < 280 && !value.includes('\n') && !/[*_`#]/.test(value)) {
      return <span className='break-all'>{value}</span>
    }
    return <SafeMarkdown content={value} />
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className='text-[var(--text-tertiary)]'>Empty list</span>
    }
    return (
      <ul className='list-disc space-y-1 pl-5'>
        {value.map((item, index) => (
          <li key={index}>
            <ResultValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    )
  }

  if (typeof value === 'object') {
    if (depth >= 2) {
      const encoded = (() => {
        try {
          return JSON.stringify(value, null, 2)
        } catch {
          return String(value)
        }
      })()
      return (
        <div className='space-y-1'>
          <button
            type='button'
            className='text-[var(--interface-primary)] text-xs underline-offset-2 hover:underline'
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
          {expanded ? (
            <pre className='overflow-x-auto whitespace-pre-wrap rounded-md bg-[var(--bg-muted,rgba(0,0,0,0.04))] p-2 font-mono text-xs'>
              {encoded}
            </pre>
          ) : null}
        </div>
      )
    }
    return <CompactObject value={value as Record<string, unknown>} />
  }

  return <span>{String(value)}</span>
}

/**
 * Renders opaque interface execute outputs without leaking blockId.path keys.
 */
export function InterfaceResultPresenter({
  output,
  successMessage,
}: {
  output: unknown
  successMessage?: string
}) {
  if (output === undefined) {
    return <p className='text-[var(--text-primary)] text-sm'>{successMessage || 'Done!'}</p>
  }

  if (typeof output === 'string') {
    return <SafeMarkdown content={output} />
  }

  if (isValuesEnvelope(output)) {
    if (output.values.length === 0) {
      return <p className='text-[var(--text-primary)] text-sm'>{successMessage || 'Done!'}</p>
    }

    return (
      <ol className='space-y-4'>
        {output.values.map((value, index) => (
          <li key={index} className='space-y-1.5'>
            <p className='font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-wide'>
              Result {index + 1}
            </p>
            <div className='text-[var(--text-primary)] text-sm'>
              <ResultValue value={value} />
            </div>
          </li>
        ))}
      </ol>
    )
  }

  return (
    <div className='text-[var(--text-primary)] text-sm'>
      <ResultValue value={output} />
    </div>
  )
}
