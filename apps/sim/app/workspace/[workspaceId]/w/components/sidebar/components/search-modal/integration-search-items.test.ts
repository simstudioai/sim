/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks/registry', () => ({ getAllBlockMeta: () => ({}), getAllBlocks: () => [] }))

import { CONNECT_MODE } from '@/app/workspace/[workspaceId]/integrations/connect-route'
import { buildIntegrationSearchItems } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/integration-search-items'

/** An OAuth integration, a stored-service-account one, and one with no credential. */
const OAUTH_SLUG = 'airtable'
const SERVICE_ACCOUNT_SLUG = 'claude-managed-agents'
const NO_CREDENTIAL_SLUG = '1password'

function hrefFor(slug: string, items: ReturnType<typeof buildIntegrationSearchItems>): string {
  const item = items.find((candidate) => candidate.id === slug)
  if (!item) throw new Error(`Missing search item for ${slug}`)
  return item.href
}

describe('buildIntegrationSearchItems', () => {
  it('deep-links each integration to the connect flow its catalog entry describes', () => {
    const items = buildIntegrationSearchItems('workspace-1')

    expect(hrefFor(OAUTH_SLUG, items)).toBe(
      `/workspace/workspace-1/integrations/${OAUTH_SLUG}?connect=${CONNECT_MODE.oauth}`
    )
    /**
     * The default is what the sidebar falls back to while deployment
     * availability is unknown. Assuming OAuth here would send this integration
     * to a detail page with no OAuth flow to open, and the deep link would
     * silently do nothing.
     */
    expect(hrefFor(SERVICE_ACCOUNT_SLUG, items)).toBe(
      `/workspace/workspace-1/integrations/${SERVICE_ACCOUNT_SLUG}?connect=${CONNECT_MODE.serviceAccount}`
    )
    expect(hrefFor(NO_CREDENTIAL_SLUG, items)).toBe(
      `/workspace/workspace-1/integrations/${NO_CREDENTIAL_SLUG}`
    )
  })

  it('offers the catalog flow to the resolver and never consults it without a credential', () => {
    const seen: Record<string, string> = {}
    const items = buildIntegrationSearchItems(
      'workspace-1',
      undefined,
      (blockType, catalogMode) => {
        seen[blockType] = catalogMode
        return catalogMode
      }
    )

    expect(seen.airtable).toBe(CONNECT_MODE.oauth)
    expect(seen.managed_agent).toBe(CONNECT_MODE.serviceAccount)
    expect(seen.onepassword).toBeUndefined()
    expect(hrefFor(NO_CREDENTIAL_SLUG, items)).toBe(
      `/workspace/workspace-1/integrations/${NO_CREDENTIAL_SLUG}`
    )
  })

  it('drops the deep link when the deployment offers no connect flow', () => {
    const items = buildIntegrationSearchItems('workspace-1', undefined, () => null)

    expect(hrefFor(OAUTH_SLUG, items)).toBe(`/workspace/workspace-1/integrations/${OAUTH_SLUG}`)
    expect(hrefFor(SERVICE_ACCOUNT_SLUG, items)).toBe(
      `/workspace/workspace-1/integrations/${SERVICE_ACCOUNT_SLUG}`
    )
  })

  it('applies the block allowlist', () => {
    const items = buildIntegrationSearchItems(
      'workspace-1',
      (blockType) => blockType === 'managed_agent'
    )

    expect(items.map((item) => item.id)).toEqual([SERVICE_ACCOUNT_SLUG])
  })
})
