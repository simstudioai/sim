import { cn } from '@/lib/utils'
import AuthBackgroundSVG from './auth-background-svg'

type AuthBackgroundProps = {
  className?: string
  children?: React.ReactNode
}

export default function AuthBackground({ className, children }: AuthBackgroundProps) {
  return (
    <div className={cn('relative min-h-screen w-full overflow-hidden', className)}>
      <AuthBackgroundSVG />
      <div className='relative z-20'>{children}</div>
    </div>
  )
}
