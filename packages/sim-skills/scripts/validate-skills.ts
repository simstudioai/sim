import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoot = resolve(packageRoot, 'sim')
const skillsDirectory = resolve(pluginRoot, 'skills')
const pluginManifestPaths = [
  resolve(pluginRoot, '.codex-plugin', 'plugin.json'),
  resolve(pluginRoot, '.claude-plugin', 'plugin.json'),
] as const
const pluginName = 'sim'
const expectedSkillNames = [
  'build-workflow',
  'deploy-workflow',
  'knowledge-base',
  'run-workflow',
  'table',
] as const
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SKILL_NAME_LENGTH = 64
const MAX_SKILL_DESCRIPTION_LENGTH = 1024

function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const prefix = `${key}:`
  return frontmatter
    .split('\n')
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`${path}: expected a JSON object`)
  return parsed
}

async function validatePluginManifest(path: string, version: string): Promise<void> {
  const manifest = await readJsonObject(path)
  if (manifest.name !== pluginName) throw new Error(`${path}: plugin name must be ${pluginName}`)
  if (manifest.version !== version) {
    throw new Error(`${path}: version must match package version ${version}`)
  }
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    throw new Error(`${path}: description is required`)
  }
  if (manifest.skills !== './skills/') {
    throw new Error(`${path}: skills must point to ./skills/`)
  }
}

async function validateSkill(directoryName: string): Promise<void> {
  if (!skillNamePattern.test(directoryName)) {
    throw new Error(`${directoryName}: skill directory must be lowercase kebab-case`)
  }
  if (directoryName.length > MAX_SKILL_NAME_LENGTH) {
    throw new Error(
      `${directoryName}: skill name must be ${MAX_SKILL_NAME_LENGTH} characters or fewer`
    )
  }

  const raw = await readFile(resolve(skillsDirectory, directoryName, 'SKILL.md'), 'utf8')
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/)
  if (!match) throw new Error(`${directoryName}: SKILL.md must contain YAML frontmatter and a body`)

  const [, frontmatter, body] = match
  const name = frontmatterValue(frontmatter, 'name')
  const description = frontmatterValue(frontmatter, 'description')

  if (name !== directoryName) {
    throw new Error(`${directoryName}: frontmatter name must match the directory`)
  }
  if (!description) throw new Error(`${directoryName}: description is required`)
  if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    throw new Error(
      `${directoryName}: description must be ${MAX_SKILL_DESCRIPTION_LENGTH} characters or fewer`
    )
  }
  if (!body.trim()) throw new Error(`${directoryName}: instruction body is required`)
  if (/\b(?:TODO|PLACEHOLDER)\b/.test(raw)) {
    throw new Error(`${directoryName}: unfinished scaffold marker found`)
  }
}

const entries = await readdir(skillsDirectory, { withFileTypes: true })
const skillDirectories = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
if (skillDirectories.length === 0) throw new Error('sim-skills must contain at least one skill')
if (skillDirectories.join('\n') !== expectedSkillNames.join('\n')) {
  throw new Error(`Expected Sim skills: ${expectedSkillNames.join(', ')}`)
}

const packageManifest = await readJsonObject(resolve(packageRoot, 'package.json'))
const packageVersion = packageManifest.version
if (typeof packageVersion !== 'string' || !packageVersion) {
  throw new Error('package.json: version is required')
}

await Promise.all([
  ...skillDirectories.map(validateSkill),
  ...pluginManifestPaths.map((path) => validatePluginManifest(path, packageVersion)),
])
process.stdout.write(`Validated the ${pluginName} plugin and ${skillDirectories.length} skills.\n`)
