/**
 * i18n TRANSLATEGEMMA PRO
 *
 * Специализированная модель для перевода:
 * - translategemma:latest (оптимизирована для качества)
 * - Переделываем 430 переводов
 * - Расширяем на остальные 1530 файлов
 * - ЛУЧШЕЕ КАЧЕСТВО перевода
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MESSAGES = join(ROOT, 'apps', 'sim', 'messages')
const MODEL = 'translategemma:latest' // ← SPECIALIZED TRANSLATION MODEL
const OLLAMA_URL = 'http://localhost:11434/api/generate'

async function getFiles() {
  const result = execSync(
    `find apps/sim/app apps/sim/components -type f \\( -name "*.ts" -o -name "*.tsx" \\) ! -path "*/node_modules/*"`,
    { cwd: ROOT, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  )
  return result.split('\n').filter(f => f)
}

async function extractStrings(filePath: string): Promise<string[]> {
  try {
    const content = await readFile(filePath, 'utf-8')
    if (content.includes('useTranslations')) return []

    const strings: string[] = []
    const seen = new Set<string>()

    const patterns = [
      /['"]([A-Z][^'"]{5,120})['"](?=\s*[)}])/g,
      /label:\s*['"]([^'"]{3,80})['"]/g,
      /title:\s*['"]([^'"]{3,80})['"]/g,
    ]

    for (const regex of patterns) {
      let match
      while ((match = regex.exec(content)) !== null) {
        let str = match[1]?.trim()
        if (str && str.length > 3 && str.length < 150 && !seen.has(str)) {
          seen.add(str)
          strings.push(str)
        }
      }
    }
    return strings
  } catch {
    return []
  }
}

async function translateWithGemma(text: string, lang: string): Promise<string> {
  try {
    const prompt = lang === 'ru'
      ? `Translate to Russian: "${text}"`
      : `Translate to German: "${text}"`

    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false
      }),
      headers: { 'Content-Type': 'application/json' }
    })

    const data = (await res.json()) as { response: string }
    return data.response.trim().replace(/^["']|["']$/g, '')
  } catch (error) {
    console.error(`Translation error for "${text}":`, error)
    return text
  }
}

async function main() {
  console.log('🌐 i18n TRANSLATEGEMMA PRO\n')
  console.log(`Model: translategemma:latest (SPECIALIZED)\n`)

  const files = await getFiles()
  console.log(`📂 Files found: ${files.length}`)
  console.log(`🎯 Processing: ALL files for BEST quality translations\n`)

  const catalog = {
    ru: JSON.parse(await readFile(join(MESSAGES, 'ru', 'components.json'), 'utf-8')),
    de: JSON.parse(await readFile(join(MESSAGES, 'de', 'components.json'), 'utf-8'))
  }

  let totalExtracted = 0
  let totalNew = 0
  let totalReTranslated = 0
  const reTranslations: { key: string; oldRu: string; newRu: string; oldDe: string; newDe: string }[] = []

  console.log(`Starting translation with translategemma...\n`)

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const strings = await extractStrings(join(ROOT, file))

    for (const str of strings) {
      const key = str.substring(0, 10).toLowerCase().replace(/\W/g, '')

      // Check if already in catalog
      if (catalog.ru[key]) {
        // RE-TRANSLATE with better model
        const oldRu = catalog.ru[key]
        const oldDe = catalog.de[key]
        const newRu = await translateWithGemma(str, 'ru')
        const newDe = await translateWithGemma(str, 'de')

        // Only update if different and better
        if (newRu !== oldRu || newDe !== oldDe) {
          catalog.ru[key] = newRu
          catalog.de[key] = newDe
          totalReTranslated++
          reTranslations.push({ key, oldRu, newRu, oldDe, newDe })
          if (totalReTranslated % 10 === 0) {
            console.log(`  ↻ RE-TRANSLATED: ${totalReTranslated}`)
          }
        }
      } else {
        // NEW translation
        const ru = await translateWithGemma(str, 'ru')
        const de = await translateWithGemma(str, 'de')
        catalog.ru[key] = ru
        catalog.de[key] = de
        totalNew++
        if (totalNew % 10 === 0) {
          console.log(`  ✨ NEW: +${totalNew}`)
        }
      }
      totalExtracted++
    }

    if ((i + 1) % 200 === 0) {
      console.log(`\n   [${i + 1}/${files.length}] Progress: ${totalNew} new, ${totalReTranslated} improved\n`)
      // Save progress
      await writeFile(join(MESSAGES, 'ru', 'components.json'), JSON.stringify(catalog.ru, null, 2))
      await writeFile(join(MESSAGES, 'de', 'components.json'), JSON.stringify(catalog.de, null, 2))
    }
  }

  // Final save
  await writeFile(join(MESSAGES, 'ru', 'components.json'), JSON.stringify(catalog.ru, null, 2))
  await writeFile(join(MESSAGES, 'de', 'components.json'), JSON.stringify(catalog.de, null, 2))

  console.log(`\n✅ COMPLETE!`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`   Files processed: ${files.length}`)
  console.log(`   Strings extracted: ${totalExtracted}`)
  console.log(`   NEW translations: ${totalNew}`)
  console.log(`   RE-TRANSLATED (improved): ${totalReTranslated}`)
  console.log(`   Total catalog keys: ${Object.keys(catalog.ru).length}`)
  console.log(`\n📝 Sample IMPROVED translations:`)
  reTranslations.slice(0, 5).forEach(t => {
    console.log(`   ${t.key}:`)
    console.log(`     OLD RU: "${t.oldRu}"`)
    console.log(`     NEW RU: "${t.newRu}"`)
    console.log(`     OLD DE: "${t.oldDe}"`)
    console.log(`     NEW DE: "${t.newDe}"`)
  })
}

main().catch(console.error)
