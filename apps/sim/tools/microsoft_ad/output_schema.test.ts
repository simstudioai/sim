/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getOutputPathsFromSchema } from '@/lib/workflows/blocks/block-outputs'
import * as microsoftAdTools from '@/tools/microsoft_ad'
import type { OutputProperty } from '@/tools/types'

/**
 * `generateOutputPaths` and the docs generator both read an array's item shape from
 * `items.properties`. An array that hangs its fields off a top-level `properties` type-checks but
 * is invisible to both: the tag dropdown offers only the bare array name and
 * `<microsoftad.users.displayName>` resolves to nothing.
 */
function collectArrayProperties(
  outputs: Record<string, OutputProperty>,
  path: string[] = []
): string[] {
  const offenders: string[] = []
  for (const [key, definition] of Object.entries(outputs)) {
    const here = [...path, key]
    if (definition.type === 'array' && definition.properties) {
      offenders.push(here.join('.'))
    }
    if (definition.properties) {
      offenders.push(...collectArrayProperties(definition.properties, here))
    }
    if (definition.items?.properties) {
      offenders.push(...collectArrayProperties(definition.items.properties, here))
    }
  }
  return offenders
}

describe('microsoft_ad array outputs', () => {
  const tools = Object.entries(microsoftAdTools) as Array<
    [string, { outputs?: Record<string, OutputProperty> }]
  >

  it('never hangs array item fields off a top-level properties key', () => {
    const offenders = tools.flatMap(([name, tool]) =>
      collectArrayProperties(tool.outputs ?? {}).map((path) => `${name}.${path}`)
    )

    expect(offenders).toEqual([])
  })

  it('exposes row fields as referenceable output paths', () => {
    expect(getOutputPathsFromSchema(microsoftAdTools.microsoftAdListUsersTool.outputs!)).toEqual(
      expect.arrayContaining([
        'users.id',
        'users.displayName',
        'users.userPrincipalName',
        'users.accountEnabled',
      ])
    )
    expect(getOutputPathsFromSchema(microsoftAdTools.microsoftAdListDevicesTool.outputs!)).toEqual(
      expect.arrayContaining(['devices.id', 'devices.deviceId', 'devices.operatingSystem'])
    )
    expect(getOutputPathsFromSchema(microsoftAdTools.microsoftAdListGroupsTool.outputs!)).toEqual(
      expect.arrayContaining(['groups.id', 'groups.displayName', 'groups.securityEnabled'])
    )
  })

  it('expands array item fields nested inside another array item', () => {
    const paths = getOutputPathsFromSchema(
      microsoftAdTools.microsoftAdListServicePrincipalsTool.outputs!
    )

    expect(paths).toEqual(
      expect.arrayContaining([
        'servicePrincipals.id',
        'servicePrincipals.appId',
        'servicePrincipals.appRoles.id',
        'servicePrincipals.appRoles.value',
      ])
    )
  })

  it('expands array item fields reached through a shared property constant', () => {
    expect(
      getOutputPathsFromSchema(microsoftAdTools.microsoftAdListSubscribedSkusTool.outputs!)
    ).toEqual(
      expect.arrayContaining([
        'skus.skuPartNumber',
        'skus.servicePlans.servicePlanId',
        'skus.servicePlans.provisioningStatus',
      ])
    )
    expect(
      getOutputPathsFromSchema(microsoftAdTools.microsoftAdListDirectoryAuditsTool.outputs!)
    ).toEqual(
      expect.arrayContaining([
        'audits.activityDisplayName',
        'audits.targetResources.id',
        'audits.targetResources.type',
      ])
    )
  })

  it('covers every array output the integration declares', () => {
    const arrayOutputs = tools.flatMap(([name, tool]) =>
      Object.entries(tool.outputs ?? {})
        .filter(([, definition]) => definition.type === 'array')
        .map(([key]) => `${name}.${key}`)
    )

    expect(arrayOutputs.length).toBeGreaterThanOrEqual(16)
  })
})
