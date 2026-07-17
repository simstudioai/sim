'use client'

import { Chip, ChipInput } from '@sim/emcn'
import { Plus, Trash2 } from 'lucide-react'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'
import { validateRegexPattern } from '@/lib/guardrails/validate_regex'

/** Matches the `.max(20)` bound on `customPatterns` in the boundary contract. */
const MAX_PATTERNS = 20

interface CustomPatternsEditorProps {
  patterns: CustomPiiPattern[]
  onChange: (patterns: CustomPiiPattern[]) => void
}

/**
 * Editor for user-supplied custom regex patterns. Each row is a name label, the
 * regex (validated inline for syntax + catastrophic-backtracking safety), and the
 * verbatim replacement token that matches are redacted to. Shared by the Data
 * Retention settings and any other PII-policy surface.
 */
export function CustomPatternsEditor({ patterns, onChange }: CustomPatternsEditorProps) {
  function updateRow(index: number, patch: Partial<CustomPiiPattern>) {
    onChange(patterns.map((pattern, i) => (i === index ? { ...pattern, ...patch } : pattern)))
  }

  function removeRow(index: number) {
    onChange(patterns.filter((_, i) => i !== index))
  }

  function addRow() {
    if (patterns.length >= MAX_PATTERNS) return
    onChange([...patterns, { name: '', regex: '', replacement: '' }])
  }

  return (
    <div className='flex flex-col gap-2'>
      {patterns.map((pattern, index) => {
        const validation = pattern.regex.length > 0 ? validateRegexPattern(pattern.regex) : null
        const error = validation && !validation.valid ? validation.error : undefined
        return (
          <div key={index} className='flex flex-col gap-1'>
            <div className='flex items-start gap-2'>
              <ChipInput
                placeholder='Name'
                value={pattern.name}
                onChange={(e) => updateRow(index, { name: e.target.value })}
                className='w-[26%]'
              />
              <ChipInput
                placeholder='Pattern (regex)'
                value={pattern.regex}
                onChange={(e) => updateRow(index, { regex: e.target.value })}
                inputClassName='font-mono'
                error={Boolean(error)}
                className='flex-1'
              />
              <ChipInput
                placeholder='Replacement'
                value={pattern.replacement}
                onChange={(e) => updateRow(index, { replacement: e.target.value })}
                className='w-[26%]'
              />
              <button
                type='button'
                aria-label='Remove pattern'
                onClick={() => removeRow(index)}
                className='flex size-[30px] flex-shrink-0 items-center justify-center rounded-md text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-error)]'
              >
                <Trash2 className='size-[14px]' />
              </button>
            </div>
            {error && <span className='text-[var(--text-error)] text-small'>{error}</span>}
          </div>
        )
      })}
      <Chip leftIcon={Plus} onClick={addRow} disabled={patterns.length >= MAX_PATTERNS}>
        Add pattern
      </Chip>
    </div>
  )
}
