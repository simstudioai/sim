'use client'

import { type ClipboardEvent, type KeyboardEvent, useId, useRef, useState } from 'react'
import { Select } from '@sim/emcn/picker/select'
import { InlineNotice } from '@sim/emcn/status'
import { RecipientTag } from '@sim/emcn-platform/workspace-fields'
import { getErrorMessage } from '@sim/utils/errors'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/mcp-operation-policy/mcp-operation-policy.module.css'
import {
  type McpOperationPolicy,
  normalizeMcpOperationPolicy,
} from '@/platform/lib/data/workflow-editor/mcp'

const MODE_OPTIONS = [
  { value: 'allow', label: 'Only selected' },
  { value: 'deny', label: 'All except selected' },
  { value: 'all', label: 'All permitted' },
] as const

type PolicyMode = (typeof MODE_OPTIONS)[number]['value']

const MODE_DESCRIPTIONS: Record<PolicyMode, string> = {
  all: 'All tools available to the authorized connection can run.',
  allow:
    'Only these exact tool names can run on the resolved connection. An empty list grants no access.',
  deny: 'These exact tool names cannot run on the resolved connection.',
}

const COMMIT_KEYS = new Set(['Enter', ','])
const PASTE_SEPARATORS = /[\s,;]+/

interface McpOperationPolicyEditorProps {
  /** The stored policy; anything a saved workflow predating operation controls holds is normalized. */
  value: unknown
  onChange: (policy: McpOperationPolicy) => void
  disabled?: boolean
}

/** Authors literal tool IDs independently of the server value that resolves at runtime. */
export function McpOperationPolicyEditor({
  value,
  onChange,
  disabled,
}: McpOperationPolicyEditorProps) {
  const inputId = useId()
  const descriptionId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const policy = normalizeMcpOperationPolicy(value)
  const selected = policy.mode === 'all' ? [] : policy.operations

  const addNames = (names: string[]): boolean => {
    if (policy.mode === 'all') return false
    let next: McpOperationPolicy
    try {
      next = normalizeMcpOperationPolicy({
        mode: policy.mode,
        operations: [...new Set([...selected, ...names.map((name) => name.trim())])],
      })
    } catch (failure) {
      setError(getErrorMessage(failure))
      return false
    }
    onChange(next)
    setError(null)
    return true
  }

  const commitDraft = () => {
    const name = draft.trim()
    if (!name) return
    addNames([name])
    setDraft('')
  }

  const removeName = (name: string) => {
    if (policy.mode === 'all') return
    onChange({ ...policy, operations: selected.filter((entry) => entry !== name) })
    input.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (COMMIT_KEYS.has(event.key) && draft.trim()) {
      event.preventDefault()
      commitDraft()
      return
    }
    if (event.key === 'Backspace' && !draft && selected.length > 0) {
      event.preventDefault()
      removeName(selected[selected.length - 1])
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    const names = [
      ...new Set(
        event.clipboardData
          .getData('text')
          .split(PASTE_SEPARATORS)
          .map((name) => name.trim())
          .filter(Boolean)
      ),
    ]
    if (names.length > 0) addNames(names)
  }

  return (
    <div className={styles.editor}>
      <Select
        label='Operations access'
        value={policy.mode}
        disabled={disabled}
        options={MODE_OPTIONS}
        onValueChange={(mode) => {
          setError(null)
          if (mode === 'all') onChange({ mode })
          else onChange({ mode, operations: selected })
        }}
      />
      {policy.mode !== 'all' && (
        <div className={styles.field}>
          <label htmlFor={inputId} className={styles.label} data-type='T059'>
            Tool IDs
          </label>
          <div
            role='presentation'
            className={styles.frame}
            data-disabled={disabled || undefined}
            data-invalid={error ? true : undefined}
            onClick={(event) => {
              if (event.target instanceof Element && !event.target.closest('input, button')) {
                input.current?.focus()
              }
            }}
          >
            {selected.map((name) => (
              <RecipientTag
                key={name}
                address={name}
                onRemove={disabled ? undefined : removeName}
              />
            ))}
            <input
              ref={input}
              id={inputId}
              className={styles.input}
              data-type='T043'
              type='text'
              autoComplete='off'
              spellCheck={false}
              disabled={disabled}
              placeholder={selected.length > 0 ? 'Add tool ID…' : 'Enter an exact tool name'}
              value={draft}
              aria-invalid={error ? true : undefined}
              aria-describedby={descriptionId}
              onChange={(event) => {
                setDraft(event.target.value)
                setError(null)
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={commitDraft}
            />
          </div>
          {error && <InlineNotice intent='danger' message={error} />}
        </div>
      )}
      <p id={descriptionId} className={styles.description} data-type='T052'>
        {MODE_DESCRIPTIONS[policy.mode]}
      </p>
    </div>
  )
}
