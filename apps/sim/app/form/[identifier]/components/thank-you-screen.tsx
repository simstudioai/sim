'use client'

import { CheckCircle2 } from 'lucide-react'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'

interface ThankYouScreenProps {
  title: string
  message: string
  primaryColor?: string
}

export function ThankYouScreen({ title, message, primaryColor }: ThankYouScreenProps) {
  return (
    <main className='flex flex-1 flex-col items-center justify-center p-4'>
      <div className='flex flex-col items-center text-center'>
        <div
          className='flex h-20 w-20 items-center justify-center rounded-full'
          style={{ backgroundColor: `${primaryColor}15` }}
        >
          <CheckCircle2 className='h-10 w-10' style={{ color: primaryColor }} />
        </div>
        <h2
          className={`${soehne.className} mt-6 font-medium text-[32px] tracking-tight`}
          style={{ color: primaryColor }}
        >
          {title}
        </h2>
        <p
          className={`${inter.className} mt-3 max-w-md font-[380] text-[16px] text-muted-foreground`}
        >
          {message}
        </p>
      </div>
    </main>
  )
}
