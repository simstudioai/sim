import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { publicFileShareCredential, readPublicFileSocialMetadata } from '@/lib/public-shares/api'
import { authorizePublicFileShare, readPublicFileShare } from '@/lib/public-shares/application'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import { PublicFileAuth } from '@/app/f/[token]/public-file-auth'
import { PublicFileEmailAuth } from '@/app/f/[token]/public-file-email-auth'
import { PublicFileSSOAuth } from '@/app/f/[token]/public-file-sso-auth'
import { PublicFileView } from '@/app/f/[token]/public-file-view'
import { buildProvenance } from '@/app/f/[token]/utils'
import { getBrandConfig } from '@/ee/whitelabeling'

export const dynamic = 'force-dynamic'

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
  const resolved = await readPublicFileSocialMetadata(token)
  if (!resolved) {
    return { robots: NOINDEX }
  }

  let title: string
  let description: string
  if (resolved.protected) {
    title = 'Shared file'
    description = 'Authentication is required to view this file.'
  } else {
    title = resolved.metadata.file.originalName
    description =
      buildProvenance(resolved.metadata.workspaceName, resolved.metadata.ownerName) ||
      `Shared file · ${title}`
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
  try {
    const auth = await authorizePublicFileShare({
      token,
      credential: await publicFileShareCredential((await cookies()).getAll()),
    })
    if (!auth.authorized) {
      if (auth.authType === 'sso') return <PublicFileSSOAuth token={token} />
      if (auth.authType === 'email') return <PublicFileEmailAuth token={token} />
      return <PublicFileAuth token={token} />
    }
    const { file, owner, workspaceName, ownerName } = await readPublicFileShare({
      grant: auth.grant,
    })
    return (
      <PublicFileView
        token={token}
        owner={owner}
        name={file.originalName}
        type={file.contentType}
        size={getWorkspaceFileSize(file)}
        version={file.updatedAt.getTime()}
        workspaceName={workspaceName}
        ownerName={ownerName}
      />
    )
  } catch (error) {
    if (asOrchestrationError(error)?.code === 'not_found') notFound()
    throw error
  }
}
