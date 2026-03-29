import { cn } from '@/lib/core/utils/cn'
import AuthBackgroundSVG from '@/app/(auth)/components/auth-background-svg'

type AuthBackgroundProps = {
  className?: string
  children?: React.ReactNode
}

export default function AuthBackground({ className, children }: AuthBackgroundProps) {
  return (
    <div className={cn('fixed inset-0 overflow-hidden', className)}>
      <div className='-z-50 pointer-events-none absolute inset-0 bg-[var(--landing-bg)]' />
      <AuthBackgroundSVG />
      <div className='relative z-20 h-full overflow-auto'>{children}</div>
    </div>
  )
}
