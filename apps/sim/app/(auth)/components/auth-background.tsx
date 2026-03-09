import { cn } from '@/lib/core/utils/cn'
import AuthBackgroundSVG from '@/app/(auth)/components/auth-background-svg'

type AuthBackgroundProps = {
  className?: string
  children?: React.ReactNode
}

export default function AuthBackground({ className, children }: AuthBackgroundProps) {
  return (
    <div className={cn('relative min-h-screen w-full overflow-hidden', className)}>
      <div className='-z-50 pointer-events-none fixed inset-0 bg-white' />
      <AuthBackgroundSVG />
      <div className='relative z-20'>{children}</div>
    </div>
  )
}
