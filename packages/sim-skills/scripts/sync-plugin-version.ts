import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginManifestPaths = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`${path}: expected a JSON object`)
  return parsed
}

export async function syncPluginVersion(packageRoot = defaultPackageRoot): Promise<string> {
  const packageManifestPath = resolve(packageRoot, 'package.json')
  const packageManifest = await readJsonObject(packageManifestPath)
  const version = packageManifest.version
  if (typeof version !== 'string' || !version) {
    throw new Error(`${packageManifestPath}: version is required`)
  }

  await Promise.all(
    pluginManifestPaths.map(async (relativePath) => {
      const path = resolve(packageRoot, relativePath)
      const manifest = await readJsonObject(path)
      manifest.version = version
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
    })
  )

  return version
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = await syncPluginVersion()
  process.stdout.write(`Synchronized Sim plugin manifests to ${version}.\n`)
}
