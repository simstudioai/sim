'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import { useCopyToClipboard } from '../../hooks/use-copy-to-clipboard'
import { Button, Check, Duplicate } from '../../index'
import { cn } from '../../lib/cn'

const copyCodeButtonVariants = cva('flex items-center gap-1 rounded px-1.5 py-0.5 text-xs', {
  variants: {
    appearance: {
      default: '',
      'code-header':
        'text-[var(--text-tertiary)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-secondary)]',
    },
  },
  defaultVariants: {
    appearance: 'default',
  },
})

interface CopyCodeButtonProps {
  code: string
  className?: string
  /** Use the muted copy action treatment in code block headers. */
  appearance?: VariantProps<typeof copyCodeButtonVariants>['appearance']
}

export function CopyCodeButton({ code, className, appearance }: CopyCodeButtonProps) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <Button
      type='button'
      aria-label='Copy code'
      variant='ghost'
      onClick={() => copy(code)}
      className={cn(copyCodeButtonVariants({ appearance }), className)}
    >
      {copied ? <Check className='size-3.5' /> : <Duplicate className='size-3.5' />}
    </Button>
  )
}

export { copyCodeButtonVariants }
