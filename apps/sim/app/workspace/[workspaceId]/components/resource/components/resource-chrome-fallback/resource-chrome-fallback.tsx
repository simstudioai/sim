'use client'

import type { ComponentType } from 'react'
import { noop } from '@sim/utils/helpers'
import type { BreadcrumbItem } from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'
import {
  Resource,
  type ResourceColumn,
} from '@/app/workspace/[workspaceId]/components/resource/resource'

/**
 * The static visual shape of a header action chip. The loading fallback only
 * needs the chrome (text/icon/variant/active) — handlers are no-ops during a
 * route transition — so the dynamic `onSelect`/`disabled` are intentionally
 * omitted. Mirrors {@link ResourceAction}'s chrome fields.
 */
export interface ChromeActionSpec {
  text: string
  icon?: ComponentType<{ className?: string }>
  variant?: 'primary' | 'destructive'
  active?: boolean
}

interface ResourceChromeFallbackProps {
  /** Title-mode icon (list pages) or breadcrumb-root icon (detail pages). */
  icon?: ComponentType<{ className?: string }>
  /** Title-mode label. Omit when `breadcrumbs` is supplied. */
  title?: string
  /**
   * Static breadcrumb trail for detail-route fallbacks. The live leaf name is
   * unknown at load, so pass the known root crumb(s) plus a terminal `…`
   * placeholder; it fills in once the page mounts.
   */
  breadcrumbs?: BreadcrumbItem[]
  /** Table column headers. Omit on bodies that don't render `Resource.Table` (the table editor). */
  columns?: ResourceColumn[]
  /** The page's exact header action chips (handlers wired to a no-op). */
  actions?: ChromeActionSpec[]
  /** Search placeholder. Omit to hide the search box (matches a page with no search). */
  searchPlaceholder?: string
  /** Paint the Sort chip (its menu never opens during the fallback, so the option list is irrelevant). */
  hasSort?: boolean
  /** Paint the Filter chip. */
  hasFilter?: boolean
}

/**
 * Route-transition fallback rendered by each resource route's `loading.tsx`. It
 * paints the REAL resource chrome — the header (icon/title or breadcrumbs + the
 * page's exact action chips), the options bar (search + the Filter/Sort chips),
 * and the table's column headers — with an empty body and no-op handlers, so a
 * navigation never shows a blank frame or a skeleton. Only the breadcrumb leaf
 * and the row data are unknown at load; everything else matches the loaded page.
 */
export function ResourceChromeFallback({
  icon,
  title,
  breadcrumbs,
  columns,
  actions,
  searchPlaceholder,
  hasSort = false,
  hasFilter = false,
}: ResourceChromeFallbackProps) {
  return (
    <Resource>
      <Resource.Header
        icon={icon}
        title={title}
        breadcrumbs={breadcrumbs}
        actions={actions?.map((action) => ({
          text: action.text,
          icon: action.icon,
          variant: action.variant,
          active: action.active,
          onSelect: noop,
        }))}
      />
      <Resource.Options
        search={
          searchPlaceholder !== undefined
            ? { value: '', onChange: noop, placeholder: searchPlaceholder }
            : undefined
        }
        sort={hasSort ? { options: [], active: null, onSort: noop } : undefined}
        filter={hasFilter ? { content: null } : undefined}
      />
      {columns ? <Resource.Table columns={columns} rows={[]} /> : null}
    </Resource>
  )
}
