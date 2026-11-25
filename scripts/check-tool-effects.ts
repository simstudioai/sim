#!/usr/bin/env bun
/**
 * Keeps every tool's declared `effect` consistent with its HTTP verb. Type-check already requires
 * every registered tool to declare `'read' | 'write'`.
 *
 * `effect` (`apps/sim/tools/types.ts` `ToolEffect`) is public catalog metadata: `read` promises
 * that running the tool changes nothing outside Sim, and Assistant applies its read policy to it.
 * A `write` mislabelled `read` is the one unsafe mistake, because whoever trusts the label runs a
 * real change. So this audit fails when:
 *
 *   - a tool's static HTTP verb contradicts its label: GET/HEAD labelled `write`, or
 *     PUT/PATCH/DELETE labelled `read`, or a `read` tool's function-valued verb can return
 *     PUT/PATCH/DELETE. Some are genuine (a GET that reads an event and then writes
 *     it back in `transformResponse` or `postProcess`), so the contradiction passes when the
 *     tool's `effect` property carries `// tool-effect: <reason>` on one of the two lines above it;
 *   - a `// tool-effect:` annotation sits on a tool whose verb agrees with its label, or on a
 *     definition whose id is not a string literal, so stale or unattributable justifications do
 *     not accumulate.
 *
 * POST, the rest of function-valued verbs, and in-process operations are not judged here: their
 * effect comes from the tool's documented semantics. The `add-tools` skill lists the rules.
 *
 * Every tool is already classified, so there is no baseline.
 *
 * Usage: bun run check:tool-effects
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareStrings } from '@sim/utils/string'
import ts from '@typescript/typescript6'
import { type ExecutableToolConfig, isInternalToolConfig } from '../apps/sim/tools/types'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TOOLS_DIR = path.join(ROOT, 'apps/sim/tools')
const ANNOTATION = '// tool-effect:'
const ANNOTATION_REACH = 2
const READ_VERBS = new Set(['GET', 'HEAD'])
const WRITE_VERBS = new Set(['PUT', 'PATCH', 'DELETE'])

export interface ToolEffectJustification {
  file: string
  line: number
  /** The `id` of the tool literal the annotated `effect` belongs to, when it is a string literal. */
  toolId?: string
}

export interface ToolEffectViolation {
  toolId: string
  reason: string
}

/** The `effect` properties in a source file that carry a `// tool-effect:` annotation. */
export function findToolEffectJustifications(
  file: string,
  source: string
): ToolEffectJustification[] {
  if (!source.includes(ANNOTATION)) return []
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const lines = source.split('\n')
  const found: ToolEffectJustification[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'effect' &&
      ts.isObjectLiteralExpression(node.parent)
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
      const annotated = lines
        .slice(Math.max(0, line - ANNOTATION_REACH), line)
        .some((text) => text.trim().startsWith(ANNOTATION))
      if (annotated) {
        const idProperty = node.parent.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'id'
        )
        const toolId =
          idProperty && ts.isStringLiteralLike(idProperty.initializer)
            ? idProperty.initializer.text
            : undefined
        found.push({ file, line: line + 1, toolId })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

const WRITE_VERB_LITERAL = /['"`](PUT|PATCH|DELETE)['"`]/i

function contradictsVerb(tool: ExecutableToolConfig): string | undefined {
  if (isInternalToolConfig(tool)) return undefined
  const method = tool.request.method
  if (typeof method === 'function') {
    if (tool.effect !== 'read') return undefined
    const verb = WRITE_VERB_LITERAL.exec(String(method))?.[1]
    return verb ? `${verb.toUpperCase()} from its function-valued method` : undefined
  }
  const verb = method.toUpperCase()
  if (tool.effect === 'write' && READ_VERBS.has(verb)) return verb
  if (tool.effect === 'read' && WRITE_VERBS.has(verb)) return verb
  return undefined
}

/** Every unjustified verb contradiction, and every stale or unattributable justification. */
export function findToolEffectViolations(
  tools: Record<string, ExecutableToolConfig>,
  justifications: readonly ToolEffectJustification[]
): ToolEffectViolation[] {
  const justified = new Set(justifications.map((entry) => entry.toolId))
  const violations: ToolEffectViolation[] = []

  for (const [toolId, tool] of Object.entries(tools)) {
    const { effect } = tool
    const verb = contradictsVerb(tool)
    if (verb && !justified.has(toolId)) {
      violations.push({
        toolId,
        reason: `sends ${verb} but declares effect '${effect}'; fix the label, or add \`${ANNOTATION} <reason>\` above it if the tool really ${effect === 'write' ? 'writes after the read' : 'reads through that verb'}`,
      })
    }
  }

  for (const justification of justifications) {
    const tool = justification.toolId ? tools[justification.toolId] : undefined
    if (!tool || !contradictsVerb(tool)) {
      violations.push({
        toolId: justification.toolId ?? `${justification.file}:${justification.line}`,
        reason: tool
          ? `has a ${ANNOTATION} annotation but its verb agrees with its effect; remove it`
          : `${ANNOTATION} annotation is not on the effect of a registered tool with a literal id`,
      })
    }
  }

  return violations.sort((a, b) => compareStrings(a.toolId, b.toolId))
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'generated' && entry.name !== 'node_modules') yield* walk(full)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield full
    }
  }
}

async function main() {
  const { tools } = await import('../apps/sim/tools/registry')
  const justifications: ToolEffectJustification[] = []
  for (const file of walk(TOOLS_DIR)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    justifications.push(...findToolEffectJustifications(rel, readFileSync(file, 'utf8')))
  }

  const violations = findToolEffectViolations(tools, justifications)
  const total = Object.keys(tools).length
  if (violations.length === 0) {
    const reads = Object.values(tools).filter((tool) => tool.effect === 'read').length
    console.log(
      `✓ check-tool-effects: ${total} tools declare an effect (${reads} read, ${total - reads} write), ${justifications.length} justified verb exceptions`
    )
    return
  }

  console.error('✗ check-tool-effects\n')
  for (const { toolId, reason } of violations) console.error(`    ${toolId} — ${reason}`)
  console.error(
    '\n  Classify by the rules in .agents/skills/add-tools/SKILL.md → Declaring the effect.\n' +
      '  When unsure, declare `write`.\n'
  )
  process.exit(1)
}

if (import.meta.main) await main()
