import type { ReactNode } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import { AuthSkeleton } from '@sim/emcn-auth/loading'
import { AuthProviderGroup, AuthStack } from '@sim/emcn-auth/stack'

interface AuthLoadingSkeletonProps {
  shape?: 'title' | 'label' | 'control' | 'divider'
  className?: string
}
export function AuthLoadingSkeleton(props: AuthLoadingSkeletonProps) {
  return <AuthSkeleton {...props} />
}
interface AuthLoadingFrameProps {
  children: ReactNode
}
export function AuthLoadingFrame({ children }: AuthLoadingFrameProps) {
  return <AuthStack>{children}</AuthStack>
}
interface AuthLoadingFieldProps {
  labelWidthClassName: string
  className?: string
}
export function AuthLoadingField({ labelWidthClassName, className }: AuthLoadingFieldProps) {
  return (
    <div className={cn('au:flex au:w-full au:flex-col au:gap-2', className)}>
      <AuthSkeleton shape='label' className={labelWidthClassName} />
      <AuthSkeleton shape='control' className='au:w-full' />
    </div>
  )
}
export function AuthLoadingAlternateActions() {
  return (
    <>
      <AuthSkeleton shape='divider' className='au:w-full' />
      <AuthProviderGroup>
        <AuthSkeleton />
        <AuthSkeleton />
      </AuthProviderGroup>
    </>
  )
}
