import type { Metadata } from 'next'
import { DocsGallery } from '@/components/docs/gallery'
import { DocsPageFrame } from '@/components/docs/page-frame'

export const metadata: Metadata = {
  title: 'Docs component library',
  robots: { index: false, follow: false },
}

export default function DesignSystemPage() {
  return (
    <DocsPageFrame headings={[]}>
      <main id='main-content' tabIndex={-1}>
        <DocsGallery />
      </main>
    </DocsPageFrame>
  )
}
