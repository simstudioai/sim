import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CHANGELOG_SECTION, getAllEntryMeta, getEntryBySlug } from '@/lib/changelog'
import { buildPostGraphJsonLd, buildPostMetadata } from '@/lib/content/seo'
import { ChangelogArticle, ChangelogLayout } from '@/app/(landing)/changelog/components'
import { JsonLd } from '@/app/(landing)/components/json-ld'

export const dynamicParams = false
export const revalidate = 3600

interface ChangelogEntryPageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return (await getAllEntryMeta()).map((entry) => ({ slug: entry.slug }))
}

export async function generateMetadata({ params }: ChangelogEntryPageProps): Promise<Metadata> {
  const { slug } = await params
  const entry = await getEntryBySlug(slug)
  return entry ? buildPostMetadata(entry) : {}
}

export default async function ChangelogEntryPage({ params }: ChangelogEntryPageProps) {
  const { slug } = await params
  const entry = await getEntryBySlug(slug)
  if (!entry) notFound()

  return (
    <ChangelogLayout>
      <JsonLd data={buildPostGraphJsonLd(entry, CHANGELOG_SECTION)} />
      <ChangelogArticle entry={entry} />
    </ChangelogLayout>
  )
}
