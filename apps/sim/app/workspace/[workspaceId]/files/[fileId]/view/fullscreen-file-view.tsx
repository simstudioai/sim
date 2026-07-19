'use client'

import { useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { FileView } from '@/components/resources/file-view'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { grantsFromPermissions, workspaceSource } from '@/resources'

/**
 * One workspace file, filling the viewport. This is where an `@`-mention of a
 * file lands, so it renders the same view as the Files page rather than handing
 * the raw bytes to the browser.
 */
export function FullscreenFileView() {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  const fileId = typeof params?.fileId === 'string' ? params.fileId : ''
  const permissions = useUserPermissionsContext()
  const router = useRouter()

  const source = useMemo(
    () => workspaceSource({ kind: 'file', workspaceId, resourceId: fileId }),
    [workspaceId, fileId]
  )
  const grants = useMemo(() => grantsFromPermissions(permissions), [permissions])
  const navigate = useCallback((path: string) => router.push(path), [router])

  return (
    <div className='fixed inset-0 z-50 flex flex-col bg-[var(--bg)]'>
      <FileView source={source} grants={grants} host='page' onNavigate={navigate} readOnly />
    </div>
  )
}
