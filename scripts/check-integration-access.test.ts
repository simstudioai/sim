import { describe, expect, it } from 'vitest'
import { findIntegrationAccessViolations } from './check-integration-access'

const GATE = `import { useIntegrationAccess } from '@/hooks/use-integration-access'
const { getAccess } = useIntegrationAccess(workspaceId)`

function check(sources: Record<string, string>, exempt: Record<string, string> = {}) {
  return findIntegrationAccessViolations(
    Object.entries(sources).map(([path, source]) => ({ path, source })),
    exempt
  )
}

describe('findIntegrationAccessViolations', () => {
  it('flags a module that lists a raw catalog without the access gate', () => {
    const source = "import { listIntegrations } from '@/blocks/integration-matcher'"
    expect(check({ 'app/picker.ts': source })).toEqual([
      expect.objectContaining({ path: 'app/picker.ts', names: ['listIntegrations'] }),
    ])
  })

  it('flags a renamed or multi-line raw import', () => {
    const source = `import {
  blockTypeToIconMap,
  INTEGRATIONS as ALL_INTEGRATIONS,
} from '@/lib/integrations'`
    expect(check({ 'app/list.tsx': source })).toEqual([
      expect.objectContaining({ path: 'app/list.tsx', names: ['INTEGRATIONS'] }),
    ])
  })

  it('flags a raw catalog read through a namespace import', () => {
    const source = `import * as metadata from '@sim/deployment-config/integration-metadata'
export const types = metadata.INTEGRATION_METADATA.map((entry) => entry.type)`
    expect(check({ 'ee/tile.tsx': source })).toEqual([
      expect.objectContaining({ path: 'ee/tile.tsx', names: ['INTEGRATION_METADATA'] }),
    ])
  })

  it('treats a namespace used other than by member access as reading every export', () => {
    const destructured = `import * as matcher from '@/blocks/integration-matcher'
const { listIntegrations } = matcher`
    const indexed = `import * as matcher from '@/blocks/integration-matcher'
export const all = matcher['listIntegrations']()`
    const policy = `import * as access from '@/hooks/use-integration-access'
const { useIntegrationAccessPolicy } = access`
    expect(check({ 'app/a.ts': destructured, 'app/b.ts': indexed, 'app/c.ts': policy })).toEqual([
      expect.objectContaining({
        path: 'app/a.ts',
        names: ['listIntegrations', 'listIntegrationsByPopularity'],
      }),
      expect.objectContaining({
        path: 'app/b.ts',
        names: ['listIntegrations', 'listIntegrationsByPopularity'],
      }),
      expect.objectContaining({ path: 'app/c.ts', names: ['useIntegrationAccessPolicy'] }),
    ])
  })

  it('flags a raw listing that imports the gate without calling it', () => {
    const source = `import { useIntegrationAccess } from '@/hooks/use-integration-access'
import { listIntegrations } from '@/blocks/integration-matcher'`
    expect(check({ 'app/picker.ts': source })).toHaveLength(1)
  })

  it('accepts the gate called through a namespace or a renamed binding', () => {
    const namespaced = `import * as access from '@/hooks/use-integration-access'
import { INTEGRATIONS } from '@/lib/integrations'
const { getAccess } = access.useIntegrationAccess(workspaceId)`
    const renamed = `import { useIntegrationAccess as useAccess } from '@/hooks/use-integration-access'
import { INTEGRATIONS } from '@/lib/integrations'
const { getAccess } = useAccess(workspaceId)`
    expect(check({ 'app/a.tsx': namespaced, 'app/b.tsx': renamed })).toEqual([])
  })

  it('accepts a raw catalog read alongside the access gate', () => {
    const source = `${GATE}\nimport { INTEGRATIONS } from '@/lib/integrations'`
    expect(check({ 'app/catalog.tsx': source })).toEqual([])
  })

  it('ignores type-only imports and non-catalog names from the same module', () => {
    const source = `import type { INTEGRATIONS } from '@/lib/integrations'
import { blockTypeToIconMap, type Integration } from '@/lib/integrations'
import { type listIntegrations } from '@/blocks/integration-matcher'`
    expect(check({ 'app/icons.tsx': source })).toEqual([])
  })

  it('accepts an exempt file or directory', () => {
    const source = "import { INTEGRATIONS } from '@/lib/integrations'"
    expect(
      check(
        { 'app/sitemap.ts': source, 'app/(landing)/integrations/page.tsx': source },
        { 'app/sitemap.ts': 'public', 'app/(landing)/': 'public' }
      )
    ).toEqual([])
  })

  it('refuses the fail-open policy through a namespace import', () => {
    const source = `import * as access from '@/hooks/use-integration-access'
const { policy } = access.useIntegrationAccessPolicy(workspaceId)`
    expect(check({ 'app/picker.tsx': source })).toEqual([
      expect.objectContaining({ path: 'app/picker.tsx', names: ['useIntegrationAccessPolicy'] }),
    ])
  })

  it('refuses the fail-open access policy outside the permission config hook', () => {
    const source = "import { useIntegrationAccessPolicy } from '@/hooks/use-integration-access'"
    expect(check({ 'app/picker.tsx': source, 'hooks/use-permission-config.ts': source })).toEqual([
      expect.objectContaining({ path: 'app/picker.tsx', names: ['useIntegrationAccessPolicy'] }),
    ])
  })

  it('reports an exemption that no longer covers a raw catalog import', () => {
    expect(check({ 'app/sitemap.ts': 'export {}' }, { 'app/sitemap.ts': 'public' })).toEqual([
      expect.objectContaining({ path: 'app/sitemap.ts', stale: true }),
    ])
  })
})
