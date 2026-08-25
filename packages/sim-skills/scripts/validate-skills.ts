import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillsDirectory = resolve(packageRoot, 'skills')
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
const skillDirectories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
if (skillDirectories.length === 0) throw new Error('sim-skills must contain at least one skill')

await Promise.all(skillDirectories.map(validateSkill))
process.stdout.write(`Validated ${skillDirectories.length} Sim skills.\n`)
