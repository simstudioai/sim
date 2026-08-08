'use client'

import { useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { KnowledgeBase } from '@/app/workspace/[workspaceId]/knowledge/[id]/knowledge-base'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { grantsFromPermissions, workspaceSource } from '@/resources'

interface KnowledgeRouteProps {
  id: string
  knowledgeBaseName?: string
}

/**
 * The knowledge page's client shell: it resolves the axes the route can supply
 * and mounts the surface.
 *
 * Exists because `page.tsx` is a Server Component and both `grants` and a
 * `ResourceSource` are client-only — grants comes from a React context, and a
 * source carries closures that cannot cross the RSC boundary.
 *
 * Reading `useParams()` here is legitimate where it was not inside the surface
 * itself: a route shell exists exactly once per page by definition, whereas the
 * knowledge base is also mounted in the chat panel beside it. Mirrors
 * `tables/[tableId]/table-route.tsx` and `files/[fileId]/view/fullscreen-file-view.tsx`.
 */
export function KnowledgeRoute({ id, knowledgeBaseName }: KnowledgeRouteProps) {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  const permissions = useUserPermissionsContext()
  const router = useRouter()

  const source = useMemo(
    () => workspaceSource({ kind: 'knowledge' as const, workspaceId, resourceId: id }),
    [workspaceId, id]
  )
  const grants = useMemo(() => grantsFromPermissions(permissions), [permissions])
  const navigate = useCallback((path: string) => router.push(path), [router])

  return (
    <KnowledgeBase
      id={id}
      knowledgeBaseName={knowledgeBaseName}
      source={source}
      grants={grants}
      onNavigate={navigate}
      host='page'
    />
  )
}
