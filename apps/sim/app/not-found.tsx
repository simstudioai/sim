import type { Metadata } from 'next'
import NotFoundView from '@/app/(landing)/components/not-found-view'

export const metadata: Metadata = {
  title: 'Page Not Found',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return <NotFoundView />
}
