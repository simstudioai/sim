import { Fragment } from 'react'
import type { Prose } from '@/lib/compare/data'
import { ProseLink } from '@/app/(landing)/components/prose-page'

export interface ProseTextProps {
  prose: Prose
}

/**
 * Renders a {@link Prose} run as plain text with inline links. Pure server
 * component so answer engines read the full text without hydration.
 */
export function ProseText({ prose }: ProseTextProps) {
  return (
    <>
      {prose.map((segment, index) =>
        typeof segment === 'string' ? (
          <Fragment key={index}>{segment}</Fragment>
        ) : (
          <ProseLink key={index} href={segment.href}>
            {segment.text}
          </ProseLink>
        )
      )}
    </>
  )
}
