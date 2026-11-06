'use client'

import { IconButton } from '@/platform/design-system/components/button/button'
import { useClipboard } from '@/platform/design-system/components/feedback/use-clipboard'

interface CopyButtonProps {
  label: string
  text: string
  size?: 'small' | 'compact'
  disabled?: boolean
}

export function CopyButton({ label, text, size = 'small', disabled }: CopyButtonProps) {
  const { copied, copy } = useClipboard()
  return (
    <IconButton
      tooltip
      render={<button type='button' data-copy-feedback={copied || undefined} />}
      label={copied ? 'Copied' : label}
      icon={copied ? 'I072' : 'I006'}
      size={size}
      disabled={disabled}
      onClick={() => void copy(text)}
    />
  )
}
