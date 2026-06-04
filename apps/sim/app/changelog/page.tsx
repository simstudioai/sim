import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import ChangelogContent from '@/app/changelog/components/changelog-content'

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'Stay up-to-date with the latest features, improvements, and bug fixes in Sim.',
  alternates: { canonical: `${SITE_URL}/changelog` },
  openGraph: {
    title: 'Changelog',
    description: 'Stay up-to-date with the latest features, improvements, and bug fixes in Sim.',
    type: 'website',
  },
}

export default function ChangelogPage() {
  return <ChangelogContent />
}
