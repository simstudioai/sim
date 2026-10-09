import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAllEntryPreviews } from '@/lib/changelog'
import {
  ChangelogHeader,
  ChangelogLayout,
  ChangelogList,
} from '@/app/(landing)/changelog/components'

export const metadata: Metadata = {
  title: { absolute: 'Changelog preview | Sim' },
  robots: { index: false, follow: false },
}

export default async function ChangelogPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const entries = await getAllEntryPreviews()
  return (
    <ChangelogLayout>
      <ChangelogHeader
        title='Changelog preview'
        lead='Local editorial preview, including unpublished drafts. Verify the feature, availability, and media before publishing.'
      />
      <ChangelogList entries={entries} basePath='/changelog/preview' />
    </ChangelogLayout>
  )
}
