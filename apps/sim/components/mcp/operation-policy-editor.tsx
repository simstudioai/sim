'use client'

import { useId, useState } from 'react'
import { ChipDropdown, TagInput } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { type McpOperationPolicy, normalizeMcpOperationPolicy } from '@/lib/mcp/operation-policy'

interface McpOperationPolicyEditorProps {
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
    } catch (error) {
      setError(getErrorMessage(error))
      return false
    }
    onChange(next)
    setError(null)
    return true
  }

  return (
    <div className='flex flex-col gap-2'>
      <ChipDropdown
        aria-label='Operations access'
        value={policy.mode}
        disabled={disabled}
        options={[
          { value: 'allow', label: 'Only selected' },
          { value: 'deny', label: 'All except selected' },
          { value: 'all', label: 'All permitted' },
        ]}
        onChange={(mode) => {
          setError(null)
          if (mode === 'all') onChange({ mode })
          else if (mode === 'allow' || mode === 'deny') onChange({ mode, operations: selected })
        }}
      />
      {policy.mode !== 'all' && (
        <div className='flex flex-col gap-[9px]'>
          <label htmlFor={inputId} className='text-[var(--text-muted)] text-small'>
            Tool IDs
          </label>
          <TagInput
            id={inputId}
            items={selected.map((value) => ({ value, isValid: true }))}
            disabled={disabled}
            placeholder='Enter an exact tool name'
            placeholderWithTags='Add tool ID...'
            triggerKeys={['Enter', ',']}
            onAdd={(name) => addNames([name])}
            onAddMany={addNames}
            onRemove={(_, index) =>
              onChange({ ...policy, operations: selected.filter((_, i) => i !== index) })
            }
            onInputChange={() => setError(null)}
          />
          {error && (
            <p role='alert' className='text-[var(--text-error)] text-caption'>
              {error}
            </p>
          )}
        </div>
      )}
      <p className='text-[var(--text-tertiary)] text-caption'>
        {policy.mode === 'all'
          ? 'All tools available to the authorized connection can run.'
          : policy.mode === 'allow'
            ? 'Only these exact tool names can run on the resolved connection. An empty list grants no access.'
            : 'These exact tool names cannot run on the resolved connection.'}
      </p>
    </div>
  )
}
