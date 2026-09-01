/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractCodeSecretNames } from '@/executor/utils/code-secret-references'

describe('Copilot code secret declarations', () => {
  it.each(['javascript', 'python'])(
    'matches trimmed and embedded references for %s',
    async (language) => {
      expect(
        await extractCodeSecretNames(
          'const first = "prefix-{{ API_KEY }}"\nreturn "{{TOKEN}}/{{API_KEY}}"',
          language
        )
      ).toEqual(['API_KEY', 'TOKEN'])
    }
  )

  it('matches shell references supported by the shared compiler', async () => {
    expect(
      await extractCodeSecretNames(
        'echo {{API_KEY}} {{ API_KEY }} {{9INVALID}} {{WITH-DASH}} {{_TOKEN}}',
        'shell'
      )
    ).toEqual(['API_KEY', '_TOKEN'])
  })

  it('ignores direct environment access, shell variables, literals, and malformed references', async () => {
    expect(
      await extractCodeSecretNames(
        'return environmentVariables.API_KEY + "$TOKEN" + "literal" + "{{}}" + "{{MISSING"',
        'javascript'
      )
    ).toEqual([])
  })

  it.each([
    ['javascript', '// {{COMMENT_ONLY}}\nreturn {{USED}}'],
    ['python', '# {{COMMENT_ONLY}}\nreturn {{USED}}'],
    ['shell', '# {{COMMENT_ONLY}}\necho {{USED}}'],
  ])('ignores placeholders in %s comments', async (language, code) => {
    await expect(extractCodeSecretNames(code, language)).resolves.toEqual(['USED'])
  })
})
