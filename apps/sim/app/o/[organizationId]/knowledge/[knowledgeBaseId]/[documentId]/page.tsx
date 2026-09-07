import { ChipLink } from '@sim/emcn'
import { notFound, redirect } from 'next/navigation'
import { readSearchDocumentResultSchema } from '@/lib/api/contracts/knowledge/documents'
import { getSession } from '@/lib/auth'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readSearchDocument } from '@/lib/knowledge/application/read-search-document'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

interface OrganizationDocumentPageProps {
  params: Promise<{ organizationId: string; knowledgeBaseId: string; documentId: string }>
  searchParams: Promise<{ offset?: string }>
}

export default async function OrganizationDocumentPage({
  params,
  searchParams,
}: OrganizationDocumentPageProps) {
  const { organizationId, knowledgeBaseId, documentId } = await params
  const { offset: rawOffset } = await searchParams
  const offset = rawOffset === undefined ? 0 : Number(rawOffset)
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000) notFound()
  const href = `/o/${encodeURIComponent(organizationId)}/knowledge/${encodeURIComponent(knowledgeBaseId)}/${encodeURIComponent(documentId)}`
  const session = await getSession()
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: offset ? `${href}?offset=${offset}` : href,
        isInviteFlow: false,
      })
    )
  }
  const registry = new ResolvedSecretTraceRegistry()
  let result: Awaited<ReturnType<typeof readSearchDocument.execute>>
  try {
    result = await readSearchDocument.execute({
      principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
      input: {
        documentId,
        assertedOrganizationId: organizationId,
        offset,
        limit: 20,
        resultSecretRegistry: registry,
      },
    })
  } catch (error) {
    if (
      error instanceof OrchestrationError &&
      (error.code === 'not_found' || error.code === 'forbidden')
    )
      notFound()
    throw error
  }
  if (result.knowledgeBaseId !== knowledgeBaseId) notFound()
  const projected = projectResolvedSecretModelContent(result, registry, 1024 * 1024)
  if (!projected.safe) return <p className='p-6'>This document cannot be displayed safely.</p>
  const document = readSearchDocumentResultSchema.parse(projected.value)
  return (
    <div className='min-h-0 flex-1 overflow-y-auto p-6'>
      <article className='mx-auto flex max-w-chat flex-col gap-6'>
        <h1 className='text-2xl text-[var(--text-primary)]'>
          {document.documentName ?? 'Document'}
        </h1>
        {document.chunks.map((chunk) => (
          <p
            key={chunk.chunkIndex}
            className='whitespace-pre-wrap break-words text-[var(--text-body)] text-base'
          >
            {chunk.content}
          </p>
        ))}
        <nav className='flex gap-2' aria-label='Document pages'>
          {offset > 0 && (
            <ChipLink href={`${href}?offset=${Math.max(0, offset - 20)}`}>Previous</ChipLink>
          )}
          {document.nextOffset !== null && (
            <ChipLink href={`${href}?offset=${document.nextOffset}`}>Next</ChipLink>
          )}
        </nav>
      </article>
    </div>
  )
}
