/**
 * Prepare complete English i18n source catalogs before translating target locales.
 *
 * It scans apps/sim/messages/{en,ru,de}, builds the union of namespaces and keys,
 * and fills missing apps/sim/messages/en entries by translating an existing
 * locale value back to English through local Ollama.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MESSAGES = join(ROOT, 'apps', 'sim', 'messages')
const OLLAMA_HOST = process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b'
const OLLAMA_CHUNK = Number(process.env.I18N_OLLAMA_CHUNK || 12)
const OLLAMA_TIMEOUT_MS = Number(process.env.I18N_OLLAMA_TIMEOUT_MS || 60_000)

const args = process.argv.slice(2)
const write = args.includes('--write')
const langArg = args.includes('--langs') ? args[args.indexOf('--langs') + 1] : 'ru,de'
const sourceLangs = langArg
  .split(',')
  .map((lang) => lang.trim())
  .filter(Boolean)

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

interface MissingItem {
  namespace: string
  path: string[]
  sourceLang: string
  sourceValue: string
}

function isObject(value: Json): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function readJson(path: string): Promise<JsonObject> {
  if (!existsSync(path)) return {}
  return JSON.parse(await readFile(path, 'utf-8')) as JsonObject
}

async function listNamespaceFiles(lang: string): Promise<string[]> {
  const dir = join(MESSAGES, lang)
  if (!existsSync(dir)) return []
  return (await readdir(dir)).filter((file) => file.endsWith('.json')).sort()
}

function getAt(root: Json, path: string[]): Json | undefined {
  let node: Json | undefined = root
  for (const part of path) {
    if (node === undefined || (!isObject(node) && !Array.isArray(node))) return undefined
    node = (node as JsonObject | Json[])[part as never] as Json | undefined
  }
  return node
}

function setAt(root: JsonObject, path: string[], value: string) {
  let node: JsonObject = root
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (!isObject(node[key])) node[key] = {}
    node = node[key] as JsonObject
  }
  node[path[path.length - 1]] = value
}

function collectStringPaths(value: Json, prefix: string[] = [], out = new Map<string, string[]>()) {
  if (typeof value === 'string') {
    out.set(prefix.join('\u0000'), prefix)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringPaths(item, [...prefix, String(index)], out))
    return out
  }
  if (isObject(value)) {
    Object.entries(value).forEach(([key, item]) => collectStringPaths(item, [...prefix, key], out))
  }
  return out
}

async function assertOllamaModel() {
  const response = await fetch(`${OLLAMA_HOST.replace(/\/$/, '')}/api/tags`)
  if (!response.ok) {
    throw new Error(`Ollama probe failed: ${response.status} ${response.statusText}`)
  }
  const data = (await response.json()) as { models?: Array<{ name?: string }> }
  const models = data.models?.map((model) => model.name).filter(Boolean) ?? []
  if (!models.includes(OLLAMA_MODEL)) {
    throw new Error(
      `Ollama model "${OLLAMA_MODEL}" is not installed. Available models: ${models.join(', ') || 'none'}`
    )
  }
}

async function translateChunkToEnglish(
  values: string[],
  sourceLang: string
): Promise<string[] | null> {
  const signal = AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${OLLAMA_HOST.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [
          {
            role: 'system',
            content: `You are a professional UI localization engine for a software product named "Sim". Translate every string in the input JSON array "s" from ${sourceLang} to English. Return ONLY a JSON object {"t":[...]} with EXACTLY the same length and order. Preserve placeholders like {name}, {{x}}, %s, $1; HTML tags; markdown; URLs; code; and the product name "Sim". Keep concise UI wording.`,
          },
          { role: 'user', content: JSON.stringify({ s: values }) },
        ],
      }),
    })
  } catch {
    return null
  }
  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  const json = (await response.json()) as { message?: { content?: string } }
  let translated: unknown
  try {
    translated = JSON.parse(json.message?.content ?? '').t
  } catch {
    return null
  }
  if (!Array.isArray(translated) || translated.length !== values.length) {
    return null
  }
  return translated.map((item) => String(item))
}

async function translateChunkToEnglishStrict(
  values: string[],
  sourceLang: string
): Promise<string[]> {
  const translated = await translateChunkToEnglish(values, sourceLang)
  if (translated) return translated
  if (values.length === 1) {
    return [await translateSingleToEnglish(values[0], sourceLang)]
  }
  console.log(`[i18n-prepare-en] retry: splitting ${values.length} strings`)
  const mid = Math.floor(values.length / 2)
  const left = await translateChunkToEnglishStrict(values.slice(0, mid), sourceLang)
  const right = await translateChunkToEnglishStrict(values.slice(mid), sourceLang)
  return [...left, ...right]
}

async function translateSingleToEnglish(value: string, sourceLang: string): Promise<string> {
  try {
    const response = await fetch(`${OLLAMA_HOST.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        options: { temperature: 0 },
        prompt: `Translate this UI string from ${sourceLang} to English. Return only the translated string, no quotes, no notes. Preserve placeholders, URLs, markdown, code, and the product name "Sim".\n\n${value}`,
      }),
    })
    if (!response.ok) throw new Error(`Ollama ${response.status}`)
    const data = (await response.json()) as { response?: string }
    const translated = data.response?.trim().replace(/^["']|["']$/g, '')
    if (translated) return translated
  } catch {
    // Fall through to source fallback below.
  }
  console.warn(`[i18n-prepare-en] warning: keeping source text for single string: ${value.slice(0, 80)}`)
  return value
}

async function translateMissing(items: MissingItem[], label: string): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < items.length; i += OLLAMA_CHUNK) {
    const chunk = items.slice(i, i + OLLAMA_CHUNK)
    console.log(
      `[i18n-prepare-en] ${label}: chunk ${Math.floor(i / OLLAMA_CHUNK) + 1}/${Math.ceil(
        items.length / OLLAMA_CHUNK
      )} (${chunk.length} strings)`
    )
    const sourceLang = chunk.every((item) => item.sourceLang === chunk[0].sourceLang)
      ? chunk[0].sourceLang
      : 'the source language'
    const values = chunk.map((item) => item.sourceValue)
    out.push(...(await translateChunkToEnglishStrict(values, sourceLang)))
  }
  return out
}

async function main() {
  await mkdir(join(MESSAGES, 'en'), { recursive: true })
  const langs = ['en', ...sourceLangs]
  const namespaceFiles = new Set<string>()
  for (const lang of langs) {
    for (const file of await listNamespaceFiles(lang)) namespaceFiles.add(file)
  }

  const missing: MissingItem[] = []
  const enByNamespace = new Map<string, JsonObject>()
  const sourceByNamespace = new Map<string, Map<string, JsonObject>>()

  for (const file of [...namespaceFiles].sort()) {
    const namespace = file.replace(/\.json$/, '')
    const en = await readJson(join(MESSAGES, 'en', file))
    enByNamespace.set(namespace, en)

    const sources = new Map<string, JsonObject>()
    for (const lang of sourceLangs) {
      sources.set(lang, await readJson(join(MESSAGES, lang, file)))
    }
    sourceByNamespace.set(namespace, sources)

    const unionPaths = new Map<string, string[]>()
    collectStringPaths(en).forEach((path, key) => unionPaths.set(key, path))
    sources.forEach((source) => {
      collectStringPaths(source).forEach((path, key) => unionPaths.set(key, path))
    })

    for (const path of unionPaths.values()) {
      if (typeof getAt(en, path) === 'string') continue
      for (const lang of sourceLangs) {
        const sourceValue = getAt(sources.get(lang) ?? {}, path)
        if (typeof sourceValue === 'string' && sourceValue.trim()) {
          missing.push({ namespace, path, sourceLang: lang, sourceValue })
          break
        }
      }
    }
  }

  console.log(
    `[i18n-prepare-en] namespaces=${namespaceFiles.size} missingEnglishStrings=${missing.length} write=${write}`
  )

  if (!missing.length) return
  if (!write) return

  await assertOllamaModel()
  const missingByNamespace = new Map<string, MissingItem[]>()
  for (const item of missing) {
    const items = missingByNamespace.get(item.namespace) ?? []
    items.push(item)
    missingByNamespace.set(item.namespace, items)
  }

  for (const [namespace, items] of [...missingByNamespace.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const en = enByNamespace.get(namespace)
    if (!en) throw new Error(`missing in-memory namespace ${namespace}`)
    console.log(`[i18n-prepare-en] ${namespace}: filling ${items.length} English strings`)
    const translated = await translateMissing(items, namespace)
    items.forEach((item, index) => setAt(en, item.path, translated[index]))
    await writeFile(join(MESSAGES, 'en', `${namespace}.json`), `${JSON.stringify(en, null, 2)}\n`)
    console.log(`[i18n-prepare-en] ${namespace}: wrote en/${namespace}.json`)
  }
}

main().catch((error) => {
  console.error('[i18n-prepare-en] FAILED:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
