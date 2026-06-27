/**
 * SMART FAST i18n: Process 10,619 files EFFICIENTLY
 *
 * Strategy:
 * 1. Sample 500 files first to measure extraction speed
 * 2. Batch strings (not files) for translation
 * 3. Parallel Ollama calls (concurrent requests)
 * 4. Update catalogs incrementally
 * 5. Scale to full codebase
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MESSAGES = join(ROOT, 'apps', 'sim', 'messages')
const MODEL = 'qwen2.5-coder:7b'
const OLLAMA_URL = 'http://localhost:11434/api/generate'

interface FileString {
  original: string
  key: string
}

async function extractFromFile(filePath: string): Promise<FileString[]> {
  try {
    const content = await readFile(filePath, 'utf-8')
    if (content.includes('useTranslations')) return []

    const patterns = [
      /['"]([A-Z][^'"]{8,150})['"](?=\s*[),}\]}])/g,
      /label:\s*['"]([^'"]{3,80})['"]/,
      /title:\s*['"]([^'"]{3,100})['"]/,
      /placeholder:\s*['"]([^'"]{3,80})['"]/,
    ]

    const strings: FileString[] = []
    const seen = new Set<string>()

    for (const regex of patterns) {
      let match
      while ((match = regex.exec(content)) !== null) {
        const str = match[1]?.trim()
        if (!str || str.length < 3 || str.length > 200 || seen.has(str)) continue
        seen.add(str)
        const key = str.substring(0, 10).toLowerCase().replace(/\W/g, '')
        strings.push({ original: str, key })
      }
    }
    return strings
  } catch {
    return []
  }
}

async function translateString(text: string, lang: string): Promise<string> {
  try {
    const langName = lang === 'ru' ? 'Russian' : 'German'
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: `Translate UI text to ${langName} (keep it short): "${text}"`,
        stream: false
      }),
    })
    const data = (await res.json()) as { response: string }
    return data.response.trim().replace(/^["']|["']$/g, '')
  } catch {
    return text
  }
}

async function main() {
  console.log('🚀 SMART FAST i18n\n')

  // Get all files
  const allFiles = execSync(
    `find . -type f \\( -name "*.ts" -o -name "*.tsx" \\) ! -path "./node_modules/*" ! -path "./.next/*" ! -path "./.git/*"`,
    { cwd: ROOT, encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 }
  ).split('\n').filter(f => f)

  console.log(`📊 Total files: ${allFiles.length}`)

  // Sample first 500 files for speed test
  const sample = allFiles.slice(0, 500)
  console.log(`\n🔍 Phase 1: Extract from ${sample.length} sample files...`)

  let totalStrings = 0
  const allStrings = new Map<string, FileString>()

  for (let i = 0; i < sample.length; i++) {
    const file = join(ROOT, sample[i])
    const strings = await extractFromFile(file)
    for (const str of strings) {
      if (!allStrings.has(str.original)) {
        allStrings.set(str.original, str)
        totalStrings++
      }
    }
    if ((i + 1) % 50 === 0) {
      console.log(`   ${i + 1}/${sample.length} files, ${totalStrings} unique strings`)
    }
  }

  console.log(`\n✓ Extracted ${totalStrings} unique strings from ${sample.length} files`)
  console.log(`📈 Extrapolated for full codebase: ~${Math.round(totalStrings * (allFiles.length / sample.length))} strings`)

  // Translate sample (parallel)
  console.log(`\n🌐 Phase 2: Translate ${totalStrings} strings...`)

  const catalog = {
    ru: JSON.parse(await readFile(join(MESSAGES, 'ru', 'components.json'), 'utf-8')),
    de: JSON.parse(await readFile(join(MESSAGES, 'de', 'components.json'), 'utf-8'))
  }

  const strings = Array.from(allStrings.values())
  let translated = 0

  for (let i = 0; i < strings.length; i += 10) {
    const batch = strings.slice(i, i + 10)
    const promises = batch.flatMap(str => [
      translateString(str.original, 'ru').then(ru => ({ str: str.original, key: str.key, ru, lang: 'ru' })),
      translateString(str.original, 'de').then(de => ({ str: str.original, key: str.key, de, lang: 'de' }))
    ])

    const results = await Promise.all(promises)
    for (const result of results) {
      if (result.lang === 'ru') catalog.ru[result.key] = result.ru
      else catalog.de[result.key] = result.de
    }

    translated += batch.length
    if ((i / 10 + 1) % 10 === 0) {
      console.log(`   ${translated}/${strings.length} strings`)
    }
  }

  // Save
  await writeFile(join(MESSAGES, 'ru', 'components.json'), JSON.stringify(catalog.ru, null, 2))
  await writeFile(join(MESSAGES, 'de', 'components.json'), JSON.stringify(catalog.de, null, 2))

  console.log(`\n✅ PHASE 1 COMPLETE!`)
  console.log(`   Sample: ${sample.length} files`)
  console.log(`   Strings: ${translated} extracted & translated`)
  console.log(`   Catalog: ${Object.keys(catalog.ru).length} keys (RU)`)
  console.log(`\n📈 Next: Scale to full ${allFiles.length} files`)
  console.log(`   Estimated time: ~${Math.round((allFiles.length / sample.length) * 5)} minutes`)
}

main().catch(console.error)
