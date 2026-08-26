/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
  DAYTONA_TOOLBOX_BASE_URL,
  daytonaToolboxUrl,
  mapDaytonaSandbox,
} from '@/tools/daytona/utils'

describe('mapDaytonaSandbox', () => {
  it('surfaces the sandbox-scoped toolboxProxyUrl instead of discarding it', () => {
    const mapped = mapDaytonaSandbox({
      id: 'sb-1',
      name: 'demo',
      toolboxProxyUrl: 'https://proxy.eu.daytona.io/toolbox',
    })

    expect(mapped.toolboxProxyUrl).toBe('https://proxy.eu.daytona.io/toolbox')
  })

  it('reports null when the sandbox payload omits it', () => {
    expect(mapDaytonaSandbox({ id: 'sb-1' }).toolboxProxyUrl).toBeNull()
  })

  it('declares the field on the shared output property map', () => {
    expect(DAYTONA_SANDBOX_OUTPUT_PROPERTIES.toolboxProxyUrl.type).toBe('string')
  })
})

describe('daytonaToolboxUrl', () => {
  it('keeps the Cloud default when no per-sandbox base is supplied', () => {
    expect(daytonaToolboxUrl('sb-1', '/files')).toBe(`${DAYTONA_TOOLBOX_BASE_URL}/sb-1/files`)
  })

  it('binds to a per-sandbox toolbox host when one is supplied', () => {
    expect(daytonaToolboxUrl('sb-1', '/files', 'https://proxy.eu.daytona.io/toolbox/')).toBe(
      'https://proxy.eu.daytona.io/toolbox/sb-1/files'
    )
  })
})
