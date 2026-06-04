'use client'

import { useState } from 'react'
import { Button, Tooltip } from '@/components/emcn'
import { Check, Duplicate } from '@/components/emcn/icons'

interface CopyableValueFieldProps {
  value: string
  /** Accessible label and tooltip for the copy button (e.g. 'Copy credential ID'). */
  copyLabel: string
  id?: string
}

/**
 * Read-only value row with a trailing copy-to-clipboard button. Shared field
 * shell for identifiers such as a credential ID or a secret key.
 */
export function CopyableValueField({ value, copyLabel, id }: CopyableValueFieldProps) {
  const [copied, setCopied] = useState(false)

  return (
    <div className='flex h-[30px] items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 dark:bg-[var(--surface-4)]'>
      <input
        id={id}
        readOnly
        value={value}
        className='h-full w-full cursor-default bg-transparent text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none'
      />
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='quiet'
            className='size-[18px] rounded-sm p-0'
            onClick={() => {
              navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            aria-label={copyLabel}
          >
            {copied ? <Check className='size-[13px]' /> : <Duplicate className='size-[13px]' />}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>{copied ? 'Copied!' : copyLabel}</Tooltip.Content>
      </Tooltip.Root>
    </div>
  )
}
