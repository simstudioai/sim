import {
  AuthLoadingField,
  AuthLoadingFrame,
  AuthLoadingSkeleton,
} from '@/app/(auth)/components/auth-loading-skeleton'

export default function SSOLoading() {
  return (
    <AuthLoadingFrame>
      <AuthLoadingSkeleton shape='title' className='au:w-[120px]' />
      <AuthLoadingSkeleton shape='label' className='au:w-[260px]' />
      <AuthLoadingField labelWidthClassName='au:w-[80px]' />
      <AuthLoadingSkeleton shape='control' className='au:w-full' />
      <AuthLoadingSkeleton shape='label' className='au:w-[120px]' />
    </AuthLoadingFrame>
  )
}
