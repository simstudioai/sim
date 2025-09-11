import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'

// Lazy load the SVG to reduce initial bundle size
const BackgroundSVG = dynamic(() => import('./background-svg'), {
  ssr: true, // Enable SSR for SEO
  loading: () => null, // Don't show loading state
})

type BackgroundProps = {
  className?: string
  children?: React.ReactNode
}

export default function Background({ className, children }: BackgroundProps) {
  return (
    <div className={cn('relative min-h-screen w-full', className)}>
      <BackgroundSVG />
      <div className='relative z-0 mx-auto w-full max-w-[1308px]'>{children}</div>
    </div>
  )
}
