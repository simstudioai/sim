'use client'

import { useState } from 'react'
import { IconButton, Tooltip } from '@/platform/design-system/components'

interface CopyActionProps {
  label: string
  text: string
}
export function CopyAction({ label, text }: CopyActionProps) {
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip label={copied ? 'Copied' : label}>
      <IconButton
        label={label}
        icon={copied ? 'I072' : 'I006'}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
          } catch {
            setCopied(false)
          }
        }}
      />
    </Tooltip>
  )
}
