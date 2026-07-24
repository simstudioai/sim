import JSZip from 'jszip'
import { isApiClientError } from '@/lib/api/client/errors'

export interface ParsedSkill {
  name: string
  description: string
  content: string
  /** True only when `name` came from a real YAML `name:` key (not inferred from a heading). */
  nameFromFrontmatter: boolean
}

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/

/**
 * Parses a SKILL.md string with optional YAML frontmatter into structured fields.
 *
 * Expected format:
 * ```
 * ---
 * name: my-skill
 * description: What this skill does
 * ---
 * # Markdown content here...
 * ```
 *
 * If no frontmatter is present, the entire text becomes the content field.
 */
export function parseSkillMarkdown(raw: string): ParsedSkill {
  const trimmed = raw.replace(/\r\n/g, '\n').trim()
  const match = trimmed.match(FRONTMATTER_REGEX)

  if (!match) {
    return {
      name: inferNameFromHeading(trimmed),
      description: '',
      content: trimmed,
      nameFromFrontmatter: false,
    }
  }

  const frontmatter = match[1]
  const body = (match[2] ?? '').trim()

  let name = ''
  let description = ''

  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim().toLowerCase()
    const value = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')

    if (key === 'name') {
      name = value
    } else if (key === 'description') {
      description = value
    }
  }

  const nameFromFrontmatter = name !== ''
  if (!name) {
    name = inferNameFromHeading(body)
  }

  return { name, description, content: body, nameFromFrontmatter }
}

/**
 * Derives a kebab-case name from the first markdown heading (e.g. `# Add Block Skill` -> `add-block-skill`).
 */
function inferNameFromHeading(markdown: string): string {
  const headingMatch = markdown.match(/^#{1,3}\s+(.+)$/m)
  if (!headingMatch) return ''

  return headingMatch[1]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

/**
 * Extracts the SKILL.md content from a ZIP archive.
 * Searches for a file named SKILL.md at any depth within the archive.
 */
export async function extractSkillFromZip(
  data: File | Blob | ArrayBuffer | Uint8Array
): Promise<string> {
  const zip = await JSZip.loadAsync(data)

  const candidates: string[] = []
  zip.forEach((relativePath, entry) => {
    if (!entry.dir && relativePath.endsWith('SKILL.md')) {
      candidates.push(relativePath)
    }
  })

  if (candidates.length === 0) {
    throw new Error('No SKILL.md file found in the ZIP archive')
  }

  candidates.sort((a, b) => {
    const depthA = a.split('/').length
    const depthB = b.split('/').length
    return depthA - depthB
  })

  const content = await zip.file(candidates[0])!.async('string')
  return content
}
const KEBAB_CASE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Validates a skill name against the same rules the API enforces
 * (`skillNameSchema`). Returns the field message, or null when valid. Shared so
 * the rule and its copy live in one place across every skill editing surface.
 */
export function validateSkillName(name: string): string | null {
  if (!name.trim()) return 'Name is required'
  if (name.length > 64) return 'Name must be 64 characters or less'
  if (!KEBAB_CASE_REGEX.test(name)) return 'Name must be kebab-case (e.g. my-skill)'
  return null
}

const SKILL_IMPORT_EXTENSIONS = ['.md', '.zip'] as const

/** ZIPs are read fully in memory to find the SKILL.md, so cap what we'll accept. */
const MAX_SKILL_ZIP_BYTES = 5 * 1024 * 1024

/** `accept` attribute for the skill file pickers. */
export const SKILL_IMPORT_ACCEPT = SKILL_IMPORT_EXTENSIONS.join(',')

/**
 * Reads a user-picked `.md` or `.zip` into structured skill fields — the shared
 * path behind every import entry point (the create page's Import action and the
 * canvas modal's Import tab). Throws a user-facing message on an unsupported
 * extension, an oversized ZIP, or a ZIP with no SKILL.md inside.
 */
export async function readSkillFile(file: File): Promise<ParsedSkill> {
  const name = file.name.toLowerCase()

  if (!SKILL_IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    throw new Error('Unsupported file type. Use .md or .zip files.')
  }

  if (name.endsWith('.zip')) {
    if (file.size > MAX_SKILL_ZIP_BYTES) {
      throw new Error('ZIP file is too large (max 5 MB)')
    }
    return parseSkillMarkdown(await extractSkillFromZip(file))
  }

  return parseSkillMarkdown(await file.text())
}

/**
 * Whether a skill save failed on the per-workspace unique-name constraint
 * (HTTP 409). Surfaces as an inline Name-field error at the callsites; the
 * server message names the conflicting skill.
 */
export function isSkillNameConflictError(error: unknown): boolean {
  return isApiClientError(error) && error.status === 409
}
