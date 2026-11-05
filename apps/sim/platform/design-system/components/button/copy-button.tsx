'use client'

import { IconButton } from '@/platform/design-system/components/button/button'
import { useClipboard } from '@/platform/design-system/components/feedback/use-clipboard'

interface CopyButtonProps {
  label: string
  text: string
}

export function CopyButton({ label, text }: CopyButtonProps) {
  const { copied, copy } = useClipboard()
  return (
    <IconButton
      tooltip
      label={copied ? 'Copied' : label}
      icon={copied ? 'I072' : 'I006'}
      onClick={() => void copy(text)}
    />
  )
}
