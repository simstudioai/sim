'use client'

import { Chip } from '@sim/emcn'
import { Check, Duplicate } from '@sim/emcn/icons'
import { useCopyButton } from 'fumadocs-ui/utils/use-copy-button'

export function LLMCopyButton({ content }: { content: string }) {
  const [checked, onClick] = useCopyButton(() => navigator.clipboard.writeText(content))

  return (
    <Chip
      onClick={onClick}
      leftIcon={checked ? Check : Duplicate}
      aria-label={checked ? 'Copied to clipboard' : 'Copy page content'}
    >
      {checked ? 'Copied' : 'Copy page'}
    </Chip>
  )
}
