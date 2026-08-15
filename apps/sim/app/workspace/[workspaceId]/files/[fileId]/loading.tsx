'use client'

import { File as FileIcon } from '@sim/emcn/icons'
import { noop } from '@sim/utils/helpers'
import {
  type BreadcrumbItem,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'
import { FOLDERED_RESOURCE_HEADERS } from '@/app/workspace/[workspaceId]/components/folders/foldered-resources'

const FILES_HEADER = FOLDERED_RESOURCE_HEADERS.file

/**
 * Transcribes the trail the loaded page shows while its record resolves (`loadingBreadcrumbs` in
 * `files.tsx`): the root crumb plus a terminal `…`, with no icon on the leaf — so the fallback and
 * the page paint the same two crumbs and only the label changes.
 */
const BREADCRUMBS: BreadcrumbItem[] = [
  { label: FILES_HEADER.rootLabel, icon: FileIcon, onClick: noop },
  { label: '…', terminal: true },
]

/**
 * Fallback for the file DETAIL route. Without it the segment inherits the Files list fallback, which
 * paints an options bar and a table header row that a document page does not have — chrome that has
 * to be torn down a frame later. A detail page is header + body, so this is the header alone.
 *
 * Header actions are deliberately omitted: they are a function of the open file (a previewable
 * non-markdown file gets a mode toggle, an editable one gets Share/Delete), which is exactly what is
 * not yet known here. Chips appearing beside the title reads as content arriving; chips appearing
 * and then changing reads as a glitch.
 */
export default function FilesFileLoading() {
  return <ResourceChromeFallback icon={FileIcon} breadcrumbs={BREADCRUMBS} />
}
