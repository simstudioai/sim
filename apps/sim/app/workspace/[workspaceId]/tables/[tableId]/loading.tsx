'use client'

import { Table as TableIcon } from '@sim/emcn/icons'
import {
  type BreadcrumbItem,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'

const noop = () => {}

const BREADCRUMBS: BreadcrumbItem[] = [
  { label: 'Tables', icon: TableIcon, onClick: noop },
  { label: '…', terminal: true },
]

export default function TableLoading() {
  // The table editor's header has no static actions at load (import/run controls
  // are data-gated) and its options bar is sort + filter with no search. The grid
  // body fills in once the editor mounts, so no table chrome is rendered here.
  return <ResourceChromeFallback icon={TableIcon} breadcrumbs={BREADCRUMBS} hasSort hasFilter />
}
