/**
 * @vitest-environment node
 */
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { SITE_URL } from '@/lib/core/utils/urls'

const SIM_ROOT = path.resolve(__dirname, '..', '..')
const APP_DIR = path.resolve(SIM_ROOT, 'app')
const LANDING_DIR = path.resolve(APP_DIR, '(landing)')

/**
 * All directories containing public-facing pages or SEO-relevant code.
 * Non-marketing app routes (workspace, chat, form) are excluded —
 * they legitimately use getBaseUrl() for dynamic, env-dependent URLs.
 */
const SEO_SCAN_DIRS = [
  LANDING_DIR,
  path.resolve(APP_DIR, 'changelog'),
  path.resolve(APP_DIR, 'changelog.xml'),
  path.resolve(APP_DIR, 'academy'),
  path.resolve(SIM_ROOT, 'lib', 'blog'),
  path.resolve(SIM_ROOT, 'content', 'blog'),
]

const SEO_SCAN_INDIVIDUAL_FILES = [
  path.resolve(APP_DIR, 'page.tsx'),
  path.resolve(SIM_ROOT, 'ee', 'whitelabeling', 'metadata.ts'),
]

function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, exts))
    } else if (exts.some((ext) => entry.name.endsWith(ext)) && !entry.name.includes('.test.')) {
      results.push(full)
    }
  }
  return results
}

function getAllSeoFiles(exts: string[]): string[] {
  const files: string[] = []
  for (const dir of SEO_SCAN_DIRS) {
    files.push(...collectFiles(dir, exts))
  }
  for (const file of SEO_SCAN_INDIVIDUAL_FILES) {
    if (fs.existsSync(file)) files.push(file)
  }
  return files
}

describe('SEO canonical URLs', () => {
  it('SITE_URL equals https://www.sim.ai', () => {
    expect(SITE_URL).toBe('https://www.sim.ai')
  })

  it('public pages do not hardcode https://sim.ai (without www)', () => {
    const files = getAllSeoFiles(['.ts', '.tsx', '.mdx'])
    const violations: string[] = []

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      const lines = content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const hasBareSimAi =
          line.includes("'https://sim.ai'") ||
          line.includes("'https://sim.ai/") ||
          line.includes('"https://sim.ai"') ||
          line.includes('"https://sim.ai/') ||
          line.includes('`https://sim.ai/') ||
          line.includes('`https://sim.ai`') ||
          line.includes('canonical: https://sim.ai/')

        if (!hasBareSimAi) continue

        const isAllowlisted =
          line.includes('https://sim.ai/careers') || line.includes('https://sim.ai/discord')

        if (isAllowlisted) continue

        const rel = path.relative(SIM_ROOT, file)
        violations.push(`${rel}:${i + 1}: ${line.trim()}`)
      }
    }

    expect(
      violations,
      `Found hardcoded https://sim.ai (without www):\n${violations.join('\n')}`
    ).toHaveLength(0)
  })

  it('public pages do not use getBaseUrl() for SEO metadata', () => {
    const files = getAllSeoFiles(['.ts', '.tsx'])
    const violations: string[] = []

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')

      if (!content.includes('getBaseUrl')) continue

      const hasMetadataExport =
        content.includes('export const metadata') ||
        content.includes('export async function generateMetadata')
      const usesGetBaseUrlInMetadata =
        hasMetadataExport &&
        (content.includes('= getBaseUrl()') || content.includes('metadataBase: new URL(getBaseUrl'))

      if (usesGetBaseUrlInMetadata) {
        const rel = path.relative(SIM_ROOT, file)
        violations.push(rel)
      }
    }

    expect(
      violations,
      `Public pages should use SITE_URL for metadata, not getBaseUrl():\n${violations.join('\n')}`
    ).toHaveLength(0)
  })
})
