#!/usr/bin/env bun
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

const TARGET_DIRS = [
  'apps/sim',
  'apps/realtime/src',
  'packages/realtime-protocol/src',
  'packages/db',
] as const

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist'])

interface Rule {
  id: string
  description: string
  pattern: RegExp
  severity: 'error' | 'warning'
  requiresZodImport?: boolean
}

interface Finding {
  rule: Rule
  file: string
  line: number
  snippet: string
}

const RULES: Rule[] = [
  {
    id: 'zod-error-errors',
    description: 'ZodError.errors was removed in Zod v4; use .issues and serialize intentionally.',
    pattern:
      /\b(?:error|err|validation|validationResult|parseResult|parsed|bodyValidation|validationError)\.errors\b|\.error\.errors\b/,
    severity: 'error',
    requiresZodImport: true,
  },
  {
    id: 'zod-error-format',
    description: 'ZodError.format() is deprecated in Zod v4; use a central formatter helper.',
    pattern: /\.error\.format\(\)|\b(?:error|err)\.format\(\)/,
    severity: 'error',
    requiresZodImport: true,
  },
  {
    id: 'zod-error-flatten',
    description: 'ZodError.flatten() is deprecated in Zod v4; use a central formatter helper.',
    pattern: /\.error\.flatten\(\)|\b(?:error|err)\.flatten\(\)/,
    severity: 'error',
    requiresZodImport: true,
  },
  {
    id: 'zod-required-error',
    description: 'required_error was removed in Zod v4; use the unified error option.',
    pattern: /\brequired_error\s*:/,
    severity: 'error',
    requiresZodImport: true,
  },
  {
    id: 'zod-invalid-type-error',
    description: 'invalid_type_error was removed in Zod v4; use the unified error option.',
    pattern: /\binvalid_type_error\s*:/,
    severity: 'error',
    requiresZodImport: true,
  },
  {
    id: 'zod-error-map',
    description: 'errorMap was replaced by the unified error option in Zod v4.',
    pattern: /\berrorMap\s*:/,
    severity: 'error',
    requiresZodImport: true,
  },
  {
    id: 'generic-fetch-json',
    description: 'Generic-only fetchJson<T> is not runtime safe; use schema-validated clients.',
    pattern: /\bfetchJson<[^>]+>\(/,
    severity: 'warning',
  },
  {
    id: 'typed-request-json-cast',
    description: 'Do not type-assert request.json() at trust boundaries; parse unknown with Zod.',
    pattern:
      /await\s+(?:request|req)\.json\(\)\s+as\b|\(\s*await\s+(?:request|req)\.json\(\)\s*\)\s+as\b|const\s+\w+\s*:\s*[^=]+=\s*await\s+(?:request|req)\.json\(\)/,
    severity: 'warning',
  },
  {
    id: 'double-assertion',
    description: 'Double assertions hide type gaps; quarantine unavoidable adapter casts.',
    pattern: /\bas\s+unknown\s+as\b/,
    severity: 'warning',
  },
]

function importsZod(content: string): boolean {
  return /\bfrom\s+['"]zod['"]/.test(content) || /\brequire\(['"]zod['"]\)/.test(content)
}

async function walk(dir: string, results: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(fullPath, results)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath)
    }
  }

  return results
}

function findSingleArgZodRecords(content: string): Array<{ line: number; snippet: string }> {
  const findings: Array<{ line: number; snippet: string }> = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const recordIndex = line.indexOf('z.record(')
    if (recordIndex === -1) continue

    const afterRecord = line.slice(recordIndex + 'z.record('.length)
    if (afterRecord.includes(',')) continue

    findings.push({ line: i + 1, snippet: line.trim() })
  }

  return findings
}

function lineNumberForIndex(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line += 1
  }
  return line
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const files: string[] = []

  for (const target of TARGET_DIRS) {
    await walk(path.join(ROOT, target), files)
  }

  const findings: Finding[] = []
  const recordRule: Rule = {
    id: 'zod-record-arity',
    description: 'Zod v4 requires z.record(keySchema, valueSchema) for plain records.',
    pattern: /z\.record\(/,
    severity: 'error',
  }

  for (const file of files) {
    const content = await readFile(file, 'utf8')
    const relative = path.relative(ROOT, file)
    const hasZodImport = importsZod(content)

    for (const rule of RULES) {
      if (rule.requiresZodImport && !hasZodImport) continue

      rule.pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = rule.pattern.exec(content))) {
        const line = lineNumberForIndex(content, match.index)
        const snippet = content.split('\n')[line - 1]?.trim() ?? ''
        findings.push({ rule, file: relative, line, snippet })
        if (!rule.pattern.global) break
      }
    }

    if (hasZodImport) {
      for (const recordFinding of findSingleArgZodRecords(content)) {
        findings.push({
          rule: recordRule,
          file: relative,
          line: recordFinding.line,
          snippet: recordFinding.snippet,
        })
      }
    }
  }

  const errors = findings.filter((finding) => finding.rule.severity === 'error')
  const warnings = findings.filter((finding) => finding.rule.severity === 'warning')

  console.log(`Zod v4 readiness findings: ${errors.length} errors, ${warnings.length} warnings`)

  const byRule = new Map<string, number>()
  for (const finding of findings) {
    byRule.set(finding.rule.id, (byRule.get(finding.rule.id) ?? 0) + 1)
  }
  for (const [ruleId, count] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${ruleId}: ${count}`)
  }

  if (findings.length > 0) {
    console.log('\nFirst findings:')
    for (const finding of findings.slice(0, 100)) {
      console.log(
        `  ${finding.rule.severity.toUpperCase()} ${finding.rule.id} ${finding.file}:${finding.line}\n    ${finding.snippet}`
      )
    }
    if (findings.length > 100) {
      console.log(`  ... ${findings.length - 100} more`)
    }
  }

  if (checkOnly && errors.length > 0) {
    process.exit(1)
  }
}

void main().catch((error) => {
  console.error('Zod v4 readiness check failed:', error)
  process.exit(1)
})
