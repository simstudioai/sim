import type { ReactNode } from 'react'
import { cn, Skeleton } from '@sim/emcn'
import { cva, type VariantProps } from 'class-variance-authority'

const authLoadingSkeletonVariants = cva('', {
  variants: {
    shape: {
      title: 'h-[38px] rounded-[4px]',
      label: 'h-[14px] rounded-[4px]',
      control: 'h-[44px] rounded-[10px]',
      divider: 'h-[1px] rounded-[1px]',
    },
  },
})

interface AuthLoadingSkeletonProps extends VariantProps<typeof authLoadingSkeletonVariants> {
  className?: string
}

/** Placeholder geometry shared by the auth route loading states. */
export function AuthLoadingSkeleton({ shape, className }: AuthLoadingSkeletonProps) {
  return <Skeleton className={cn(authLoadingSkeletonVariants({ shape }), className)} />
}

interface AuthLoadingFrameProps {
  children: ReactNode
}

export function AuthLoadingFrame({ children }: AuthLoadingFrameProps) {
  return <div className='flex flex-col items-center'>{children}</div>
}

interface AuthLoadingFieldProps {
  labelWidthClassName: string
  className?: string
}

export function AuthLoadingField({ labelWidthClassName, className }: AuthLoadingFieldProps) {
  return (
    <div className={cn('w-full space-y-2', className)}>
      <AuthLoadingSkeleton shape='label' className={labelWidthClassName} />
      <AuthLoadingSkeleton shape='control' className='w-full' />
    </div>
  )
}

/** The divider and paired provider-action placeholders on login and signup. */
export function AuthLoadingAlternateActions() {
  return (
    <>
      <AuthLoadingSkeleton shape='divider' className='mt-6 w-full' />
      <div className='mt-6 flex w-full gap-3'>
        <AuthLoadingSkeleton shape='control' className='flex-1' />
        <AuthLoadingSkeleton shape='control' className='flex-1' />
      </div>
    </>
  )
}
