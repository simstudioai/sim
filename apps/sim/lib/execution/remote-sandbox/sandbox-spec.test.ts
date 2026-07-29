/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  canonicalizeDependencies,
  hashSandboxSpec,
  MAX_SANDBOX_DEPENDENCIES,
  parseJsDependency,
  quoteDependency,
  renderDependencyManifest,
  validateDependencies,
} from '@/lib/execution/remote-sandbox/sandbox-spec'

const PY = CodeLanguage.Python
const JS = CodeLanguage.JavaScript

function accepted(language: typeof PY | typeof JS, input: string): string[] {
  const result = validateDependencies(language, input)
  if (!result.ok) {
    throw new Error(`expected acceptance, got: ${JSON.stringify(result.issues)}`)
  }
  return result.dependencies
}

function rejection(language: typeof PY | typeof JS, input: string) {
  const result = validateDependencies(language, input)
  if (result.ok) throw new Error(`expected rejection of ${input}`)
  return result.issues
}

describe('validateDependencies (python)', () => {
  it.each([
    'Django==5.0',
    'google-cloud-bigquery[pandas]>=3',
    'pandas',
    'pyairtable>=3.0',
    'requests>=2.0,<3.0',
    'numpy~=1.26',
    'urllib3!=2.0.0',
  ])('accepts %s', (value) => {
    expect(accepted(PY, value)).toHaveLength(1)
  })

  it.each([
    ['git+https://github.com/psf/requests', 'URLs and VCS references are not allowed'],
    ['-e .', 'installer flags are not allowed (remove the leading dash)'],
    ['--index-url http://evil', 'installer flags are not allowed (remove the leading dash)'],
    ['foo; rm -rf /', 'a dependency cannot contain spaces'],
    ['../local-package', 'local paths are not allowed'],
    ['https://example.com/pkg.whl', 'URLs and VCS references are not allowed'],
  ])('rejects %s', (value, reason) => {
    const issues = rejection(PY, value)
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toBe(reason)
  })

  it('reports the offending line number against the submitted row', () => {
    const issues = rejection(PY, ['pandas', '', '# a comment', 'git+https://evil', 'requests'])
    expect(issues).toHaveLength(1)
    expect(issues[0].line).toBe(4)
    expect(issues[0].value).toBe('git+https://evil')
  })

  it('strips comments and blank lines', () => {
    expect(accepted(PY, '# deps\n\npandas\n\n  # trailing\nrequests\n')).toEqual([
      'pandas',
      'requests',
    ])
  })

  it('rejects more than the dependency cap and marks every entry past it', () => {
    const list = Array.from({ length: MAX_SANDBOX_DEPENDENCIES + 1 }, (_, i) => `pkg-${i}`)
    const issues = rejection(PY, list)
    expect(issues).toHaveLength(1)
    expect(issues[0].line).toBe(MAX_SANDBOX_DEPENDENCIES + 1)
  })

  it('rejects an over-long entry', () => {
    const issues = rejection(PY, `pkg${'a'.repeat(300)}`)
    expect(issues[0].reason).toContain('longer than')
  })
})

describe('validateDependencies (javascript)', () => {
  it.each([
    'axios@^1.7.0',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-s3@^3.600.0',
    'zod',
    'lodash@4.17.21',
    'left-pad@latest',
  ])('accepts %s', (value) => {
    expect(accepted(JS, value)).toHaveLength(1)
  })

  it.each([
    ['git+https://github.com/axios/axios', 'URLs and VCS references are not allowed'],
    ['file:../local', 'local and alias specifiers are not allowed'],
    ['link:../sibling', 'local and alias specifiers are not allowed'],
    ['workspace:*', 'local and alias specifiers are not allowed'],
    ['npm:alias@1.0.0', 'local and alias specifiers are not allowed'],
    ['axios@>=1.2 <2', 'a dependency cannot contain spaces'],
  ])('rejects %s', (value, reason) => {
    const issues = rejection(JS, value)
    expect(issues[0].reason).toBe(reason)
  })
})

describe('canonicalization and hashing', () => {
  it('is stable under reordering', () => {
    const a = hashSandboxSpec({ language: PY, dependencies: ['requests', 'pandas'] })
    const b = hashSandboxSpec({ language: PY, dependencies: ['pandas', 'requests'] })
    expect(a).toBe(b)
  })

  it('normalizes python names per PEP 503, so casing and separators do not fork a build', () => {
    const a = hashSandboxSpec({ language: PY, dependencies: ['Google_Cloud.BigQuery'] })
    const b = hashSandboxSpec({ language: PY, dependencies: ['google-cloud-bigquery'] })
    expect(a).toBe(b)
    expect(canonicalizeDependencies(PY, ['Google_Cloud.BigQuery'])).toEqual([
      'google-cloud-bigquery',
    ])
  })

  it('leaves npm names verbatim, because the registry serves React and react separately', () => {
    expect(canonicalizeDependencies(JS, ['React'])).toEqual(['React'])
    expect(hashSandboxSpec({ language: JS, dependencies: ['React'] })).not.toBe(
      hashSandboxSpec({ language: JS, dependencies: ['react'] })
    )
  })

  it('de-duplicates', () => {
    expect(canonicalizeDependencies(PY, ['pandas', 'pandas', 'PANDAS'])).toEqual(['pandas'])
  })

  it('hashes the same list differently under different languages', () => {
    expect(hashSandboxSpec({ language: PY, dependencies: ['lodash'] })).not.toBe(
      hashSandboxSpec({ language: JS, dependencies: ['lodash'] })
    )
  })

  it('preserves the version specifier while normalizing only the name', () => {
    expect(canonicalizeDependencies(PY, ['Google_Cloud.BigQuery[Pandas]>=3.0'])).toEqual([
      'google-cloud-bigquery[Pandas]>=3.0',
    ])
  })
})

describe('shell quoting', () => {
  it('quotes specifier characters that a shell would otherwise interpret', () => {
    expect(quoteDependency('django>=5.0')).toBe("'django>=5.0'")
  })

  it('refuses to quote a value that never passed validation', () => {
    expect(() => quoteDependency("foo' ; rm -rf /")).toThrow(/unvalidated dependency/)
  })
})

describe('manifest rendering', () => {
  it('renders a requirements.txt for python', () => {
    expect(renderDependencyManifest({ language: PY, dependencies: ['requests', 'pandas'] })).toBe(
      'pandas\nrequests\n'
    )
  })

  it('renders a package.json dependency map for javascript', () => {
    const manifest = renderDependencyManifest({
      language: JS,
      dependencies: ['axios@^1.7.0', '@aws-sdk/client-s3', 'zod@3.23.8'],
    })
    expect(JSON.parse(manifest).dependencies).toEqual({
      '@aws-sdk/client-s3': '*',
      axios: '^1.7.0',
      zod: '3.23.8',
    })
  })

  it('splits a scoped name from its range without mistaking the scope for one', () => {
    expect(parseJsDependency('@aws-sdk/client-s3')).toEqual({
      name: '@aws-sdk/client-s3',
      range: '*',
    })
    expect(parseJsDependency('@aws-sdk/client-s3@^3.0.0')).toEqual({
      name: '@aws-sdk/client-s3',
      range: '^3.0.0',
    })
  })
})
