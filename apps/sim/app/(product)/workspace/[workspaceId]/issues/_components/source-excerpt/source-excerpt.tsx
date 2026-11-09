import { Icon } from '@sim/emcn/icon'
import styles from '@/app/(product)/workspace/[workspaceId]/issues/_components/source-excerpt/source-excerpt.module.css'

interface SourceExcerptProps {
  provider: { id: string; name: string }
  source: string
  quote: string
}

/** The words an issue started from, with where they were said. */
export function SourceExcerpt({ provider, source, quote }: SourceExcerptProps) {
  return (
    <figure className={styles.excerpt}>
      <figcaption className={styles.source} data-type='T050'>
        <Icon providerId={provider.id} label={provider.name} />
        {source}
      </figcaption>
      <blockquote data-type='T048'>{quote}</blockquote>
    </figure>
  )
}
