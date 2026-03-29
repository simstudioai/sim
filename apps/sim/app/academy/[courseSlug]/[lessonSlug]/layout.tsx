import type React from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

interface LessonLayoutProps {
  children: React.ReactNode
  params: Promise<{ courseSlug: string; lessonSlug: string }>
}

/**
 * Server-side auth gate for lesson pages.
 * Redirects unauthenticated users to login before any client JS runs.
 */
export default async function LessonLayout({ children, params }: LessonLayoutProps) {
  const session = await getSession()

  if (!session?.user?.id) {
    const { courseSlug, lessonSlug } = await params
    redirect(`/login?callbackUrl=/academy/${courseSlug}/${lessonSlug}`)
  }

  return <>{children}</>
}
