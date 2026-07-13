/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const organizationWorkspacesSource = readFileSync(
  new URL('../../workspaces/organization-workspaces.ts', import.meta.url),
  'utf8'
)
const adminMoveSource = readFileSync(
  new URL('../../workspaces/admin-move.ts', import.meta.url),
  'utf8'
)
const membershipSource = readFileSync(
  new URL('../organizations/membership.ts', import.meta.url),
  'utf8'
)
const workspaceRouteSource = readFileSync(
  new URL('../../../app/api/workspaces/[id]/route.ts', import.meta.url),
  'utf8'
)
const workspaceUtilsSource = readFileSync(
  new URL('../../workspaces/utils.ts', import.meta.url),
  'utf8'
)

function countHelperCalls(source: string, helper = 'changeWorkspaceStoragePayerInTx'): number {
  return source.match(new RegExp(`await ${helper}\\(`, 'g'))?.length ?? 0
}

describe('workspace payer mutation callsites', () => {
  it('routes organization attach and detach through one batch call each', () => {
    expect(countHelperCalls(organizationWorkspacesSource, 'changeWorkspaceStoragePayersInTx')).toBe(
      2
    )
    expect(countHelperCalls(organizationWorkspacesSource)).toBe(0)
    expect(organizationWorkspacesSource).not.toMatch(
      /\.update\(workspace\)[\s\S]{0,180}\.set\(\{\s*organizationId/
    )
  })

  it('routes admin workspace moves through the transaction helper', () => {
    expect(countHelperCalls(adminMoveSource)).toBe(1)
    expect(adminMoveSource).not.toContain(
      'organizationId: params.destinationOrganizationId,\n            workspaceMode'
    )
  })

  it('routes organization ownership billed-account changes through the same-payer batch helper', () => {
    expect(
      countHelperCalls(membershipSource, 'changeOrganizationWorkspaceBilledAccountsInTx')
    ).toBe(1)
    expect(countHelperCalls(membershipSource)).toBe(0)
    expect(membershipSource).not.toMatch(
      /\.update\(workspace\)[\s\S]{0,120}\.set\(\{\s*billedAccountUserId/
    )
  })

  it('routes direct billed-account changes through the helper transaction', () => {
    expect(countHelperCalls(workspaceRouteSource)).toBe(1)
    expect(workspaceRouteSource).not.toContain('updateData.billedAccountUserId')
  })

  it('routes departing-user billed-account reassignment through the helper', () => {
    expect(countHelperCalls(workspaceUtilsSource)).toBe(1)
    expect(workspaceUtilsSource).not.toMatch(
      /\.update\(workspaceTable\)[\s\S]{0,120}\.set\(\{\s*billedAccountUserId/
    )
  })
})
