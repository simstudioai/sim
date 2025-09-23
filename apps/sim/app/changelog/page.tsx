import type { Metadata } from 'next'
import ChangelogContent from './components/changelog-content'

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'Stay up-to-date with the latest features, improvements, and bug fixes in Sim.',
  openGraph: {
    title: 'Changelog',
    description: 'Stay up-to-date with the latest features, improvements, and bug fixes in Sim.',
    type: 'website',
  },
}

export default function ChangelogPage() {
  return <ChangelogContent />
}
