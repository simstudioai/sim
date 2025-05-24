import type React from 'react'
import { AlertCircle, AlertTriangle, Check, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export type NoticeVariant = 'info' | 'warning' | 'success' | 'error' | 'default'

interface NoticeProps {
  children: React.ReactNode
  variant?: NoticeVariant
  className?: string
  icon?: React.ReactNode
  title?: string
}

const variantStyles = {
  default: {
    container: 'bg-background border-border',
    text: 'text-foreground',
    title: 'text-foreground font-medium',
    icon: <Info className='mr-2 h-4 w-4 flex-shrink-0 text-muted-foreground' />,
  },
  info: {
    container: 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800/50',
    text: 'text-blue-800 dark:text-blue-300',
    title: 'text-blue-800 dark:text-blue-300 font-medium',
    icon: <Info className='mr-2 h-4 w-4 flex-shrink-0 text-blue-500 dark:text-blue-400' />,
  },
  warning: {
    container: 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/50',
    text: 'text-amber-800 dark:text-amber-300',
    title: 'text-amber-800 dark:text-amber-300 font-medium',
    icon: (
      <AlertTriangle className='mr-2 h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400' />
    ),
  },
  success: {
    container: 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800/50',
    text: 'text-green-800 dark:text-green-300',
    title: 'text-green-800 dark:text-green-300 font-medium',
    icon: <Check className='mr-2 h-4 w-4 flex-shrink-0 text-green-500 dark:text-green-400' />,
  },
  error: {
    container: 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800/50',
    text: 'text-red-800 dark:text-red-300',
    title: 'text-red-800 dark:text-red-300 font-medium',
    icon: <AlertCircle className='mr-2 h-4 w-4 flex-shrink-0 text-red-500 dark:text-red-400' />,
  },
}

export function Notice({ children, variant = 'info', className, icon, title }: NoticeProps) {
  const styles = variantStyles[variant]

  return (
    <div className={cn('flex rounded-md border p-3', styles.container, className)}>
      <div className='flex items-start'>
        {icon || styles.icon}
        <div className='flex-1'>
          {title && <div className={cn('mb-1', styles.title)}>{title}</div>}
          <div className={cn('text-sm', styles.text)}>{children}</div>
        </div>
      </div>
    </div>
  )
}
