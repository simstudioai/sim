import { expect, test } from '@playwright/test'

test('Playwright workers run on Node 22', () => {
  expect(process.release.name).toBe('node')
  expect(Number(process.versions.node.split('.')[0])).toBe(22)
  expect(process.execPath.toLowerCase()).not.toContain('bun')
  expect(process.env.NODE_OPTIONS).toContain('--dns-result-order=ipv4first')
})
