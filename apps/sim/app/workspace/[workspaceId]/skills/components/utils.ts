import JSZip from 'jszip'

interface ParsedSkill {
  name: string
  description: string
  content: string
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

  if (!name) {
    name = inferNameFromHeading(body)
  }

  return { name, description, content: body }
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
 * Accepts File, Blob, ArrayBuffer, or Uint8Array (anything JSZip supports).
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
