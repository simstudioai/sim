#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { OPENAPI_SPEC_FILES } from '../apps/docs/lib/openapi-specs'
import { billingOpenApiDocument } from '../apps/sim/lib/api/contracts/v2/openapi/billing'
import { filesAuditOpenApiDocument } from '../apps/sim/lib/api/contracts/v2/openapi/files-audit'
import { knowledgeOpenApiDocument } from '../apps/sim/lib/api/contracts/v2/openapi/knowledge'
import { logsOpenApiDocument } from '../apps/sim/lib/api/contracts/v2/openapi/logs'
import { resourcesOpenApiDocument } from '../apps/sim/lib/api/contracts/v2/openapi/resources'
import { tablesOpenApiDocument } from '../apps/sim/lib/api/contracts/v2/openapi/tables'
import { workflowsOpenApiDocument } from '../apps/sim/lib/api/contracts/v2/openapi/workflows'
import { formatGeneratedSource } from './format-generated-source'
import { serializeOpenApiDocument } from './openapi/generator'

const ROOT = path.resolve(import.meta.dir, '..')
const DOCUMENTS = [
  workflowsOpenApiDocument,
  logsOpenApiDocument,
  filesAuditOpenApiDocument,
  tablesOpenApiDocument,
  knowledgeOpenApiDocument,
  billingOpenApiDocument,
  resourcesOpenApiDocument,
] as const

const generatedFiles = DOCUMENTS.map((document) => path.basename(document.output))
if (JSON.stringify(generatedFiles) !== JSON.stringify(OPENAPI_SPEC_FILES)) {
  throw new Error('OpenAPI generator documents do not match the Fumadocs specification manifest')
}

const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--check') || args.length > 1) {
  throw new Error('Usage: bun run generate:openapi [--check]')
}

const check = args[0] === '--check'
const stale: string[] = []

for (const definition of DOCUMENTS) {
  const outputPath = path.resolve(ROOT, definition.output)
  const relative = path.relative(ROOT, outputPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`OpenAPI output escapes the repository: ${definition.output}`)
  }

  const generated = formatGeneratedSource(serializeOpenApiDocument(definition), outputPath, ROOT)
  if (check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== generated) {
      stale.push(definition.output)
    }
    continue
  }
  writeFileSync(outputPath, generated)
}

if (stale.length > 0) {
  throw new Error(
    `Generated OpenAPI output is stale:\n${stale.map((file) => `  - ${file}`).join('\n')}\nRun bun run generate:openapi.`
  )
}

console.log(
  check
    ? `Generated OpenAPI output is current (${DOCUMENTS.length} documents).`
    : `Generated ${DOCUMENTS.length} OpenAPI documents.`
)
