/**
 * Curated `from → to` block-pair workflows for the landing page, derived from
 * each block's `*BlockMeta` export.
 *
 * Split out of the `@/lib/integrations` barrel rather than living beside the
 * rest of the catalog data, because building this list calls `getAllBlockMeta()`
 * at module scope. That single call pulls `@/blocks/registry` →
 * `blocks/registry-maps` → all 282 block configs → the tool registry, and any
 * client component importing *anything* from the barrel inherited the whole
 * graph. The landing `/integrations` grid is a client component, so a public
 * marketing page was shipping the full registry to render a catalog of names
 * and icons.
 *
 * Keeping it in its own module means the one server component that needs it
 * imports it directly, and the barrel stays free of `@/blocks` value imports.
 */

import { stripVersionSuffix } from '@sim/utils/string'
import { INTEGRATIONS } from '@/lib/integrations'
import { getAllBlockMeta } from '@/blocks/registry'

/** A curated `from → to` block-pair workflow surfaced on the landing page. */
export interface PopularWorkflow {
  /** Integration display name (matches `Integration.name`). */
  from: string
  /** Integration display name. */
  to: string
  headline: string
  description: string
}

const TYPE_TO_NAME = new Map<string, string>()
for (const integration of INTEGRATIONS) {
  TYPE_TO_NAME.set(integration.type, integration.name)
  TYPE_TO_NAME.set(stripVersionSuffix(integration.type), integration.name)
}

/**
 * Templates flagged `featured: true` that reference at least one other
 * integration. Each entry's `from` is the owner block, `to` is the first
 * `alsoIntegrations` entry, and `headline`/`description` come from the template
 * title and prompt.
 */
export const POPULAR_WORKFLOWS: readonly PopularWorkflow[] = (() => {
  const pairs: PopularWorkflow[] = []
  for (const [ownerType, meta] of Object.entries(getAllBlockMeta())) {
    for (const template of meta.templates ?? []) {
      if (!template.featured) continue
      const toType = template.alsoIntegrations?.[0]
      if (!toType) continue
      const from = TYPE_TO_NAME.get(ownerType) ?? TYPE_TO_NAME.get(stripVersionSuffix(ownerType))
      const to = TYPE_TO_NAME.get(toType) ?? TYPE_TO_NAME.get(stripVersionSuffix(toType))
      if (!from || !to) continue
      pairs.push({ from, to, headline: template.title, description: template.prompt })
    }
  }
  return pairs
})()
