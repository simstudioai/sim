'use client'

import Image from 'next/image'
import Link from 'next/link'
import { GridPattern } from '../(landing)/components/grid-pattern'
import { NotificationList } from '../w/[id]/components/notifications/notifications'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#0C0C0C] text-white relative font-geist-sans flex flex-col">
      {/* Background pattern */}
      <GridPattern
        x={-5}
        y={-5}
        className="stroke-[#ababab]/5 absolute inset-0 z-0"
        width={90}
        height={90}
        aria-hidden="true"
      />

      {/* Header */}
      <div className="px-6 py-8 relative z-10">
        <div className="max-w-7xl mx-auto">
          <Link href="/" className="inline-flex">
            <Image src="/sim.svg" alt="Sim Logo" width={42} height={42} />
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-4 pb-6 relative z-10">
        <div className="w-full max-w-md">{children}</div>
      </div>

      {/* Notifications */}
      <div className="fixed bottom-4 right-4 z-50">
        <NotificationList />
      </div>
    </main>
  )
}
