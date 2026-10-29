import type { Metadata } from 'next'
import { DocsGallery } from '@/components/docs/gallery'
import { DocsShell } from '@/components/docs/shell'
import { getNavigation } from '@/lib/content/catalog'

export const metadata: Metadata = {
  title: 'Docs component library',
  robots: { index: false, follow: false },
}

export default function DesignSystemPage() {
  return (
    <DocsShell navigation={getNavigation('docs')} pathname='/design-system' headings={[]}>
      <main id='main-content' tabIndex={-1}>
        <DocsGallery />
      </main>
    </DocsShell>
  )
}
