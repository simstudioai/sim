import type React from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/core/utils/urls'

// TODO: Remove notFound() call to make academy pages public once content is ready
const ACADEMY_ENABLED = false

export const metadata: Metadata = {
  title: {
    absolute: 'Sim Academy',
    template: '%s | Sim Academy',
  },
  description:
    'Become a certified Sim partner — learn to build, integrate, and deploy AI workflows.',
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: 'Sim Academy',
    description: 'Become a certified Sim partner.',
    type: 'website',
  },
}

export default function AcademyLayout({ children }: { children: React.ReactNode }) {
  if (!ACADEMY_ENABLED) {
    notFound()
  }

  return (
    <div className='min-h-screen bg-[#1C1C1C] font-[430] font-season text-[#ECECEC]'>
      {children}
    </div>
  )
}
