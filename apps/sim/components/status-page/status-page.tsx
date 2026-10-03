import {
  cn,
  PAGE_CONTENT_WIDTH,
  PAGE_GUTTER,
  StatusPageContent,
  type StatusPageContentProps,
} from '@sim/emcn'

interface StatusPageProps extends StatusPageContentProps {
  id?: string
}

/** Shared landing-shell page frame for route-specific not-found states. */
export function StatusPage({ id = 'main-content', ...content }: StatusPageProps) {
  return (
    <main
      id={id}
      className={cn(
        'flex min-h-[60vh] flex-col items-center justify-center py-24',
        PAGE_CONTENT_WIDTH,
        PAGE_GUTTER
      )}
    >
      <StatusPageContent {...content} />
    </main>
  )
}
