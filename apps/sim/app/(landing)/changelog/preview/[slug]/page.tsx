import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getEntryPreview } from '@/lib/changelog'
import { ChangelogArticle, ChangelogLayout } from '@/app/(landing)/changelog/components'

export const metadata: Metadata = {
  title: { absolute: 'Changelog preview | Sim' },
  robots: { index: false, follow: false },
}

interface ChangelogDraftPageProps {
  params: Promise<{ slug: string }>
}

export default async function ChangelogDraftPage({ params }: ChangelogDraftPageProps) {
  if (process.env.NODE_ENV !== 'development') notFound()
  const { slug } = await params
  const entry = await getEntryPreview(slug)
  if (!entry) notFound()
  return (
    <ChangelogLayout>
      <p className='text-[var(--text-secondary)] text-small'>
        Local editorial preview. Verify the feature, availability, and media before publishing.
      </p>
      <ChangelogArticle
        entry={entry}
        backHref='/changelog/preview'
        archiveHref='/changelog/preview'
      />
    </ChangelogLayout>
  )
}
