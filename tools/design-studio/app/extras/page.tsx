import { GeneratedGallery } from '@studio/_components/generated-gallery'
import { getStudioPageManifest } from '@studio/_lib/manifest'

export const dynamic = 'force-dynamic'

export default function ExtrasPage() {
  const run = getStudioPageManifest('extras')
  return run ? (
    <GeneratedGallery
      mode='extras'
      manifest={run.manifest}
      stale={run.stale}
      ledgerStale={run.ledgerStale}
    />
  ) : (
    <p className='mx-auto max-w-5xl px-6 py-10 text-[var(--text-body)] text-sm'>
      No generated run found. Run the local studio:refresh command to scan and capture the catalog.
    </p>
  )
}
