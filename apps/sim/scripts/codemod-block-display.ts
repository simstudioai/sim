// @ts-nocheck — one-time codemod run via a scratch `bun add ts-morph` (ts-morph is intentionally
// not a project dependency). Splits each blocks/blocks/<name>.ts into a <name>.display.ts + spread.
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { Node, type ObjectLiteralExpression, Project } from 'ts-morph'

const APP = process.cwd()
const BLOCK_DIR = path.join(APP, 'blocks/blocks')
const DISPLAY_KEYS = [
  'type',
  'name',
  'description',
  'category',
  'bgColor',
  'icon',
  'iconColor',
  'longDescription',
  'docsLink',
  'integrationType',
  'hideFromToolbar',
  'triggerAllowed',
]

const onlyArg = process.argv[2] // optional single-file test

const project = new Project({
  tsConfigFilePath: path.join(APP, 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
})

function isBlockConfigConst(init: Node | undefined): init is ObjectLiteralExpression {
  if (!init || !Node.isObjectLiteralExpression(init)) return false
  const hasType = init.getProperty('type')
  const hasHeavy = init.getProperty('subBlocks') || init.getProperty('tools')
  return Boolean(hasType && hasHeavy)
}

/** Collect identifier names referenced in a node (for import resolution). */
function referencedIdents(node: Node): Set<string> {
  const out = new Set<string>()
  node.forEachDescendant((d) => {
    if (Node.isIdentifier(d)) out.add(d.getText())
  })
  return out
}

interface DisplayBlock {
  constName: string
  obj: ObjectLiteralExpression
  props: { name: string; text: string }[] // full property text (e.g. "icon: SlackIcon")
  baseConst?: string // same-file block const this variant spreads (inherits display from)
}

const results: { file: string; status: string; note?: string }[] = []

const files = readdirSync(BLOCK_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.display.ts'))
  .filter((f) => (onlyArg ? f === onlyArg : true))

for (const file of files) {
  const base = file.replace(/\.ts$/, '')
  const sf = project.addSourceFileAtPath(path.join(BLOCK_DIR, file))
  try {
    const blocks: DisplayBlock[] = []
    for (const vs of sf.getVariableStatements()) {
      if (!vs.isExported()) continue
      for (const decl of vs.getDeclarations()) {
        const init = decl.getInitializer()
        if (!isBlockConfigConst(init)) continue
        const props: { name: string; text: string }[] = []
        for (const key of DISPLAY_KEYS) {
          const p = init.getProperty(key)
          if (p && Node.isPropertyAssignment(p)) props.push({ name: key, text: p.getText() })
        }
        if (props.length === 0) continue
        blocks.push({ constName: decl.getName(), obj: init, props })
      }
    }
    if (blocks.length === 0) {
      results.push({ file, status: 'skip', note: 'no BlockConfig const' })
      project.removeSourceFile(sf)
      continue
    }

    // Detect base-block spreads (variant blocks inherit display from a same-file base)
    const blockConstNames = new Set(blocks.map((b) => b.constName))
    for (const b of blocks) {
      for (const prop of b.obj.getProperties()) {
        if (Node.isSpreadAssignment(prop)) {
          const expr = prop.getExpression().getText()
          if (blockConstNames.has(expr) && expr !== b.constName) {
            b.baseConst = expr
            break
          }
        }
      }
    }

    // Gather identifiers used across all extracted props (icon + IntegrationType)
    const usedIdents = new Set<string>()
    for (const b of blocks)
      for (const p of b.props) {
        const pa = b.obj.getProperty(p.name)
        if (pa) for (const id of referencedIdents(pa)) usedIdents.add(id)
      }

    // Resolve each used identifier to an import or a local declaration
    const importByModule = new Map<string, Set<string>>() // module -> named imports
    const localDecls: string[] = [] // full text of local const decls to copy
    const localDeclImportIdents = new Set<string>()
    for (const id of usedIdents) {
      const imp = sf
        .getImportDeclarations()
        .find((d) =>
          d.getNamedImports().some((n) => (n.getAliasNode()?.getText() ?? n.getName()) === id)
        )
      if (imp) {
        const mod = imp.getModuleSpecifierValue()
        if (!importByModule.has(mod)) importByModule.set(mod, new Set())
        importByModule.get(mod)!.add(id)
        continue
      }
      // local var decl (e.g. trigger icon const)
      const localVar = sf
        .getVariableStatements()
        .find((vs) => vs.getDeclarations().some((d) => d.getName() === id))
      if (localVar) {
        localDecls.push(localVar.getText().replace(/^export\s+/, ''))
        for (const ld of referencedIdents(localVar)) localDeclImportIdents.add(ld)
      }
    }
    // imports needed by copied local decls (createElement, lucide bases, SVGProps type)
    for (const id of localDeclImportIdents) {
      const imp = sf
        .getImportDeclarations()
        .find((d) =>
          d.getNamedImports().some((n) => (n.getAliasNode()?.getText() ?? n.getName()) === id)
        )
      if (imp) {
        const mod = imp.getModuleSpecifierValue()
        if (!importByModule.has(mod)) importByModule.set(mod, new Set())
        importByModule.get(mod)!.add(id)
      }
    }
    // SVGProps is a type import in trigger files
    if (localDecls.some((d) => d.includes('SVGProps'))) {
      if (!importByModule.has('react')) importByModule.set('react', new Set())
    }

    // Build .display.ts
    const usesIntegrationType = usedIdents.has('IntegrationType')
    const lines: string[] = []
    // react type import for SVGProps (trigger icons) — emit as a separate type import
    const needsSvgProps = localDecls.some((d) => d.includes('SVGProps'))
    if (needsSvgProps) lines.push("import type { SVGProps } from 'react'")
    // value imports grouped by module (sorted)
    for (const [mod, names] of [...importByModule].sort(([a], [b]) => a.localeCompare(b))) {
      const filtered = [...names].filter((n) => n !== 'SVGProps' && n !== 'IntegrationType')
      if (filtered.length === 0) continue
      lines.push(`import { ${filtered.sort().join(', ')} } from '${mod}'`)
    }
    lines.push("import type { BlockDisplay } from '@/blocks/manifest'")
    if (usesIntegrationType) lines.push("import { IntegrationType } from '@/blocks/types'")
    lines.push('')
    for (const d of localDecls) lines.push(d, '')
    for (const b of blocks) {
      lines.push(
        `export const ${b.constName}Display = {`,
        ...(b.baseConst ? [`  ...${b.baseConst}Display,`] : []),
        ...b.props.map((p) => `  ${p.text},`),
        `} satisfies BlockDisplay`,
        ''
      )
    }
    const displayPath = path.join(BLOCK_DIR, `${base}.display.ts`)
    project.createSourceFile(displayPath, lines.join('\n'), { overwrite: true })

    // Rewrite block.ts: remove extracted props, add the Display spread (after the
    // base-block spread for variants, so the variant's display overrides win; else at 0)
    for (const b of blocks) {
      for (const p of b.props) {
        const pa = b.obj.getProperty(p.name)
        pa?.remove()
      }
      let insertIdx = 0
      if (b.baseConst) {
        const after = b.obj
          .getProperties()
          .findIndex(
            (p) => Node.isSpreadAssignment(p) && p.getExpression().getText() === b.baseConst
          )
        if (after >= 0) insertIdx = after + 1
      }
      b.obj.insertSpreadAssignment(insertIdx, { expression: `${b.constName}Display` })
    }
    sf.insertImportDeclaration(0, {
      namedImports: blocks.map((b) => `${b.constName}Display`),
      moduleSpecifier: `@/blocks/blocks/${base}.display`,
    })

    results.push({ file, status: 'ok', note: `${blocks.length} block(s)` })
  } catch (e) {
    results.push({ file, status: 'ERROR', note: String(e).slice(0, 120) })
  }
}

project.saveSync()

const ok = results.filter((r) => r.status === 'ok')
const err = results.filter((r) => r.status === 'ERROR')
const skip = results.filter((r) => r.status === 'skip')
console.log(`ok=${ok.length} skip=${skip.length} err=${err.length}`)
for (const r of [...err, ...skip]) console.log(`  ${r.status} ${r.file} — ${r.note}`)
