/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import packageJson from '@/package.json'
import {
  PI_BUN_VERSION,
  PI_GLOBAL_NPM_PACKAGES,
  PI_PACKAGE_VERSION,
} from '@/scripts/pi-sandbox-packages'

describe('Pi sandbox package contract', () => {
  it('keeps the sandbox Pi runtime aligned with the app SDK', () => {
    expect(PI_PACKAGE_VERSION).toBe(packageJson.dependencies['@earendil-works/pi-ai'])
    expect(PI_PACKAGE_VERSION).toBe(packageJson.dependencies['@earendil-works/pi-coding-agent'])
    expect(PI_GLOBAL_NPM_PACKAGES).toEqual([
      `bun@${PI_BUN_VERSION}`,
      `@earendil-works/pi-coding-agent@${PI_PACKAGE_VERSION}`,
      `@earendil-works/pi-agent-core@${PI_PACKAGE_VERSION}`,
      `@earendil-works/pi-ai@${PI_PACKAGE_VERSION}`,
      `@earendil-works/pi-tui@${PI_PACKAGE_VERSION}`,
    ])
  })
})
