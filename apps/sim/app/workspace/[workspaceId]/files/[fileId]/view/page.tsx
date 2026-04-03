import type { Metadata } from 'next'
import { FileViewer } from './file-viewer'

export const metadata: Metadata = {
  title: 'File',
  robots: { index: false },
}

export default FileViewer
