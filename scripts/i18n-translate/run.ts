/**
 * i18n catalog translator.
 *
 * Reads apps/sim/messages/en/<ns>.json and writes apps/sim/messages/{ru,de}/<ns>.json,
 * translating every string leaf while preserving key structure and {placeholder} tokens.
 *
 * Default backend is local Ollama. Apple Foundation Models and OpenAI remain available
 * explicitly through --backend apple/openai.
 *
 * Run (from repo root):
 *   bun run scripts/i18n-translate/run.ts                 # all langs, all namespaces via Ollama
 *   bun run scripts/i18n-translate/run.ts --only nav      # one namespace (fast test)
 *   bun run scripts/i18n-translate/run.ts --lang ru       # one language
 *   bun run scripts/i18n-translate/run.ts --backend apple # Apple Foundation Models
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MESSAGES = join(ROOT, 'apps', 'sim', 'messages')
const SWIFT = join(ROOT, 'scripts', 'i18n-translate', 'translate.swift')

const LANG_NAMES: Record<string, string> = { ru: 'Russian', de: 'German' }

/**
 * Shared style guide + glossary injected into EVERY translation request so all
 * files come out in one consistent voice/terminology (the LLM can't drift).
 */
const STYLE_GUIDE = `STYLE: concise, neutral-formal UI tone; sentence case; keep trailing punctuation; address the user formally (RU "вы" lowercase, DE "Sie"). Never translate the product name "Sim". Keep these EXACT terms consistent:
- Workflow -> RU "воркфлоу", DE "Workflow"
- Workspace -> RU "рабочее пространство", DE "Arbeitsbereich"
- Knowledge base -> RU "база знаний", DE "Wissensdatenbank"
- Agent -> RU "агент", DE "Agent"
- Integration -> RU "интеграция", DE "Integration"
- Settings -> RU "настройки", DE "Einstellungen"
- Billing -> RU "оплата", DE "Abrechnung"
- Credits -> RU "кредиты", DE "Credits"
- Usage limit -> RU "лимит использования", DE "Nutzungslimit".`

const args = process.argv.slice(2)
const onlyNs = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const langArg = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null
const backend = args.includes('--backend')
  ? args[args.indexOf('--backend') + 1]
  : process.env.I18N_TRANSLATE_BACKEND || 'ollama'
const targetLangs = (langArg ? langArg.split(',') : ['ru', 'de']).filter((l) => LANG_NAMES[l])
/**
 * Incremental by default: keep any existing target translation that already
 * differs from its English source, and only translate keys that are missing or
 * still equal to the English value. `--overwrite` forces a full re-translation.
 */
const overwrite = args.includes('--overwrite')

/** OpenAI fallback backend — reads OPENAI_API_KEY from apps/sim/.env. */
async function loadOpenAiKey(): Promise<string> {
  const env = await readFile(join(ROOT, 'apps', 'sim', '.env'), 'utf-8')
  const m = env.match(/^OPENAI_API_KEY=(.+)$/m)
  if (!m) throw new Error('OPENAI_API_KEY not found in apps/sim/.env')
  return m[1].trim()
}

let OPENAI_KEY = ''
const OPENAI_MODEL = 'gpt-4o-mini'
const OPENAI_CHUNK = 40

async function translateBatchOpenAi(values: string[], langName: string): Promise<string[]> {
  if (!OPENAI_KEY) OPENAI_KEY = await loadOpenAiKey()
  const out: string[] = []
  for (let i = 0; i < values.length; i += OPENAI_CHUNK) {
    const chunk = values.slice(i, i + OPENAI_CHUNK)
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a professional UI localization engine for a software product named "Sim" (an AI workspace). Translate every string in the input JSON array "s" from English to ${langName}. Return ONLY a JSON object {"t": [...]} whose array has EXACTLY the same length and order. Preserve untranslated: placeholders like {name}, {count}, {{x}}, %s, $1; HTML tags; markdown; URLs; and the product name "Sim". Keep capitalization style and trailing punctuation.\n${STYLE_GUIDE}`,
          },
          { role: 'user', content: JSON.stringify({ s: chunk }) },
        ],
      }),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json()
    const parsed = JSON.parse(json.choices[0].message.content)
    const t = parsed.t
    if (!Array.isArray(t) || t.length !== chunk.length) {
      throw new Error(
        `OpenAI chunk mismatch: sent ${chunk.length}, got ${Array.isArray(t) ? t.length : 'non-array'}`
      )
    }
    out.push(...t.map((x) => String(x)))
  }
  return out
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

/** Collect every string leaf in order; returns the strings, their key-paths + a rebuild fn. */
function collectStrings(obj: Json): {
  values: string[]
  paths: string[]
  rebuild: (translated: string[]) => Json
} {
  const values: string[] = []
  const paths: string[] = []
  function walk(node: Json, path: string): Json {
    if (typeof node === 'string') {
      const idx = values.length
      values.push(node)
      paths.push(path)
      return { __i18n_idx__: idx } as unknown as Json
    }
    if (Array.isArray(node)) return node.map((n, i) => walk(n, `${path}\x00${i}`))
    if (node && typeof node === 'object') {
      const out: { [k: string]: Json } = {}
      for (const [k, v] of Object.entries(node)) out[k] = walk(v as Json, `${path}\x00${k}`)
      return out
    }
    return node
  }
  const skeleton = walk(obj, '')
  function fill(node: Json, translated: string[]): Json {
    if (node && typeof node === 'object' && !Array.isArray(node) && '__i18n_idx__' in node) {
      return translated[(node as any).__i18n_idx__]
    }
    if (Array.isArray(node)) return node.map((n) => fill(n, translated))
    if (node && typeof node === 'object') {
      const out: { [k: string]: Json } = {}
      for (const [k, v] of Object.entries(node)) out[k] = fill(v as Json, translated)
      return out
    }
    return node
  }
  return { values, paths, rebuild: (t) => fill(skeleton, t) }
}

/** Flatten an existing target catalog into a path→string map (same path scheme as collectStrings). */
function flattenCatalog(obj: Json, path: string, out: Map<string, string>): void {
  if (typeof obj === 'string') {
    out.set(path, obj)
    return
  }
  if (Array.isArray(obj)) {
    obj.forEach((n, i) => flattenCatalog(n, `${path}\x00${i}`, out))
    return
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) flattenCatalog(v as Json, `${path}\x00${k}`, out)
  }
}

/** Pipe every string through the on-device Swift translator (1 line in / 1 line out). */
async function translateBatch(values: string[], langName: string): Promise<string[]> {
  const proc = Bun.spawn(['swift', SWIFT, langName], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const input = values.map((v) => v.replace(/\r?\n/g, '\\n')).join('\n') + '\n'
  proc.stdin.write(input)
  proc.stdin.end()
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code === 2) throw new Error('Apple Intelligence unavailable — enable it in System Settings.')
  if (code !== 0) throw new Error(`translator exited with code ${code}`)
  const lines = out.split('\n')
  // Drop a trailing empty line from the final newline.
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (lines.length !== values.length) {
    throw new Error(`line count mismatch: sent ${values.length}, got ${lines.length}`)
  }
  return lines.map((l) => l.replace(/\\n/g, '\n'))
}

const OLLAMA_HOST = process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b'
const OLLAMA_CHUNK = Number(process.env.I18N_OLLAMA_CHUNK || 12)
const OLLAMA_TIMEOUT_MS = Number(process.env.I18N_OLLAMA_TIMEOUT_MS || 60_000)
const OLLAMA_SINGLE_TIMEOUT_MS = Number(process.env.I18N_OLLAMA_SINGLE_TIMEOUT_MS || 90_000)

async function assertOllamaModel(): Promise<void> {
  const res = await fetch(`${OLLAMA_HOST.replace(/\/$/, '')}/api/tags`)
  if (!res.ok) throw new Error(`Ollama probe failed: ${res.status} ${res.statusText}`)
  const json = (await res.json()) as { models?: Array<{ name?: string }> }
  const models = json.models?.map((model) => model.name).filter(Boolean) ?? []
  if (!models.includes(OLLAMA_MODEL)) {
    throw new Error(
      `Ollama model "${OLLAMA_MODEL}" is not installed. Available models: ${models.join(', ') || 'none'}`
    )
  }
}

/** One Ollama call for a chunk; returns the translated array or null on mismatch/parse error. */
async function ollamaCall(chunk: string[], langName: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [
          {
            role: 'system',
            content: `You are a professional UI localization engine for a software product named "Sim" (an AI workspace). Translate every string in the input JSON array "s" from English to ${langName}. Return ONLY a JSON object {"t": [...]} whose array has EXACTLY the same length and order as "s" (${chunk.length} items). Preserve untranslated: placeholders like {name}, {count}, {{x}}, %s, $1; HTML tags; markdown; URLs; and the product name "Sim". Keep capitalization style and trailing punctuation.\n${STYLE_GUIDE}`,
          },
          { role: 'user', content: JSON.stringify({ s: chunk }) },
        ],
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    const parsed = JSON.parse(json.message.content)
    const t = parsed.t
    if (!Array.isArray(t) || t.length !== chunk.length) return null
    return t.map((x) => String(x))
  } catch {
    return null
  }
}

async function ollamaTranslateSingle(value: string, langName: string): Promise<string> {
  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(OLLAMA_SINGLE_TIMEOUT_MS),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      options: { temperature: 0 },
      prompt: `Translate this UI string from English to ${langName}. Return only the translated string. Preserve placeholders, HTML tags, markdown, URLs, and the product name "Sim".\n\n${value}`,
    }),
  })
  if (!res.ok) throw new Error(`Ollama single-string fallback failed: ${res.status}`)
  const json = (await res.json()) as { response?: string }
  const translated = json.response?.trim()
  if (!translated) throw new Error('Ollama single-string fallback returned an empty response')
  return translated.replace(/^["']|["']$/g, '')
}

/** Divide-and-conquer: guarantees 1:1 output by splitting on mismatch. */
async function ollamaResolve(chunk: string[], langName: string): Promise<string[]> {
  const direct = await ollamaCall(chunk, langName)
  if (direct) return direct
  if (chunk.length === 1) {
    const retry = await ollamaCall(chunk, langName)
    if (retry) return retry
    console.log(`[i18n] retry: single-string fallback for ${langName}`)
    return [await ollamaTranslateSingle(chunk[0], langName)]
  }
  console.log(`[i18n] retry: splitting ${chunk.length} strings for ${langName}`)
  const mid = Math.floor(chunk.length / 2)
  const left = await ollamaResolve(chunk.slice(0, mid), langName)
  const right = await ollamaResolve(chunk.slice(mid), langName)
  return [...left, ...right]
}

async function translateBatchOllama(values: string[], langName: string): Promise<string[]> {
  await assertOllamaModel()
  const out: string[] = []
  for (let i = 0; i < values.length; i += OLLAMA_CHUNK) {
    const chunk = values.slice(i, i + OLLAMA_CHUNK)
    console.log(
      `[i18n] ${langName}: chunk ${Math.floor(i / OLLAMA_CHUNK) + 1}/${Math.ceil(
        values.length / OLLAMA_CHUNK
      )} (${chunk.length} strings)`
    )
    out.push(...(await ollamaResolve(chunk, langName)))
  }
  return out
}

async function main() {
  const enDir = join(MESSAGES, 'en')
  // Discover top-level namespace files plus one level of subdirectories (e.g.
  // blocks/*.json), skipping `_*` metadata files like blocks/_index.json.
  const entries = await readdir(enDir, { withFileTypes: true })
  let files: string[] = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(entry.name)
    else if (entry.isDirectory()) {
      const sub = (await readdir(join(enDir, entry.name))).filter(
        (f) => f.endsWith('.json') && !f.startsWith('_')
      )
      for (const f of sub) files.push(`${entry.name}/${f}`)
    }
  }
  if (onlyNs) {
    // `--only blocks` matches the whole blocks/ subtree; `--only nav` matches nav.json.
    files = files.filter((f) => f === `${onlyNs}.json` || f.startsWith(`${onlyNs}/`))
  }
  if (!files.length) throw new Error(`no namespace files found${onlyNs ? ` for "${onlyNs}"` : ''}`)

  console.log(`[i18n] langs=${targetLangs.join(',')} namespaces=${files.length}`)

  for (const lang of targetLangs) {
    const langName = LANG_NAMES[lang]
    for (const file of files) {
      const en = JSON.parse(await readFile(join(enDir, file), 'utf-8')) as Json
      const { values, paths, rebuild } = collectStrings(en)

      // Incremental merge: keep any existing translation that already differs
      // from English; only (re)translate missing keys or untranslated copies.
      const targetFile = join(MESSAGES, lang, file)
      const existing = new Map<string, string>()
      if (!overwrite && existsSync(targetFile)) {
        try {
          flattenCatalog(JSON.parse(await readFile(targetFile, 'utf-8')) as Json, '', existing)
        } catch {
          // malformed target → translate everything fresh
        }
      }

      const resolved = Array.from<string>({ length: values.length })
      const todoIdx: number[] = []
      const todoValues: string[] = []
      for (let i = 0; i < values.length; i++) {
        const prev = existing.get(paths[i])
        if (prev !== undefined && prev !== '' && prev !== values[i]) {
          resolved[i] = prev // genuine prior translation — preserve it
        } else if (!/\p{L}/u.test(values[i])) {
          // no translatable letters (prices, symbols, empty, "$20", "@mention") — copy as-is
          resolved[i] = values[i]
        } else {
          todoIdx.push(i)
          todoValues.push(values[i])
        }
      }

      console.log(
        `[i18n] ${lang}/${file}: ${todoValues.length} to translate / ${values.length} total` +
          `${overwrite ? ' (overwrite)' : ` (${values.length - todoValues.length} kept)`} (${backend})…`
      )
      const t0 = performance.now()
      if (todoValues.length > 0) {
        const translated =
          backend === 'openai'
            ? await translateBatchOpenAi(todoValues, langName)
            : backend === 'ollama'
              ? await translateBatchOllama(todoValues, langName)
              : await translateBatch(todoValues, langName)
        todoIdx.forEach((origIdx, j) => {
          resolved[origIdx] = translated[j]
        })
      }
      const built = rebuild(resolved)
      await mkdir(dirname(targetFile), { recursive: true })
      await writeFile(targetFile, `${JSON.stringify(built, null, 2)}\n`, 'utf-8')
      console.log(
        `[i18n] ${lang}/${file}: done in ${((performance.now() - t0) / 1000).toFixed(1)}s`
      )
    }
  }
  console.log('[i18n] all done.')
}

main().catch((e) => {
  console.error('[i18n] FAILED:', e.message)
  process.exit(1)
})
