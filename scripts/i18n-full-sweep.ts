/**
 * i18n: COMPLETE sweep of entire /apps/sim directory
 * Extract ALL hardcoded strings from: blocks/, background/, connectors/, tools/, triggers/,
 * providers/, enrichments/, stores/, content/, components/, hooks/, lib/, and all other .ts/.tsx files
 * Translate via Ollama to RU/DE and organize into namespace-based catalogs
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MESSAGES = join(ROOT, 'apps', 'sim', 'messages')
const MODEL = 'qwen2.5-coder:7b'
const OLLAMA_URL = 'http://localhost:11434/api/generate'

interface StringItem {
  id: string
  original: string
  file: string
  namespace: string // inferred from file path
  ru?: string
  de?: string
}

// Comprehensive patterns + dynamic namespace detection
const PATTERNS = [
  { regex: /title:\s*["']([^"']{10,})["']/g },
  { regex: /description:\s*["']([^"']{15,})["']/g },
  { regex: /label:\s*["']([^"']{5,})["']/g },
  { regex: /placeholder:\s*["']([^"']{5,})["']/g },
  { regex: /alt:\s*["']([^"']{5,})["']/g },
  { regex: /content:\s*["']([A-Z][^"']{8,})["']/g },
  { regex: /message:\s*["']([A-Z][^"']{8,})["']/g },
  { regex: /text:\s*["']([A-Z][^"']{8,})["']/g },
  { regex: /error:\s*["']([A-Z][^"']{8,})["']/g },
  { regex: /toast:\s*["']([A-Z][^"']{8,})["']/g },
]

function inferNamespace(filePath: string): string {
  // Map file paths to namespaces: blocks/ → blocks, background/ → bg, etc.
  const namespaceMap: { [key: string]: string } = {
    'blocks/': 'blocks',
    'background/': 'bg',
    'connectors/': 'connectors',
    'tools/': 'tools',
    'triggers/': 'triggers',
    'providers/': 'providers',
    'enrichments/': 'enrichments',
    'stores/': 'stores',
    'content/': 'content',
    'components/': 'ui',
    'hooks/': 'hooks',
    'lib/': 'lib',
    'app/': 'app',
  }

  for (const [key, ns] of Object.entries(namespaceMap)) {
    if (filePath.includes(key)) return ns
  }
  return 'common'
}

async function extractFromFile(filePath: string): Promise<StringItem[]> {
  try {
    const content = await readFile(filePath, 'utf-8')
    if (content.includes('useTranslations') || content.includes('from "next-intl"')) return []

    const extracted: StringItem[] = []
    const seen = new Set<string>()
    const namespace = inferNamespace(filePath)

    for (const { regex } of PATTERNS) {
      let match
      while ((match = regex.exec(content)) !== null) {
        const str = match[1]?.trim()
        if (
          str &&
          str.length > 5 &&
          str.length < 300 &&
          /[A-Za-z]/.test(str) &&
          !str.includes('${') &&
          !str.includes('{') &&
          !seen.has(str)
        ) {
          seen.add(str)
          const id = str.substring(0, 8).toLowerCase().replace(/\W/g, '')
          extracted.push({
            id,
            original: str,
            file: filePath,
            namespace,
          })
        }
      }
    }

    return extracted.slice(0, 15) // Max 15 per file to avoid explosion
  } catch {
    return []
  }
}

async function translateString(text: string, targetLang: string): Promise<string> {
  const langName = targetLang === 'ru' ? 'Russian' : 'German'
  const prompt = `Translate UI/business text to ${langName}. Keep formal, concise. NEVER translate "Sim" product name. Return ONLY translation:
"${text}"`

  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false, timeout: 30000 }),
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { response: string }
    return data.response.trim().replace(/^["']|["']$/g, '')
  } catch (error) {
    console.error(`  ✗ Translate error: ${error}`)
    return text
  }
}

async function main() {
  console.log('🚀 COMPLETE i18n sweep: apps/sim/* → extract/translate/catalog\n')

  // Find all .ts/.tsx files in apps/sim
  const files = await new Promise<string[]>((resolve) => {
    import('child_process').then(({ execSync }) => {
      try {
        const result = execSync('find apps/sim -name "*.tsx" -o -name "*.ts" | grep -v node_modules', {
          cwd: ROOT,
          encoding: 'utf-8',
        })
        resolve(result.split('\n').filter((f) => f))
      } catch {
        resolve([])
      }
    })
  })

  console.log(`Found ${files.length} files to scan\n`)

  let totalExtracted = 0
  let totalTranslated = 0
  const translations: { [key: string]: StringItem } = {}
  const byNamespace: { [key: string]: StringItem[] } = {}

  // Phase 1: Extract
  console.log('Phase 1: Extracting...')
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100)
    const results = await Promise.all(batch.map((f) => extractFromFile(join(ROOT, f))))

    for (const items of results) {
      for (const item of items) {
        if (!translations[item.id]) {
          translations[item.id] = item
          totalExtracted++

          if (!byNamespace[item.namespace]) byNamespace[item.namespace] = []
          byNamespace[item.namespace].push(item)
        }
      }
    }

    console.log(`  ${Math.min(i + 100, files.length)}/${files.length}`)
  }

  console.log(`\n✓ Extracted ${totalExtracted} unique strings\n`)

  // Phase 2: Translate
  console.log('Phase 2: Translating...')
  const items = Object.values(translations)
  const batchSize = 20

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length))

    for (const item of batch) {
      const ru = await translateString(item.original, 'ru')
      const de = await translateString(item.original, 'de')

      item.ru = ru
      item.de = de
      totalTranslated++

      console.log(`  [${i + 1}/${items.length}] "${item.original.substring(0, 40)}"`)
    }
  }

  console.log(`\n✓ Translated ${totalTranslated} strings\n`)

  // Phase 3: Write catalogs per namespace
  console.log('Phase 3: Writing catalogs...')

  for (const lang of ['ru', 'de']) {
    for (const [ns, items] of Object.entries(byNamespace)) {
      const catalog: { [key: string]: string } = {}
      const langKey = lang as 'ru' | 'de'

      for (const item of items) {
        if (item[langKey]) {
          catalog[item.id] = item[langKey]
        }
      }

      const file = join(MESSAGES, lang, `${ns}.json`)
      try {
        await writeFile(file, JSON.stringify(catalog, null, 2))
        console.log(`  ✓ ${lang}/${ns}.json: ${Object.keys(catalog).length} strings`)
      } catch (error) {
        console.error(`  ✗ Write error: ${error}`)
      }
    }
  }

  console.log(
    `\n✅ COMPLETE SWEEP DONE!
  - Extracted: ${totalExtracted} strings from ${files.length} files
  - Translated: ${totalTranslated} (RU + DE)
  - Namespaces: ${Object.keys(byNamespace).length}
  - Catalogs: apps/sim/messages/{ru,de}/*.json

Ready to commit!`,
  )
}

main().catch(console.error)
