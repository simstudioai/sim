'use client'

import { useState } from 'react'
import { Button, Tooltip } from '@/components/emcn'
import { Check, Duplicate } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  CHIP_FIELD_INPUT,
  CHIP_FIELD_SHELL,
} from '@/app/workspace/[workspaceId]/components/credential-detail/components/chip-field'

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
    <div className={CHIP_FIELD_SHELL}>
      <input id={id} readOnly value={value} className={cn(CHIP_FIELD_INPUT, 'cursor-default')} />
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
