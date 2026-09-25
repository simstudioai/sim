import type { ComponentProps } from 'react'
import { ResourceRow, type ResourceRowProps } from '@sim/emcn'
import Link from 'next/link'

interface SettingsResourceRowProps extends Omit<ResourceRowProps, 'renderLink'> {}

/**
 * App navigation adapter for the EMCN resource row. EMCN owns its tile, type,
 * spacing, hover, focus, and stretched hit area; Next owns route prefetching.
 * Existing callers keep `href` for real link semantics or `onClick` for actions.
 */
export function SettingsResourceRow(props: SettingsResourceRowProps) {
  if (props.href && !props.disabled) {
    const href = props.href
    return (
      <ResourceRow
        {...props}
        renderLink={(linkProps: ComponentProps<'a'>) => <Link {...linkProps} href={href} />}
      />
    )
  }

  return <ResourceRow {...props} />
}
