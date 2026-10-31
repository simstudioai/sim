import type { ReactNode } from 'react'
import { AuthProviderGroup, AuthSkeleton, AuthStack, cn } from '@sim/auth-ui'

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
    <div className={cn('au:w-full au:space-y-2', className)}>
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
