import type { SVGProps } from 'react'
import styles from '@/components/emcn/icons/animate/loader.module.css'
import { cn } from '@/lib/core/utils/cn'

export interface RefreshCwProps extends SVGProps<SVGSVGElement> {
  animate?: boolean
}

export function RefreshCw({ animate = false, className, ...props }: RefreshCwProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={cn(animate && styles['animated-loader-svg'], className)}
      aria-hidden='true'
      {...props}
    >
      <path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' />
      <path d='M21 3v5h-5' />
      <path d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' />
      <path d='M8 16H3v5' />
    </svg>
  )
}
