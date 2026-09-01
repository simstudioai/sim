/**
 * Enforces direct dependency ownership, reviewed dependency-growth budgets,
 * and license policy without adding a second package-manager toolchain.
 */
import { builtinModules } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { parse } from '@babel/parser'
import { Glob } from 'bun'

interface PackageManifest {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface DependencyPolicy {
  expectedDependencyDeclarations: number
  expectedUniqueDependenciesPerManifest: number
  allowedCopyleftPackages: string[]
  allowedMissingLicensePackages: string[]
  ignoredImports: string[]
  runtimeProvidedPackages: string[]
}

interface Workspace {
  manifestPath: string
  root: string
  manifest: PackageManifest
  declared: Set<string>
  runtimeDeclared: Set<string>
}

interface ImportedSpecifier {
  specifier: string
  typeOnly: boolean
}

const ROOT = process.cwd()
const MANIFEST_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
])
const SCRIPT_BINARY_OWNERS = {
  artillery: 'artillery',
  biome: '@biomejs/biome',
  concurrently: 'concurrently',
  'drizzle-kit': 'drizzle-kit',
  electron: 'electron',
  'electron-builder': 'electron-builder',
  email: 'react-email',
  husky: 'husky',
  next: 'next',
  playwright: '@playwright/test',
  tsc: 'typescript',
  turbo: 'turbo',
  vitest: 'vitest',
} as const

const policy = (await Bun.file(join(ROOT, 'dependency-policy.json')).json()) as DependencyPolicy
const ignoredImports = new Set(policy.ignoredImports)
const runtimeProvidedPackages = new Set(policy.runtimeProvidedPackages)
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])

function packageNameFromSpecifier(specifier: string): string | null {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.startsWith('@/') ||
    specifier.startsWith('node:') ||
    builtins.has(specifier) ||
    ignoredImports.has(specifier)
  ) {
    return null
  }

  const [first, second] = specifier.split('/')
  return first.startsWith('@') && second ? `${first}/${second}` : first
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringLiteralValue(value: unknown): string | null {
  return isRecord(value) && value.type === 'StringLiteral' && typeof value.value === 'string'
    ? value.value
    : null
}

function importedSpecifiers(source: string): ImportedSpecifier[] {
  const ast = parse(source, {
    sourceType: 'unambiguous',
    errorRecovery: false,
    plugins: [
      'decorators-legacy',
      'explicitResourceManagement',
      'importAttributes',
      'jsx',
      'typescript',
    ],
  })
  const specifiers = new Map<string, boolean>()

  function addSpecifier(specifier: string, typeOnly: boolean): void {
    specifiers.set(specifier, (specifiers.get(specifier) ?? true) && typeOnly)
  }

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isRecord(value)) return

    if (
      value.type === 'ImportDeclaration' ||
      value.type === 'ExportAllDeclaration' ||
      value.type === 'ExportNamedDeclaration'
    ) {
      const specifier = stringLiteralValue(value.source)
      const childSpecifiers = Array.isArray(value.specifiers) ? value.specifiers : []
      const typeOnly =
        value.importKind === 'type' ||
        value.exportKind === 'type' ||
        (childSpecifiers.length > 0 &&
          childSpecifiers.every(
            (child) =>
              isRecord(child) && (child.importKind === 'type' || child.exportKind === 'type')
          ))
      if (specifier) addSpecifier(specifier, typeOnly)
    } else if (value.type === 'ImportExpression') {
      const specifier = stringLiteralValue(value.source)
      if (specifier) addSpecifier(specifier, false)
    } else if (value.type === 'TSImportType') {
      const specifier = stringLiteralValue(value.argument)
      if (specifier) addSpecifier(specifier, true)
    } else if (value.type === 'CallExpression' && Array.isArray(value.arguments)) {
      const firstArgument = stringLiteralValue(value.arguments[0])
      if (firstArgument && isRecord(value.callee)) {
        if (value.callee.type === 'Import') {
          addSpecifier(firstArgument, false)
        } else if (value.callee.type === 'Identifier' && value.callee.name === 'require') {
          addSpecifier(firstArgument, false)
        } else if (
          value.callee.type === 'MemberExpression' &&
          isRecord(value.callee.object) &&
          value.callee.object.type === 'Identifier' &&
          value.callee.object.name === 'require' &&
          isRecord(value.callee.property)
        ) {
          const property = value.callee.property
          if (property.type === 'Identifier' && property.name === 'resolve') {
            addSpecifier(firstArgument, false)
          }
        }
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key !== 'loc' && key !== 'start' && key !== 'end') visit(child)
    }
  }

  visit(ast)
  return [...specifiers].map(([specifier, typeOnly]) => ({ specifier, typeOnly }))
}

function manifestDependencies(manifest: PackageManifest): Set<string> {
  return new Set(MANIFEST_SECTIONS.flatMap((section) => Object.keys(manifest[section] ?? {})))
}

function runtimeManifestDependencies(manifest: PackageManifest): Set<string> {
  return new Set(
    ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((section) =>
      Object.keys(manifest[section as keyof PackageManifest] ?? {})
    )
  )
}

async function loadWorkspaces(): Promise<Workspace[]> {
  const manifestPaths = ['package.json']
  for (const pattern of ['apps/*/package.json', 'packages/*/package.json']) {
    for await (const path of new Glob(pattern).scan({ cwd: ROOT, onlyFiles: true })) {
      manifestPaths.push(path)
    }
  }

  return Promise.all(
    manifestPaths.sort().map(async (manifestPath) => {
      const manifest = (await Bun.file(join(ROOT, manifestPath)).json()) as PackageManifest
      return {
        manifestPath,
        root: manifestPath === 'package.json' ? ROOT : join(ROOT, dirname(manifestPath)),
        manifest,
        declared: manifestDependencies(manifest),
        runtimeDeclared: runtimeManifestDependencies(manifest),
      }
    })
  )
}

function isDevelopmentOnlyFile(workspace: Workspace, file: string): boolean {
  const path = relative(workspace.root, file).split(sep).join('/')
  const name = path.slice(path.lastIndexOf('/') + 1)
  return (
    path.startsWith('scripts/') ||
    path.includes('/__mocks__/') ||
    path.includes('/__tests__/') ||
    path.includes('/test/') ||
    path.includes('/fixtures/') ||
    /(?:^|\.)test\.[cm]?[jt]sx?$/.test(name) ||
    /(?:^|\.)spec\.[cm]?[jt]sx?$/.test(name) ||
    /(?:^|-)test-helpers?\.[cm]?[jt]sx?$/.test(name) ||
    /(?:^|\.)config\.[cm]?[jt]s$/.test(name) ||
    /^vitest\.setup\.[cm]?[jt]s$/.test(name)
  )
}

function isSourceFile(path: string): boolean {
  const extensionIndex = path.lastIndexOf('.')
  if (extensionIndex < 0 || !SOURCE_EXTENSIONS.has(path.slice(extensionIndex))) return false
  return !path.split(sep).some((part) => EXCLUDED_DIRECTORIES.has(part))
}

async function sourceFiles(workspace: Workspace): Promise<string[]> {
  const files: string[] = []
  if (workspace.manifestPath === 'package.json') {
    for await (const path of new Glob('scripts/**/*').scan({ cwd: ROOT, onlyFiles: true })) {
      if (isSourceFile(path)) files.push(join(ROOT, path))
    }
    for await (const path of new Glob('*').scan({ cwd: ROOT, onlyFiles: true })) {
      if (isSourceFile(path)) files.push(join(ROOT, path))
    }
    return files
  }

  for await (const path of new Glob('**/*').scan({ cwd: workspace.root, onlyFiles: true })) {
    if (isSourceFile(path)) files.push(join(workspace.root, path))
  }
  return files
}

async function checkDirectOwnership(workspaces: Workspace[]): Promise<string[]> {
  const errors: string[] = []
  const rootDependencies = workspaces.find(
    (workspace) => workspace.manifestPath === 'package.json'
  )!.declared
  for (const workspace of workspaces) {
    const missing = new Map<string, Set<string>>()
    for (const file of await sourceFiles(workspace)) {
      if (
        file.includes(`${sep}lib${sep}execution${sep}sandbox${sep}bundles${sep}`) &&
        file.endsWith('.cjs')
      ) {
        continue
      }
      const source = await Bun.file(file).text()
      let specifiers: ImportedSpecifier[]
      try {
        specifiers = importedSpecifiers(source)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`cannot parse ${relative(ROOT, file)}: ${message}`)
        continue
      }
      const declared = isDevelopmentOnlyFile(workspace, file)
        ? workspace.declared
        : workspace.runtimeDeclared
      for (const { specifier, typeOnly } of specifiers) {
        const dependency = packageNameFromSpecifier(specifier)
        const definitelyTypedPackage = dependency?.startsWith('@')
          ? `@types/${dependency.slice(1).replace('/', '__')}`
          : dependency
            ? `@types/${dependency}`
            : null
        if (
          !dependency ||
          dependency === workspace.manifest.name ||
          runtimeProvidedPackages.has(dependency) ||
          declared.has(dependency) ||
          (typeOnly && workspace.declared.has(dependency)) ||
          (typeOnly && definitelyTypedPackage && workspace.declared.has(definitelyTypedPackage))
        ) {
          continue
        }
        const locations = missing.get(dependency) ?? new Set<string>()
        locations.add(relative(ROOT, file))
        missing.set(dependency, locations)
      }
    }

    for (const [dependency, locations] of [...missing].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      errors.push(
        `${workspace.manifestPath} does not own imported package ${dependency} (${[...locations]
          .slice(0, 3)
          .join(', ')})`
      )
    }

    const missingScriptOwners = new Set<string>()
    for (const script of Object.values(workspace.manifest.scripts ?? {})) {
      for (const [binary, dependency] of Object.entries(SCRIPT_BINARY_OWNERS)) {
        const binaryPattern = new RegExp(`(^|[;&|\\s])${binary.replaceAll('-', '\\-')}(?=\\s|$)`)
        if (
          binaryPattern.test(script) &&
          !workspace.declared.has(dependency) &&
          !rootDependencies.has(dependency)
        ) {
          missingScriptOwners.add(`${binary}:${dependency}`)
        }
      }
    }
    for (const owner of missingScriptOwners) {
      const [binary, dependency] = owner.split(':')
      errors.push(`${workspace.manifestPath} uses ${binary} but does not own ${dependency}`)
    }
  }
  return errors
}

function checkDependencyGrowth(workspaces: Workspace[]): {
  declarations: number
  errors: string[]
  uniquePerManifest: number
} {
  let declarations = 0
  let uniquePerManifest = 0
  for (const workspace of workspaces) {
    uniquePerManifest += workspace.declared.size
    for (const section of MANIFEST_SECTIONS)
      declarations += Object.keys(workspace.manifest[section] ?? {}).length
  }

  const errors: string[] = []
  if (declarations !== policy.expectedDependencyDeclarations) {
    errors.push(
      `dependency declarations are ${declarations}; reviewed baseline is ${policy.expectedDependencyDeclarations}`
    )
  }
  if (uniquePerManifest !== policy.expectedUniqueDependenciesPerManifest) {
    errors.push(
      `per-manifest unique dependencies are ${uniquePerManifest}; reviewed baseline is ${policy.expectedUniqueDependenciesPerManifest}`
    )
  }
  return { declarations, errors, uniquePerManifest }
}

function matchesPackagePattern(name: string, pattern: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern
}

function isInstalledPackageManifest(path: string): boolean {
  const marker = `node_modules${sep}`
  const tail = path.slice(path.lastIndexOf(marker) + marker.length)
  const parts = tail.split(sep)
  return (
    parts.at(-1) === 'package.json' &&
    (parts[0].startsWith('@') ? parts.length === 3 : parts.length === 2)
  )
}

function hasStrongCopyleftOnly(license: string): boolean {
  const alternatives = license.replaceAll(/[()]/g, '').split(/\s+OR\s+/i)
  return alternatives.every((alternative) => /(?:^|[^L])(?:A?GPL|SSPL)-/i.test(alternative))
}

async function checkLicenses(): Promise<string[]> {
  const errors: string[] = []
  const inspected = new Set<string>()
  for await (const path of new Glob('node_modules/**/package.json').scan({
    cwd: ROOT,
    onlyFiles: true,
  })) {
    const absolutePath = join(ROOT, path)
    if (!isInstalledPackageManifest(absolutePath)) continue

    let manifest: PackageManifest & { version?: string; license?: string | { type?: string } }
    try {
      manifest = (await Bun.file(absolutePath).json()) as typeof manifest
    } catch {
      errors.push(`cannot parse installed manifest ${path}`)
      continue
    }

    if (!manifest.name) continue
    const identity = `${manifest.name}@${manifest.version ?? 'unknown'}`
    if (inspected.has(identity)) continue
    inspected.add(identity)

    const license =
      typeof manifest.license === 'string' ? manifest.license : manifest.license?.type?.trim()
    if (!license) {
      if (!policy.allowedMissingLicensePackages.includes(manifest.name)) {
        errors.push(`${identity} has no declared license`)
      }
      continue
    }

    if (license.startsWith('SEE LICENSE IN ')) {
      const licensePath = join(dirname(absolutePath), license.slice('SEE LICENSE IN '.length))
      if (!(await Bun.file(licensePath).exists()))
        errors.push(`${identity} references missing ${licensePath}`)
      continue
    }

    if (
      /LGPL/i.test(license) &&
      !policy.allowedCopyleftPackages.some((pattern) =>
        matchesPackagePattern(manifest.name!, pattern)
      )
    ) {
      errors.push(`${identity} uses ${license} without a reviewed copyleft exception`)
    } else if (hasStrongCopyleftOnly(license)) {
      errors.push(`${identity} uses disallowed license ${license}`)
    }
  }
  return errors
}

const workspaces = await loadWorkspaces()
const growth = checkDependencyGrowth(workspaces)
const errors = [
  ...(await checkDirectOwnership(workspaces)),
  ...growth.errors,
  ...(await checkLicenses()),
]

if (errors.length > 0) {
  console.error(`Dependency governance failed with ${errors.length} issue(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(
  `Dependency governance passed for ${workspaces.length} manifests, ${growth.declarations} declarations, and ${growth.uniquePerManifest} per-manifest unique dependencies.`
)
