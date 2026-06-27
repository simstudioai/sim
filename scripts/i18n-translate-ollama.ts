/**
 * i18n translator using local Ollama (qwen2.5-coder:7b)
 * Translates apps/sim/messages/en/*.json → ru/de/* via http://localhost:11434
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// From /Users/aac/aacsim/sim/scripts/i18n-translate-ollama.ts → ROOT is /Users/aac/aacsim/sim
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MESSAGES = join(ROOT, 'apps', 'sim', 'messages')
const MODEL = 'qwen2.5-coder:7b'
const OLLAMA_URL = 'http://localhost:11434/api/generate'

const STYLE_GUIDE = `STYLE GUIDE for UI translations:
- Tone: concise, neutral-formal
- Case: sentence case
- Keep trailing punctuation
- Russian: use "вы" (formal you)
- German: use "Sie" (formal you)
- NEVER translate product name "Sim"
- EXACT terms (consistency across all files):
  * Workflow → RU "воркфлоу", DE "Workflow"
  * Workspace → RU "рабочее пространство", DE "Arbeitsbereich"
  * Knowledge base → RU "база знаний", DE "Wissensdatenbank"
  * Agent → RU "агент", DE "Agent"
  * Integration → RU "интеграция", DE "Integration"
  * Settings → RU "настройки", DE "Einstellungen"
  * Billing → RU "оплата", DE "Abrechnung"
  * Credits → RU "кредиты", DE "Credits"
  * Usage limit → RU "лимит использования", DE "Nutzungslimit"`

type TranslatableValue = string | { [key: string]: TranslatableValue } | TranslatableValue[]

function* extractStrings(obj: TranslatableValue, path: string[] = []): Generator<{ path: string; value: string }> {
  if (typeof obj === 'string') {
    yield { path: path.join('.'), value: obj }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      yield* extractStrings(obj[i], [...path, String(i)])
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      yield* extractStrings(value, [...path, key])
    }
  }
}

function setNestedValue(obj: any, path: string[], value: string): void {
  let current = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (!(key in current)) current[key] = {}
    current = current[key]
  }
  current[path[path.length - 1]] = value
}

async function translateText(text: string, targetLang: string): Promise<string> {
  const langName = targetLang === 'ru' ? 'Russian' : 'German'
  const prompt = `${STYLE_GUIDE}

Translate this UI text to ${langName}. Return ONLY the translation, no explanation:
"${text}"`

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
  })

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`)
  }

  const data = (await response.json()) as { response: string }
  return data.response.trim()
}

async function translateNamespace(nsName: string, targetLang: string): Promise<void> {
  const enPath = join(MESSAGES, 'en', `${nsName}.json`)
  const targetPath = join(MESSAGES, targetLang, `${nsName}.json`)

  const enContent = await readFile(enPath, 'utf-8')
  const enObj = JSON.parse(enContent)
  const targetObj: any = {}

  const strings = Array.from(extractStrings(enObj))
  console.log(`  ${nsName}: ${strings.length} strings...`)

  for (const { path, value } of strings) {
    const translated = await translateText(value, targetLang)
    setNestedValue(targetObj, path.split('.'), translated)
  }

  await writeFile(targetPath, JSON.stringify(targetObj, null, 2))
  console.log(`  ✓ ${nsName} → ${targetLang}`)
}

async function main() {
  const args = process.argv.slice(2)
  const onlyNs = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
  const langArg = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null

  const targetLangs = (langArg ? langArg.split(',') : ['ru', 'de']).filter((l) => ['ru', 'de'].includes(l))

  // Get list of namespaces
  const files = await readdir(join(MESSAGES, 'en'))
  const namespaces = files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
  const toTranslate = onlyNs ? namespaces.filter((ns) => ns === onlyNs) : namespaces

  console.log(`Translating ${toTranslate.length} namespace(s) to ${targetLangs.join(', ')}...`)

  for (const lang of targetLangs) {
    console.log(`\n→ ${lang.toUpperCase()}:`)
    for (const ns of toTranslate) {
      await translateNamespace(ns, lang)
    }
  }

  console.log('\n✓ Translation complete!')
}

main().catch(console.error)
