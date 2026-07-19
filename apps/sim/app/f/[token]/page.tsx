import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { buildProvenance } from '@/lib/public-shares/provenance'
import { resolvePublicShareGate } from '@/lib/public-shares/share-gate'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { PublicFileView } from '@/app/f/[token]/public-file-view'
import { getBrandConfig } from '@/ee/whitelabeling'

export const dynamic = 'force-dynamic'

/** Deduped per-request so `generateMetadata` and the page share one DB resolve. */
const resolveShare = cache(resolveActiveShareByToken)

/** Shared links must never be indexed by search engines. */
const NOINDEX = { index: false, follow: false } as const

interface PublicFilePageProps {
  params: Promise<{ token: string }>
}

/**
 * Social-preview metadata. Public shares unfurl with the file name + provenance;
 * any protected share (password / email / SSO) stays deliberately generic so the
 * filename never leaks before the visitor authenticates. Always `noindex`.
 */
export async function generateMetadata({ params }: PublicFilePageProps): Promise<Metadata> {
  const { token } = await params
  const resolved = await resolveShare(token)
  if (!resolved) {
    return { robots: NOINDEX }
  }

  let title: string
  let description: string
  if (resolved.share.authType !== 'public') {
    title = 'Shared file'
    description = 'Authentication is required to view this file.'
  } else {
    title = resolved.file.originalName
    description =
      buildProvenance(resolved.workspaceName, resolved.ownerName) || `Shared file · ${title}`
  }

  const brand = getBrandConfig()
  return {
    title,
    description,
    robots: NOINDEX,
    openGraph: { type: 'website', title, description, siteName: brand.name },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function PublicFilePage({ params }: PublicFilePageProps) {
  const { token } = await params

  const resolved = await resolveShare(token)
  if (!resolved) {
    notFound()
  }

  const { share, file, ownerName } = resolved

  const gate = await resolvePublicShareGate('file', token, share)
  if (gate) return gate

  return (
    <PublicFileView
      token={token}
      name={file.originalName}
      type={file.contentType}
      size={file.size}
      version={file.updatedAt.getTime()}
      ownerName={ownerName}
    />
  )
}
