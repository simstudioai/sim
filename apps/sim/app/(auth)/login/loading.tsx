import {
  AuthLoadingAlternateActions,
  AuthLoadingField,
  AuthLoadingFrame,
  AuthLoadingSkeleton,
} from '@/app/(auth)/components/auth-loading-skeleton'

export default function LoginLoading() {
  return (
    <AuthLoadingFrame>
      <AuthLoadingSkeleton shape='title' className='au:w-[80px]' />
      <AuthLoadingField labelWidthClassName='au:w-[40px]' />
      <AuthLoadingField labelWidthClassName='au:w-[64px]' />
      <AuthLoadingSkeleton shape='control' className='au:w-full' />
      <AuthLoadingAlternateActions />
      <AuthLoadingSkeleton shape='label' className='au:w-[200px]' />
    </AuthLoadingFrame>
  )
}
