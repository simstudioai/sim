/**
 * i18n catalog translator driven by Apple Foundation Models (on-device).
 *
 * Reads apps/sim/messages/en/<ns>.json and writes apps/sim/messages/{ru,de}/<ns>.json,
 * translating every string leaf via scripts/i18n-translate/translate.swift while
 * preserving key structure and {placeholder} tokens.
 *
 * Prereq: Apple Intelligence enabled (System Settings → Apple Intelligence & Siri).
 *
 * Run (from repo root):
 *   bun run scripts/i18n-translate/run.ts                 # all langs, all namespaces
 *   bun run scripts/i18n-translate/run.ts --only nav      # one namespace (fast test)
 *   bun run scripts/i18n-translate/run.ts --lang ru       # one language
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MESSAGES = join(ROOT, 'apps', 'sim', 'messages')
const SWIFT = join(ROOT, 'scripts', 'i18n-translate', 'translate.swift')

const LANG_NAMES: Record<string, string> = { ru: 'Russian', de: 'German' }

const args = process.argv.slice(2)
const onlyNs = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const langArg = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null
const backend = args.includes('--backend') ? args[args.indexOf('--backend') + 1] : 'apple'
const targetLangs = (langArg ? langArg.split(',') : ['ru', 'de']).filter((l) => LANG_NAMES[l])

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
            content: `You are a professional UI localization engine for a software product named "Sim" (an AI workspace). Translate every string in the input JSON array "s" from English to ${langName}. Return ONLY a JSON object {"t": [...]} whose array has EXACTLY the same length and order. Preserve untranslated: placeholders like {name}, {count}, {{x}}, %s, $1; HTML tags; markdown; URLs; and the product name "Sim". Keep capitalization style and trailing punctuation.`,
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
      throw new Error(`OpenAI chunk mismatch: sent ${chunk.length}, got ${Array.isArray(t) ? t.length : 'non-array'}`)
    }
    out.push(...t.map((x) => String(x)))
  }
  return out
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

/** Collect every string leaf in order; returns the strings + a rebuild fn. */
function collectStrings(obj: Json): { values: string[]; rebuild: (translated: string[]) => Json } {
  const values: string[] = []
  function walk(node: Json): Json {
    if (typeof node === 'string') {
      const idx = values.length
      values.push(node)
      return { __i18n_idx__: idx } as unknown as Json
    }
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      const out: { [k: string]: Json } = {}
      for (const [k, v] of Object.entries(node)) out[k] = walk(v as Json)
      return out
    }
    return node
  }
  const skeleton = walk(obj)
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
  return { values, rebuild: (t) => fill(skeleton, t) }
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
const OLLAMA_CHUNK = 20

async function translateBatchOllama(values: string[], langName: string): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < values.length; i += OLLAMA_CHUNK) {
    const chunk = values.slice(i, i + OLLAMA_CHUNK)
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [
          {
            role: 'system',
            content: `You are a professional UI localization engine for a software product named "Sim" (an AI workspace). Translate every string in the input JSON array "s" from English to ${langName}. Return ONLY a JSON object {"t": [...]} whose array has EXACTLY the same length and order as "s". Preserve untranslated: placeholders like {name}, {count}, {{x}}, %s, $1; HTML tags; markdown; URLs; and the product name "Sim". Keep capitalization style and trailing punctuation.`,
          },
          { role: 'user', content: JSON.stringify({ s: chunk }) },
        ],
      }),
    })
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json()
    const parsed = JSON.parse(json.message.content)
    const t = parsed.t
    if (!Array.isArray(t) || t.length !== chunk.length) {
      throw new Error(
        `Ollama chunk mismatch: sent ${chunk.length}, got ${Array.isArray(t) ? t.length : 'non-array'}`
      )
    }
    out.push(...t.map((x) => String(x)))
  }
  return out
}

async function main() {
  const enDir = join(MESSAGES, 'en')
  let files = (await readdir(enDir)).filter((f) => f.endsWith('.json'))
  if (onlyNs) files = files.filter((f) => f === `${onlyNs}.json`)
  if (!files.length) throw new Error(`no namespace files found${onlyNs ? ` for "${onlyNs}"` : ''}`)

  console.log(`[i18n] langs=${targetLangs.join(',')} namespaces=${files.length}`)

  for (const lang of targetLangs) {
    const langName = LANG_NAMES[lang]
    for (const file of files) {
      const en = JSON.parse(await readFile(join(enDir, file), 'utf-8')) as Json
      const { values, rebuild } = collectStrings(en)
      console.log(`[i18n] ${lang}/${file}: translating ${values.length} strings (${backend})…`)
      const t0 = performance.now()
      const translated =
        backend === 'openai'
          ? await translateBatchOpenAi(values, langName)
          : backend === 'ollama'
            ? await translateBatchOllama(values, langName)
            : await translateBatch(values, langName)
      const built = rebuild(translated)
      await writeFile(join(MESSAGES, lang, file), `${JSON.stringify(built, null, 2)}\n`, 'utf-8')
      console.log(`[i18n] ${lang}/${file}: done in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
    }
  }
  console.log('[i18n] all done.')
}

main().catch((e) => {
  console.error('[i18n] FAILED:', e.message)
  process.exit(1)
})
