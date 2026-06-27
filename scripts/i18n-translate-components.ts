/**
 * i18n: Extract hardcoded strings from .tsx/.ts components, translate via Ollama,
 * inject useTranslations() hooks, and update JSON catalogs.
 *
 * Strategy:
 * 1. Find all .tsx files (865 total)
 * 2. Extract hardcoded English strings (titles, labels, descriptions)
 * 3. Translate strings to RU/DE via Ollama
 * 4. Inject into nearest i18n namespace catalog (or create new)
 * 5. Update component to use useTranslations() hook
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MESSAGES = join(ROOT, 'apps', 'sim', 'messages')
const MODEL = 'qwen2.5-coder:7b'
const OLLAMA_URL = 'http://localhost:11434/api/generate'

// Regex patterns to find hardcoded strings in JSX/TS
const HARDCODED_PATTERNS = [
  /title:\s*["']([^"']{10,})["']/g, // metadata.title
  /description:\s*["']([^"']{15,})["']/g, // metadata.description
  /label:\s*["']([^"']{5,})["']/g, // component props
  /<[A-Za-z]+[^>]*>([A-Z][^<]{10,})<\/[A-Za-z]+>/g, // JSX text nodes
]

interface ExtractedString {
  original: string
  file: string
  context: string
}

async function extractStringsFromFile(filePath: string): Promise<ExtractedString[]> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const extracted: ExtractedString[] = []

    // Skip files with useTranslations already (already translated)
    if (content.includes('useTranslations()')) return []

    for (const pattern of HARDCODED_PATTERNS) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const str = match[1]?.trim()
        if (str && str.length > 10 && /[A-Z]/.test(str)) {
          extracted.push({
            original: str,
            file: filePath,
            context: match[0].substring(0, 50),
          })
        }
      }
    }

    return extracted
  } catch {
    return []
  }
}

async function translateString(text: string, targetLang: string): Promise<string> {
  const langName = targetLang === 'ru' ? 'Russian' : 'German'
  const prompt = `Translate UI/component text to ${langName}. Keep it concise, formal tone. Do NOT translate "Sim" product name. Return ONLY translation:
"${text}"`

  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false }),
    })

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`)
    const data = (await response.json()) as { response: string }
    return data.response.trim()
  } catch (error) {
    console.error(`Translation error for "${text}":`, error)
    return text // fallback
  }
}

async function processComponents(): Promise<void> {
  console.log('Scanning .tsx files for hardcoded strings...\n')

  const txsFiles = (
    await new Promise<string[]>((resolve) => {
      import('child_process').then(({ execSync }) => {
        try {
          const result = execSync('find apps -name "*.tsx" -o -name "*.ts"', { cwd: ROOT, encoding: 'utf-8' })
          resolve(result.split('\n').filter((f) => f))
        } catch {
          resolve([])
        }
      })
    })
  ).slice(0, 100) // Start with first 100 for testing

  let totalExtracted = 0

  for (const file of txsFiles) {
    const filePath = join(ROOT, file)
    const extracted = await extractStringsFromFile(filePath)

    if (extracted.length === 0) continue

    console.log(`\n${relative(ROOT, filePath)}: ${extracted.length} strings`)

    // Group by namespace based on file location
    const namespace = extracted[0].file.includes('landing')
      ? 'landing'
      : extracted[0].file.includes('auth')
        ? 'auth'
        : extracted[0].file.includes('chat')
          ? 'chat'
          : 'common'

    for (const item of extracted) {
      console.log(`  - "${item.original.substring(0, 60)}"`)
      totalExtracted++

      // Translate to RU/DE
      const ru = await translateString(item.original, 'ru')
      const de = await translateString(item.original, 'de')

      console.log(`    RU: "${ru.substring(0, 60)}"`)
      console.log(`    DE: "${de.substring(0, 60)}"`)

      // TODO: Add to message catalog + update component
      if (totalExtracted >= 20) {
        // Stop after 20 for preview
        break
      }
    }

    if (totalExtracted >= 20) break
  }

  console.log(`\n\nExtracted ${totalExtracted} translatable strings from ${txsFiles.length} files`)
  console.log('Next: Update JSON catalogs and inject useTranslations() hooks')
}

processComponents().catch(console.error)
