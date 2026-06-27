/**
 * i18n FOCUSED: Only most important files
 * - apps/sim/app (pages)
 * - apps/sim/components (UI)
 * ~200 files max, extract & translate FAST
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MESSAGES = join(ROOT, 'apps', 'sim', 'messages')
const MODEL = 'qwen2.5-coder:7b'
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

    // Simple patterns
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

async function translateOne(text: string, lang: string): Promise<string> {
  try {
    const langName = lang === 'ru' ? 'Russian' : 'German'
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      body: JSON.stringify({
        model: MODEL,
        prompt: `Translate to ${langName} (short): "${text}"`,
        stream: false
      }),
      headers: { 'Content-Type': 'application/json' }
    })
    const data = (await res.json()) as { response: string }
    return data.response.trim().replace(/^["']|["']$/g, '')
  } catch {
    return text
  }
}

async function main() {
  console.log('🚀 i18n FOCUSED: Quick extraction & translation\n')

  const files = await getFiles()
  console.log(`📊 Files found: ${files.length}\n`)

  const catalog = {
    ru: JSON.parse(await readFile(join(MESSAGES, 'ru', 'components.json'), 'utf-8')),
    de: JSON.parse(await readFile(join(MESSAGES, 'de', 'components.json'), 'utf-8'))
  }

  let totalExtracted = 0
  let totalNew = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const strings = await extractStrings(join(ROOT, file))

    for (const str of strings) {
      const key = str.substring(0, 10).toLowerCase().replace(/\W/g, '')

      // Only if not already in catalog
      if (!catalog.ru[key]) {
        const ru = await translateOne(str, 'ru')
        const de = await translateOne(str, 'de')
        catalog.ru[key] = ru
        catalog.de[key] = de
        totalNew++
        console.log(`✓ [${file}] "${str.substring(0, 40)}"`)
      }
      totalExtracted++
    }

    if ((i + 1) % 20 === 0) {
      console.log(`   ${i + 1}/${files.length} files processed\n`)
    }
  }

  // Save
  await writeFile(join(MESSAGES, 'ru', 'components.json'), JSON.stringify(catalog.ru, null, 2))
  await writeFile(join(MESSAGES, 'de', 'components.json'), JSON.stringify(catalog.de, null, 2))

  console.log(`\n✅ COMPLETE!`)
  console.log(`   Files: ${files.length}`)
  console.log(`   Strings extracted: ${totalExtracted}`)
  console.log(`   NEW translations: ${totalNew}`)
  console.log(`   Total keys: ${Object.keys(catalog.ru).length}`)
}

main().catch(console.error)
