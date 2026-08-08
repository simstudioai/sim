import type { Metadata } from 'next'
import { FullscreenFileView } from '@/app/workspace/[workspaceId]/files/[fileId]/view/fullscreen-file-view'

export const metadata: Metadata = {
  title: 'File',
  robots: { index: false },
}

export default FullscreenFileView
