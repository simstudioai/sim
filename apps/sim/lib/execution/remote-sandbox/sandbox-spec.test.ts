/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  canonicalizeDependencies,
  canonicalizeSystemPackages,
  hashSandboxSpec,
  MAX_SANDBOX_DEPENDENCIES,
  MAX_SANDBOX_SYSTEM_PACKAGES,
  parseJsDependency,
  quoteDependency,
  quoteSystemPackage,
  renderDependencyManifest,
  SANDBOX_SYSTEM_PACKAGE_RECIPE_REVISION,
  systemPackageInstallCommand,
  validateDependencies,
  validateSystemPackages,
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

function acceptedSystemPackages(input: string | readonly string[]): string[] {
  const result = validateSystemPackages(input)
  if (!result.ok) {
    throw new Error(`expected acceptance, got: ${JSON.stringify(result.issues)}`)
  }
  return result.systemPackages
}

function rejectedSystemPackages(input: string | readonly string[]) {
  const result = validateSystemPackages(input)
  if (result.ok) throw new Error(`expected rejection of ${String(input)}`)
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

describe('validateSystemPackages', () => {
  it.each([
    'jq',
    'libssl-dev:amd64',
    'curl=7.88.1-10+deb12u8',
    'libstdc++6:arm64=12.2.0-14+deb12u1',
    'google-cloud-cli=1:577.0.0-0~bookworm',
    'g++',
  ])('accepts the Debian coordinate %s', (value) => {
    expect(acceptedSystemPackages(value)).toEqual([value])
  })

  it.each([
    ['--reinstall', 'apt flags are not allowed'],
    ['jq curl', 'cannot contain spaces'],
    ['https://example.com/tool.deb', 'URLs are not allowed'],
    ['./tool.deb', 'paths are not allowed'],
    ['jq;whoami', 'not a valid Debian package coordinate'],
    ['jq$(whoami)', 'not a valid Debian package coordinate'],
    ['jq*', 'not a valid Debian package coordinate'],
    ['JQ', 'not a valid Debian package coordinate'],
    ['jq=', 'not a valid Debian package coordinate'],
    ['jq=latest', 'not a valid Debian package coordinate'],
    ['python3-', 'APT package action suffixes are not allowed'],
    ['python3+', 'APT package action suffixes are not allowed'],
    ['a.+', 'APT package action suffixes are not allowed'],
  ])('rejects %s', (value, reason) => {
    expect(rejectedSystemPackages(value)[0].reason).toContain(reason)
  })

  it('preserves source line numbers and canonicalizes by exact dedupe and sort', () => {
    expect(acceptedSystemPackages(['curl', '', '# tools', 'jq', 'curl'])).toEqual(['curl', 'jq'])
    const issues = rejectedSystemPackages(['curl', '', '# tools', 'jq;whoami'])
    expect(issues[0]).toMatchObject({ line: 4, value: 'jq;whoami' })
  })

  it('enforces the independent system-package cap', () => {
    const packages = Array.from(
      { length: MAX_SANDBOX_SYSTEM_PACKAGES + 1 },
      (_, index) => `pkg-${index}`
    )
    expect(rejectedSystemPackages(packages)[0].line).toBe(MAX_SANDBOX_SYSTEM_PACKAGES + 1)
  })
})

describe('canonicalization and hashing', () => {
  it('is stable under reordering', () => {
    const a = hashSandboxSpec({
      language: PY,
      dependencies: ['requests', 'pandas'],
      cliTools: [],
      systemPackages: [],
    })
    const b = hashSandboxSpec({
      language: PY,
      dependencies: ['pandas', 'requests'],
      cliTools: [],
      systemPackages: [],
    })
    expect(a).toBe(b)
  })

  it('normalizes python names per PEP 503, so casing and separators do not fork a build', () => {
    const a = hashSandboxSpec({
      language: PY,
      dependencies: ['Google_Cloud.BigQuery'],
      cliTools: [],
      systemPackages: [],
    })
    const b = hashSandboxSpec({
      language: PY,
      dependencies: ['google-cloud-bigquery'],
      cliTools: [],
      systemPackages: [],
    })
    expect(a).toBe(b)
    expect(canonicalizeDependencies(PY, ['Google_Cloud.BigQuery'])).toEqual([
      'google-cloud-bigquery',
    ])
  })

  it('leaves npm names verbatim, because the registry serves React and react separately', () => {
    expect(canonicalizeDependencies(JS, ['React'])).toEqual(['React'])
    expect(
      hashSandboxSpec({ language: JS, dependencies: ['React'], cliTools: [], systemPackages: [] })
    ).not.toBe(
      hashSandboxSpec({ language: JS, dependencies: ['react'], cliTools: [], systemPackages: [] })
    )
  })

  it('de-duplicates', () => {
    expect(canonicalizeDependencies(PY, ['pandas', 'pandas', 'PANDAS'])).toEqual(['pandas'])
  })

  it('hashes the same list differently under different languages', () => {
    expect(
      hashSandboxSpec({ language: PY, dependencies: ['lodash'], cliTools: [], systemPackages: [] })
    ).not.toBe(
      hashSandboxSpec({ language: JS, dependencies: ['lodash'], cliTools: [], systemPackages: [] })
    )
  })

  it('keeps the legacy hash when no CLI tools are selected', () => {
    expect(
      hashSandboxSpec({ language: PY, dependencies: ['pandas'], cliTools: [], systemPackages: [] })
    ).toBe('3cb7368874bfdafa9dd293a91849aac35740df244e294affedd728f9a5ec6959')
  })

  it('includes the immutable CLI recipe identity in the hash', () => {
    const canonical = JSON.stringify({
      language: PY,
      dependencies: ['pandas'],
      cliTools: [
        {
          id: 'google-cloud-cli@577.0.0-r1',
          revision: 1,
          sha256: '0b32d330446ce7b0f57f253e7efab4636c18fb1f87a3ac31c6c3f2a2a697525e',
        },
      ],
    })
    expect(
      hashSandboxSpec({
        language: PY,
        dependencies: ['pandas'],
        cliTools: ['google-cloud-cli@577.0.0-r1'],
        systemPackages: [],
      })
    ).toBe(createHash('sha256').update(canonical, 'utf-8').digest('hex'))
  })

  it('includes canonical system packages and the installer recipe revision in the hash', () => {
    const canonical = JSON.stringify({
      language: PY,
      dependencies: ['pandas'],
      systemPackages: ['curl', 'jq'],
      systemPackageRecipeRevision: SANDBOX_SYSTEM_PACKAGE_RECIPE_REVISION,
    })
    const expected = createHash('sha256').update(canonical, 'utf-8').digest('hex')
    expect(
      hashSandboxSpec({
        language: PY,
        dependencies: ['pandas'],
        cliTools: [],
        systemPackages: ['jq', 'curl', 'jq'],
      })
    ).toBe(expected)
    expect(canonicalizeSystemPackages(['jq', 'curl', 'jq'])).toEqual(['curl', 'jq'])
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

  it('quotes only validated system package coordinates', () => {
    expect(quoteSystemPackage('curl=7.88.1-10+deb12u8')).toBe("'curl=7.88.1-10+deb12u8'")
    expect(() => quoteSystemPackage('curl; whoami')).toThrow(/unvalidated system package/)
  })

  it('exact-resolves base names before a non-removing apt install', () => {
    const command = systemPackageInstallCommand(['libssl-dev:amd64', 'curl=7.88.1-10+deb12u8'])

    expect(command).toContain("for package in 'curl' 'libssl-dev'; do")
    expect(command).toContain('apt-cache pkgnames "$package" | grep -Fqx -- "$package"')
    expect(command).toContain(
      "apt-get install -y --no-install-recommends --no-remove -- 'curl=7.88.1-10+deb12u8' 'libssl-dev:amd64'"
    )
    expect(command).not.toContain("apt-cache pkgnames 'curl=7.88.1-10+deb12u8'")
    expect(command).not.toContain("apt-cache pkgnames 'libssl-dev:amd64'")
  })

  it('requires an exact repository name before apt can interpret a dotted name as a regex', () => {
    const command = systemPackageInstallCommand(['missing.package'])

    expect(command).toContain("for package in 'missing.package'; do")
    expect(command.indexOf('apt-cache pkgnames')).toBeLessThan(command.indexOf('apt-get install'))
    expect(command).toContain('exit 100')
  })
})

describe('manifest rendering', () => {
  it('renders a requirements.txt for python', () => {
    expect(
      renderDependencyManifest({
        language: PY,
        dependencies: ['requests', 'pandas'],
        cliTools: [],
        systemPackages: [],
      })
    ).toBe('pandas\nrequests\n')
  })

  it('renders a package.json dependency map for javascript', () => {
    const manifest = renderDependencyManifest({
      language: JS,
      dependencies: ['axios@^1.7.0', '@aws-sdk/client-s3', 'zod@3.23.8'],
      cliTools: [],
      systemPackages: [],
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
