/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractSkillFromZip, parseSkillMarkdown } from './utils'

describe('parseSkillMarkdown', () => {
  it('parses standard SKILL.md with name, description, and body', () => {
    const input = [
      '---',
      'name: my-skill',
      'description: Does something useful',
      '---',
      '',
      '# Instructions',
      'Use this skill to do things.',
    ].join('\n')

    expect(parseSkillMarkdown(input)).toEqual({
      name: 'my-skill',
      description: 'Does something useful',
      content: '# Instructions\nUse this skill to do things.',
    })
  })

  it('strips single and double quotes from frontmatter values', () => {
    const input = '---\nname: \'my-skill\'\ndescription: "A quoted description"\n---\nBody'

    expect(parseSkillMarkdown(input)).toEqual({
      name: 'my-skill',
      description: 'A quoted description',
      content: 'Body',
    })
  })

  it('preserves colons inside description values', () => {
    const input = '---\nname: api-tool\ndescription: API key: required for auth\n---\nBody'

    expect(parseSkillMarkdown(input)).toEqual({
      name: 'api-tool',
      description: 'API key: required for auth',
      content: 'Body',
    })
  })

  it('ignores unknown frontmatter fields', () => {
    const input = '---\nname: x\ndescription: y\nauthor: someone\nversion: 2\n---\nBody'

    const result = parseSkillMarkdown(input)
    expect(result.name).toBe('x')
    expect(result.description).toBe('y')
    expect(result.content).toBe('Body')
  })

  it('infers name from heading when frontmatter has no name field', () => {
    const input =
      '---\ndescription: A tool for blocks\nargument-hint: <name>\n---\n\n# Add Block Skill\n\nContent here.'

    expect(parseSkillMarkdown(input)).toEqual({
      name: 'add-block-skill',
      description: 'A tool for blocks',
      content: '# Add Block Skill\n\nContent here.',
    })
  })

  it('infers name from heading when there is no frontmatter at all', () => {
    const input = '# My Cool Tool\n\nSome instructions.'

    expect(parseSkillMarkdown(input)).toEqual({
      name: 'my-cool-tool',
      description: '',
      content: '# My Cool Tool\n\nSome instructions.',
    })
  })

  it('returns empty name when there is no frontmatter and no heading', () => {
    const input = 'Just some plain text without any structure.'

    expect(parseSkillMarkdown(input)).toEqual({
      name: '',
      description: '',
      content: 'Just some plain text without any structure.',
    })
  })

  it('handles empty input', () => {
    expect(parseSkillMarkdown('')).toEqual({
      name: '',
      description: '',
      content: '',
    })
  })

  it('handles frontmatter with empty name value', () => {
    const input = '---\nname:\ndescription: Has a description\n---\n\n# Fallback Heading\nBody'

    const result = parseSkillMarkdown(input)
    expect(result.name).toBe('fallback-heading')
    expect(result.description).toBe('Has a description')
  })

  it('handles frontmatter with no body', () => {
    const input = '---\nname: solo\ndescription: Just frontmatter\n---'

    expect(parseSkillMarkdown(input)).toEqual({
      name: 'solo',
      description: 'Just frontmatter',
      content: '',
    })
  })

  it('handles unclosed frontmatter as plain content', () => {
    const input = '---\nname: broken\nno closing delimiter'

    const result = parseSkillMarkdown(input)
    expect(result.name).toBe('')
    expect(result.content).toBe(input)
  })

  it('trims whitespace from input', () => {
    const input = '\n\n  ---\nname: trimmed\ndescription: yes\n---\nBody  \n\n'

    const result = parseSkillMarkdown(input)
    expect(result.name).toBe('trimmed')
    expect(result.content).toBe('Body')
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

  it('handles h2 and h3 headings for name inference', () => {
    expect(parseSkillMarkdown('## Sub Heading').name).toBe('sub-heading')
    expect(parseSkillMarkdown('### Third Level').name).toBe('third-level')
  })

  it('does not match h4+ headings for name inference', () => {
    expect(parseSkillMarkdown('#### Too Deep').name).toBe('')
  })

  it('uses first heading even when multiple exist', () => {
    const input = '# First\n\n## Second\n\n### Third'
    expect(parseSkillMarkdown(input).name).toBe('first')
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

  it('extracts SKILL.md at root level', async () => {
    const data = await makeZipBuffer({ 'SKILL.md': '---\nname: root\n---\nContent' })
    const content = await extractSkillFromZip(data)
    expect(content).toBe('---\nname: root\n---\nContent')
  })

  it('extracts SKILL.md from a nested directory', async () => {
    const data = await makeZipBuffer({ 'my-skill/SKILL.md': '---\nname: nested\n---\nBody' })
    const content = await extractSkillFromZip(data)
    expect(content).toBe('---\nname: nested\n---\nBody')
  })

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
