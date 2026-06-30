import { cache } from 'react'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import {
  deploymentAuthCookieName,
  isEmailAllowed,
  validateAuthToken,
} from '@/lib/core/security/deployment'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { PublicFileAuth } from '@/app/f/[token]/public-file-auth'
import { PublicFileEmailAuth } from '@/app/f/[token]/public-file-email-auth'
import { PublicFileSSOAuth } from '@/app/f/[token]/public-file-sso-auth'
import { PublicFileView } from '@/app/f/[token]/public-file-view'
import { buildProvenance } from '@/app/f/[token]/utils'
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

/** The auth-relevant slice of a resolved share row. */
interface GateShare {
  id: string
  authType: string
  password: string | null
  allowedEmails: unknown
}

/**
 * Returns the auth prompt to render when a protected share is not yet authorized,
 * or `null` when the visitor may view the file. `password`/`email` use the
 * `file_auth_{shareId}` cookie; `sso` uses the global Sim session.
 */
async function renderAuthGate(token: string, share: GateShare) {
  if (share.authType === 'public') return null

  if (share.authType === 'sso') {
    const session = await getSession()
    const allowedEmails = Array.isArray(share.allowedEmails)
      ? (share.allowedEmails as string[])
      : []
    const authorized = Boolean(
      session?.user?.email && isEmailAllowed(session.user.email, allowedEmails)
    )
    return authorized ? null : <PublicFileSSOAuth token={token} />
  }

  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(deploymentAuthCookieName('file', share.id))?.value
  if (validateAuthToken(cookieValue ?? '', share.id, share.authType, share.password)) return null

  return share.authType === 'email' ? (
    <PublicFileEmailAuth token={token} />
  ) : (
    <PublicFileAuth token={token} />
  )
}

export default async function PublicFilePage({ params }: PublicFilePageProps) {
  const { token } = await params

  const resolved = await resolveShare(token)
  if (!resolved) {
    notFound()
  }

  const { share, file, workspaceName, ownerName } = resolved

  const gate = await renderAuthGate(token, share)
  if (gate) return gate

  return (
    <PublicFileView
      token={token}
      name={file.originalName}
      type={file.contentType}
      size={file.size}
      version={file.updatedAt.getTime()}
      workspaceName={workspaceName}
      ownerName={ownerName}
    />
  )
}
