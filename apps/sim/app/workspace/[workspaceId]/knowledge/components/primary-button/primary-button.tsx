'use client'

import { Button } from '@/components/emcn'
import { cn } from '@/lib/utils'

interface PrimaryButtonProps {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit' | 'reset'
}

export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  className,
  type = 'button',
}: PrimaryButtonProps) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      variant='primary'
      className={cn(
        'flex h-8 items-center gap-1 px-[8px] py-[6px] font-[480] shadow-[0_0_0_0_var(--brand-primary-hex)] transition-all duration-200 hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
        disabled && 'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {children}
    </Button>
  )
}
