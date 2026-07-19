/**
 * End-to-end local i18n pipeline.
 *
 * Stages:
 *   1. Extract hardcoded client strings into English catalogs.
 *   2. Prepare English source catalogs for every namespace/key found in target locales.
 *   3. Translate the complete English catalog into RU/DE through local Ollama.
 *
 * Usage:
 *   bun run scripts/i18n-local-all.ts
 *   bun run scripts/i18n-local-all.ts --target apps/sim/app/chat --only auto
 *   bun run scripts/i18n-local-all.ts --lang ru --limit 50
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OLLAMA_HOST = process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b'

const args = process.argv.slice(2)

function readArg(name: string): string | null {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] || null : null
}

function readRepeatedArg(name: string): string[] {
  const values: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1]) values.push(args[i + 1])
  }
  return values
}

const targets = (
  readRepeatedArg('--target').length
    ? readRepeatedArg('--target')
    : (readArg('--targets') || 'apps/sim/app,apps/sim/components').split(',')
)
  .map((target) => target.trim())
  .filter(Boolean)

const lang = readArg('--lang') || 'ru,de'
const only = readArg('--only')
const limit = readArg('--limit')
const dryRun = args.includes('--dry-run')
const skipExtract = args.includes('--skip-extract')
const skipPrepareEn = args.includes('--skip-prepare-en')
const skipTranslate = args.includes('--skip-translate')
const skipProbe = args.includes('--skip-probe')

async function runStep(name: string, command: string[], options: { allowFailure?: boolean } = {}) {
  console.log(`[i18n-all] ${name}: ${command.join(' ')}`)
  const proc = Bun.spawn(command, {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${name} failed with exit code ${code}`)
  }
  return code
}

async function assertOllamaAvailable() {
  const url = `${OLLAMA_HOST.replace(/\/$/, '')}/api/tags`
  const response = await fetch(url)
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

async function main() {
  console.log(
    `[i18n-all] local backend=ollama host=${OLLAMA_HOST} model=${OLLAMA_MODEL} lang=${lang} targets=${targets.join(',')}`
  )

  if (!skipProbe && !skipTranslate && !dryRun) {
    await assertOllamaAvailable()
  }

  if (!skipExtract) {
    for (const target of targets) {
      const extractArgs = ['bun', 'run', 'scripts/i18n-migrate/extract.ts', target]
      if (!dryRun) extractArgs.push('--write')
      if (limit) extractArgs.push('--limit', limit)
      await runStep(`extract ${target}`, extractArgs)
    }
  }

  if (!skipPrepareEn) {
    const prepareArgs = ['bun', 'run', 'scripts/i18n-prepare-en.ts', '--langs', lang]
    if (!dryRun) prepareArgs.push('--write')
    await runStep('prepare complete English catalogs', prepareArgs)
  }

  if (!skipTranslate && !dryRun) {
    const translateArgs = [
      'bun',
      'run',
      'scripts/i18n-translate/run.ts',
      '--backend',
      'ollama',
      '--lang',
      lang,
    ]
    if (only) translateArgs.push('--only', only)
    await runStep('translate catalogs', translateArgs)
  } else if (dryRun) {
    console.log('[i18n-all] dry-run: skipped catalog translation')
  }

  console.log('[i18n-all] done.')
}

main().catch((error) => {
  console.error('[i18n-all] FAILED:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
