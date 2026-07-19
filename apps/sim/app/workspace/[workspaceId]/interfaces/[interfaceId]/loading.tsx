'use client'

import { Eye, Panels, Pencil } from '@sim/emcn/icons'
import { noop } from '@sim/utils/helpers'
import {
  type BreadcrumbItem,
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'

const BREADCRUMBS: BreadcrumbItem[] = [
  { label: 'Interfaces', icon: Panels, onClick: noop },
  { label: '…', terminal: true },
]

/** `edit` is the default mode, so the fallback paints Edit as the active chip. */
const ACTIONS: ChromeActionSpec[] = [
  { text: 'Edit', icon: Pencil, active: true },
  { text: 'Preview', icon: Eye },
]

/**
 * Route-transition fallback. The editor has no options bar and no resource
 * table — the canvas and the properties panel mount with the interface — so
 * only the header chrome is painted here.
 */
export default function InterfaceLoading() {
  return <ResourceChromeFallback icon={Panels} breadcrumbs={BREADCRUMBS} actions={ACTIONS} />
}
