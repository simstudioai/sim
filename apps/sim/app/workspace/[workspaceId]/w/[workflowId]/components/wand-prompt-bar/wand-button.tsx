import type { MouseEventHandler } from 'react'
import { Chip } from '@sim/emcn'
import { Wand } from '@sim/emcn/icons'

interface WandButtonProps {
  onClick: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  'aria-label'?: string
}

/** AI prompt trigger shared by text fields and the code editor. Chrome belongs to EMCN. */
export function WandButton({
  onClick,
  disabled,
  'aria-label': label = 'Generate content with AI',
}: WandButtonProps) {
  return (
    <Chip
      variant='border-shadow'
      shape='round'
      leftIcon={Wand}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    />
  )
}
