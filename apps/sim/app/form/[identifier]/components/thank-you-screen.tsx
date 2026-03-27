import { CheckCircle2 } from 'lucide-react'

interface ThankYouScreenProps {
  title: string
  message: string
  primaryColor?: string
}

/** Default green color matching --brand-accent */
const DEFAULT_THANK_YOU_COLOR = '#33C482'

/** Legacy blue default that should be treated as "no custom color" */
const LEGACY_BLUE_DEFAULT = '#3972F6'

export function ThankYouScreen({ title, message, primaryColor }: ThankYouScreenProps) {
  // Treat legacy blue default as no custom color, fall back to green
  const thankYouColor =
    primaryColor && primaryColor !== LEGACY_BLUE_DEFAULT ? primaryColor : DEFAULT_THANK_YOU_COLOR

  return (
    <main className='flex flex-1 flex-col items-center justify-center p-4'>
      <div className='flex flex-col items-center text-center'>
        <div
          className='flex h-20 w-20 items-center justify-center rounded-full'
          style={{ backgroundColor: `${thankYouColor}15` }}
        >
          <CheckCircle2 className='h-10 w-10' style={{ color: thankYouColor }} />
        </div>
        <h2
          className={'mt-6 font-[500] text-[32px] tracking-tight'}
          style={{ color: thankYouColor }}
        >
          {title}
        </h2>
        <p className={'mt-3 max-w-md font-[380] text-[var(--landing-text-muted)] text-md'}>
          {message}
        </p>
      </div>
    </main>
  )
}
