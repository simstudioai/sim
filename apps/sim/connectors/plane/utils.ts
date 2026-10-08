import { toArray, toRecord } from '@sim/utils/object'
import { z } from 'zod'
import type { ExternalDocument } from '@/connectors/types'
import { computeContentHash, htmlToPlainText } from '@/connectors/utils'
import { planePageContentSchema, planeWorkItemContentSchema } from '@/tools/plane/schemas'
import { safeUrlPathSegment } from '@/tools/url-path'

export interface PlaneContentConfig {
  workspaceSlug: string
  projectId: string
  webUrl: string
}

const paginationResponseSchema = z.object({
  results: z.array(z.unknown()),
  next_page_results: z.boolean(),
  next_cursor: z.string().nullable().optional(),
})

/** Rejects malformed or non-advancing listings instead of reporting a complete empty source. */
export function parsePlanePage(value: unknown, currentCursor?: string) {
  const page = paginationResponseSchema.parse(value)
  if (page.next_page_results && (!page.next_cursor || page.next_cursor === currentCursor)) {
    throw new Error('Plane returned a missing or repeated pagination cursor')
  }
  return {
    results: page.results,
    nextCursor: page.next_page_results ? (page.next_cursor ?? undefined) : undefined,
  }
}

function sourceUrl(config: PlaneContentConfig, resource: string, id: string): string {
  return `${config.webUrl}/${safeUrlPathSegment(config.workspaceSlug, 'workspaceSlug')}/projects/${safeUrlPathSegment(config.projectId, 'projectId')}/${resource}/${safeUrlPathSegment(id, 'id')}`
}

function contentText(record: Record<string, unknown>): string {
  if (typeof record.description_html === 'string' && record.description_html)
    return htmlToPlainText(record.description_html)
  if (typeof record.description_stripped === 'string') return record.description_stripped
  return typeof record.description === 'string' ? htmlToPlainText(record.description) : ''
}

function names(value: unknown): string[] {
  return toArray(value).flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    const record = toRecord(entry)
    const name = record.display_name ?? record.name ?? record.id
    return typeof name === 'string' ? [name] : []
  })
}

/** Maps inline work item content consistently for both listing and detail reads. */
export async function planeWorkItemDocument(
  value: unknown,
  config: PlaneContentConfig
): Promise<ExternalDocument> {
  const item = planeWorkItemContentSchema.parse(value)
  if (!item.id) throw new Error('Plane work item response is missing its ID')
  const name = item.name?.trim() || 'Untitled work item'
  const title = item.sequence_id == null ? name : `#${item.sequence_id}: ${name}`
  const state = typeof item.state === 'string' ? item.state : toRecord(item.state).name
  const assignees = names(item.assignees)
  const labels = names(item.labels)
  const content = [
    title,
    typeof state === 'string' ? `State: ${state}` : '',
    item.priority ? `Priority: ${item.priority}` : '',
    assignees.length ? `Assignees: ${assignees.join(', ')}` : '',
    labels.length ? `Labels: ${labels.join(', ')}` : '',
    item.updated_at ? `Last updated: ${item.updated_at}` : '',
    '',
    contentText(item),
  ]
    .filter((line) => line !== '')
    .join('\n')
  return {
    externalId: `work_item:${item.id}`,
    title,
    content,
    mimeType: 'text/plain',
    contentHash: await computeContentHash(content),
    sourceUrl: sourceUrl(config, 'issues', item.id),
    metadata: {
      projectId: config.projectId,
      state,
      priority: item.priority,
      assignees,
      labels,
      lastModified: item.updated_at,
    },
  }
}

/** A page's list and hydrated representations share the provider's modification-version hash. */
export function planePageDocument(
  value: unknown,
  config: PlaneContentConfig,
  deferred: boolean
): ExternalDocument {
  const page = planePageContentSchema.parse(value)
  if (!page.id || !page.updated_at)
    throw new Error('Plane page response is missing its ID or modification timestamp')
  const title = page.name?.trim() || 'Untitled page'
  return {
    externalId: `page:${page.id}`,
    title,
    content: deferred ? '' : [title, contentText(page)].filter(Boolean).join('\n\n'),
    contentDeferred: deferred,
    mimeType: 'text/plain',
    contentHash: `plane:page:${page.id}:${page.updated_at}`,
    sourceUrl: sourceUrl(config, 'pages', page.id),
    metadata: { projectId: config.projectId, lastModified: page.updated_at },
  }
}
