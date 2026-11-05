import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isNoindexPath } from '@/lib/navigation/paths'
import { mapLegacyOrganizationUrl } from '@/lib/platform/routes'

const APP_ROOT = path.resolve(__dirname, '../../app')

describe('Platform zone mount', () => {
  it('leaves the marketing /platform page indexable', () => {
    expect(isNoindexPath('/platform')).toBe(false)
    expect(isNoindexPath('/org/home')).toBe(true)
  })

  it('owns a path no main-app page serves, since a static page beats an afterFiles rewrite', () => {
    const groups = readdirSync(APP_ROOT).filter((entry) => entry.startsWith('('))
    for (const root of ['.', ...groups]) {
      expect(existsSync(path.join(APP_ROOT, root, 'org'))).toBe(false)
    }
  })

  it('hands legacy organization routes to the mount', () => {
    expect(mapLegacyOrganizationUrl('/o/org-1/home', 'org-1')).toBe('/org/home')
  })
})
