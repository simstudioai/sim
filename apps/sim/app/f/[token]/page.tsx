import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { PublicFileView } from '@/app/f/[token]/public-file-view'

export const dynamic = 'force-dynamic'

/** Shared links must never be indexed by search engines. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

interface PublicFilePageProps {
  params: Promise<{ token: string }>
}

export default async function PublicFilePage({ params }: PublicFilePageProps) {
  const { token } = await params

  const resolved = await resolveActiveShareByToken(token)
  if (!resolved) {
    notFound()
  }

  const { file, workspaceName, ownerName } = resolved

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
