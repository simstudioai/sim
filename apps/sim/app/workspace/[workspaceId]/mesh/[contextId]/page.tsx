'use client'

import { useParams } from 'next/navigation'
import { MeshThreadView } from '@/app/workspace/[workspaceId]/mesh/components/mesh-thread-view'

export default function MeshThreadPage() {
  const params = useParams()
  const contextId = params.contextId as string

  return <MeshThreadView contextId={contextId} />
}
