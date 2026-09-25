import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractSkillFromZip, parseSkillMarkdown } from './utils'

describe('parseSkillMarkdown', () => {
  it('preserves colons inside description values', () => {
    const input = '---\nname: api-tool\ndescription: API key: required for auth\n---\nBody'

    expect(parseSkillMarkdown(input)).toEqual({
      name: 'api-tool',
      description: 'API key: required for auth',
      content: 'Body',
      nameFromFrontmatter: true,
    })
  })

  it('handles unclosed frontmatter as plain content', () => {
    const input = '---\nname: broken\nno closing delimiter'

    const result = parseSkillMarkdown(input)
    expect(result.name).toBe('')
    expect(result.content).toBe(input)
  })

  it('flags nameFromFrontmatter only for a real YAML name key (the paste-destructure gate)', () => {
    expect(parseSkillMarkdown('---\nname: real\n---\nBody').nameFromFrontmatter).toBe(true)
    // A `---` thematic break + heading must NOT count — it would wrongly destructure on paste.
    expect(parseSkillMarkdown('---\n# Setup Guide\nnotes').nameFromFrontmatter).toBe(false)
    // A changelog whose second `---` closes the regex but has no name key.
    expect(parseSkillMarkdown('---\n\n## v2.0\n\n---\n\n## v1.0').nameFromFrontmatter).toBe(false)
  })

  it('truncates inferred heading names to 64 characters', () => {
    const longHeading = `# ${'A'.repeat(100)}`
    const result = parseSkillMarkdown(longHeading)
    expect(result.name.length).toBeLessThanOrEqual(64)
  })

  it('sanitizes special characters in inferred heading names', () => {
    const input = '# Hello, World! (v2) — Updated'
    const result = parseSkillMarkdown(input)
    expect(result.name).toBe('hello-world-v2-updated')
  })
})

describe('extractSkillFromZip', () => {
  async function makeZipBuffer(files: Record<string, string>): Promise<Uint8Array> {
    const zip = new JSZip()
    for (const [path, content] of Object.entries(files)) {
      zip.file(path, content)
    }
    return zip.generateAsync({ type: 'uint8array' })
  }

  it('prefers the shallowest SKILL.md when multiple exist', async () => {
    const data = await makeZipBuffer({
      'deep/nested/SKILL.md': 'deep',
      'SKILL.md': 'root',
      'other/SKILL.md': 'other',
    })
    const content = await extractSkillFromZip(data)
    expect(content).toBe('root')
  })

  it('throws when no SKILL.md is found', async () => {
    const data = await makeZipBuffer({ 'README.md': 'No skill here' })
    await expect(extractSkillFromZip(data)).rejects.toThrow('No SKILL.md file found')
  })
})
