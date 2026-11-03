import { Children, cloneElement, type HTMLAttributes, isValidElement } from 'react'
import { cn } from '@/components/docs/classnames'

interface StepsProps extends HTMLAttributes<HTMLOListElement> {}
interface StepProps extends HTMLAttributes<HTMLLIElement> {
  number?: number
}

export function Steps({ children, className, ...props }: StepsProps) {
  let number = 0
  return (
    <ol {...props} className={cn('my-7 list-none space-y-7 p-0', className)}>
      {Children.map(children, (child) => {
        if (!isValidElement<StepProps>(child)) return child
        return cloneElement(child, { number: ++number })
      })}
    </ol>
  )
}

export function Step({ children, number, className, ...props }: StepProps) {
  return (
    <li {...props} className={cn('flex min-w-0 items-start gap-3', className)}>
      <span
        aria-hidden
        className='flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--docs-surface)] text-docs-control'
      >
        {number}
      </span>
      <div className='min-w-0 flex-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&>h2]:text-docs-body [&>h3]:text-docs-body'>
        {children}
      </div>
    </li>
  )
}
