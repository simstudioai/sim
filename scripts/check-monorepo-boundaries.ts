#!/usr/bin/env bun
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from '@typescript/typescript6'

const ROOT = path.resolve(import.meta.dir, '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')

/** Package dependencies point toward shared code, including type-only imports. */
function forbiddenImport(file: string, specifier: string, appNames: ReadonlySet<string>): boolean {
  if (specifier.startsWith('@/') || specifier.startsWith('apps/')) return true
  for (const name of appNames) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return true
  }
  if (!specifier.startsWith('.')) return false
  const target = path.relative(ROOT, path.resolve(path.dirname(file), specifier))
  return target === 'apps' || target.startsWith(`apps${path.sep}`)
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage'])

async function walk(dir: string, results: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, results)
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) {
      results.push(full)
    }
  }
  return results
}

async function main() {
  const appNames = new Set<string>()
  for (const entry of await readdir(path.join(ROOT, 'apps'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const content = await readFile(
      path.join(ROOT, 'apps', entry.name, 'package.json'),
      'utf8'
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (content === null) continue
    const manifest = JSON.parse(content) as { name?: string }
    if (typeof manifest.name === 'string') appNames.add(manifest.name)
  }

  const packagesEntries = await readdir(PACKAGES_DIR, { withFileTypes: true })
  const packageDirs = packagesEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name))

  const offenders: Array<{ file: string; line: number; description: string; snippet: string }> = []

  for (const dir of packageDirs) {
    const files = await walk(dir)
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true)
      const lines = content.split('\n')
      function visit(node: ts.Node): void {
        let module: ts.Node | undefined
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          module = node.moduleSpecifier
        } else if (
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference)
        ) {
          module = node.moduleReference.expression
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
          module = node.argument.literal
        } else if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        ) {
          module = node.arguments[0]
        }
        if (
          module &&
          ts.isStringLiteralLike(module) &&
          forbiddenImport(file, module.text, appNames)
        ) {
          const { line } = source.getLineAndCharacterOfPosition(module.getStart(source))
          offenders.push({
            file: path.relative(ROOT, file),
            line: line + 1,
            description: `import into apps/: ${module.text}`,
            snippet: lines[line].trim(),
          })
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }

  if (offenders.length === 0) {
    console.log('✅ Monorepo boundaries OK: no package imports from apps/*')
    return
  }

  console.error('❌ Monorepo boundary violations found:')
  for (const offender of offenders) {
    console.error(
      `  ${offender.file}:${offender.line} — ${offender.description}\n    ${offender.snippet}`
    )
  }
  process.exit(1)
}

void main().catch((error) => {
  console.error('Monorepo boundary check failed:', error)
  process.exit(1)
})
