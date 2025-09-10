import { cn } from '@/lib/utils'

type AuthBackgroundProps = {
  className?: string
  children?: React.ReactNode
}

export default function AuthBackground({ className, children }: AuthBackgroundProps) {
  return (
    <div className={cn('relative min-h-screen w-full bg-white', className)}>
      {/* Wireframe box using landing page design elements */}
      <svg
        aria-hidden='true'
        focusable='false'
        className='pointer-events-none absolute inset-0 z-0'
        width='100%'
        height='100%'
        viewBox='0 0 800 600'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        preserveAspectRatio='xMidYMid meet'
      >
        {/* Main wireframe box - using landing page styling */}
        {/* Top horizontal line */}
        <path d='M150 120H650' stroke='#E7E4EF' strokeWidth='2' />
        {/* Bottom horizontal line */}
        <path d='M150 480H650' stroke='#E7E4EF' strokeWidth='2' />

        {/* Left vertical line */}
        <path d='M150 120V480' stroke='#E7E4EF' strokeWidth='2' />
        {/* Right vertical line */}
        <path d='M650 120V480' stroke='#E7E4EF' strokeWidth='2' />

        {/* Corner connection circles - exact same size as landing */}
        <circle cx='150' cy='120' r='8.07846' fill='white' stroke='#E7E4EF' strokeWidth='2' />
        <circle cx='650' cy='120' r='8.07846' fill='white' stroke='#E7E4EF' strokeWidth='2' />
        <circle cx='150' cy='480' r='8.07846' fill='white' stroke='#E7E4EF' strokeWidth='2' />
        <circle cx='650' cy='480' r='8.07846' fill='white' stroke='#E7E4EF' strokeWidth='2' />

        {/* Extension lines to viewport edges - matching landing style */}
        <path d='M0 300H150' stroke='#E7E4EF' strokeWidth='2' />
        <path d='M650 300H800' stroke='#E7E4EF' strokeWidth='2' />
        <path d='M400 0V120' stroke='#E7E4EF' strokeWidth='2' />
        <path d='M400 480V600' stroke='#E7E4EF' strokeWidth='2' />

        {/* Mid-point connection circles on the box */}
        <circle cx='400' cy='120' r='8.07846' fill='white' stroke='#E7E4EF' strokeWidth='2' />
        <circle cx='400' cy='480' r='8.07846' fill='white' stroke='#E7E4EF' strokeWidth='2' />
        <circle cx='150' cy='300' r='8.07846' fill='white' stroke='#E7E4EF' strokeWidth='2' />
        <circle cx='650' cy='300' r='8.07846' fill='white' stroke='#E7E4EF' strokeWidth='2' />

        {/* Curved connection paths - using landing page path style */}
        <path d='M200 80C250 90 300 100 350 110' stroke='#E7E4EF' strokeWidth='1.90903' />
        <path d='M450 110C500 100 550 90 600 80' stroke='#E7E4EF' strokeWidth='1.90903' />

        {/* Small connection circles - exact same size as landing */}
        <circle cx='300' cy='105' r='6.25942' fill='white' stroke='#E7E4EF' strokeWidth='1.90903' />
        <circle cx='500' cy='105' r='6.25942' fill='white' stroke='#E7E4EF' strokeWidth='1.90903' />

        {/* Additional detail lines on the sides */}
        <path d='M120 200V220' stroke='#E7E4EF' strokeWidth='1.90903' />
        <path d='M680 200V220' stroke='#E7E4EF' strokeWidth='1.90903' />

        {/* Small detail circles */}
        <circle cx='120' cy='210' r='6.25942' fill='white' stroke='#E7E4EF' strokeWidth='1.90903' />
        <circle cx='680' cy='210' r='6.25942' fill='white' stroke='#E7E4EF' strokeWidth='1.90903' />
      </svg>

      <div className='relative z-10 mx-auto w-full'>{children}</div>
    </div>
  )
}
