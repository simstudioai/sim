/**
 * COMPONENT UPDATER: Convert hardcoded strings to t() calls
 *
 * Strategy:
 * 1. Find components with hardcoded UI strings
 * 2. Check if useTranslations() already exists
 * 3. Extract hardcoded strings
 * 4. Add useTranslations() hook if missing
 * 5. Replace strings with t('key') calls
 * 6. Update catalogs if needed
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function getComponentFiles() {
  try {
    const result = execSync(
      `find apps/sim/app/\\(landing\\) apps/sim/components -name "*.tsx" -type f ! -path "*/node_modules/*" | head -20`,
      { cwd: ROOT, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    )
    return result.split('\n').filter(f => f)
  } catch {
    return []
  }
}

async function checkComponent(filePath: string): Promise<{ file: string; hasI18n: boolean; strings: string[] }> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const hasI18n = content.includes('useTranslations') || content.includes('useI18n')

    const strings: string[] = []
    const seen = new Set<string>()

    // Find hardcoded UI strings
    const patterns = [
      /label:\s*['"]([^'"]{3,80})['"]/g,
      /title:\s*['"]([^'"]{3,80})['"]/g,
      /placeholder:\s*['"]([^'"]{3,80})['"]/g,
      /tooltip:\s*['"]([^'"]{3,80})['"]/g,
      /alt:\s*['"]([^'"]{3,80})['"]/g,
    ]

    for (const regex of patterns) {
      let match
      while ((match = regex.exec(content)) !== null) {
        const str = match[1]?.trim()
        if (str && !seen.has(str) && str.length > 3) {
          seen.add(str)
          strings.push(str)
        }
      }
    }

    return {
      file: filePath,
      hasI18n,
      strings
    }
  } catch {
    return { file: filePath, hasI18n: false, strings: [] }
  }
}

async function main() {
  console.log('📝 === COMPONENT UPDATER ===\n')

  const files = await getComponentFiles()
  console.log(`📂 Found ${files.length} component files\n`)

  let needsI18n = 0
  let hasI18n = 0
  const candidates: Array<{ file: string; strings: string[] }> = []

  for (const file of files) {
    const info = await checkComponent(join(ROOT, file))

    if (info.hasI18n) {
      hasI18n++
      console.log(`✅ ${file.split('/').pop()}: Already translated`)
    } else if (info.strings.length > 0) {
      needsI18n++
      candidates.push({ file: info.file, strings: info.strings })
      console.log(`⚠️  ${file.split('/').pop()}: ${info.strings.length} strings need translation`)
    }
  }

  console.log(`\n📊 SUMMARY:`)
  console.log(`   Already translated: ${hasI18n}`)
  console.log(`   Need i18n: ${needsI18n}`)
  console.log(`   Total: ${files.length}`)

  console.log(`\n🎯 PRIORITY UPDATES NEEDED:`)
  candidates.slice(0, 10).forEach((c, i) => {
    console.log(`\n${i + 1}. ${c.file.split('/').pop()}`)
    console.log(`   Strings to translate: ${c.strings.length}`)
    c.strings.slice(0, 3).forEach(s => {
      console.log(`   - "${s.substring(0, 50)}"`)
    })
    if (c.strings.length > 3) {
      console.log(`   ... and ${c.strings.length - 3} more`)
    }
  })

  console.log(`\n✅ NEXT STEP: Manually update high-priority components`)
  console.log(`   1. Landing pages (landing.tsx, contact/page.tsx)`)
  console.log(`   2. Modal/dialog components`)
  console.log(`   3. Form components`)
}

main().catch(console.error)
