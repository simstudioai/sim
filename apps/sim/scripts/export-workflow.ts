#!/usr/bin/env bun

/**
 * Export workflow JSON from database
 * 
 * Usage:
 *   bun apps/sim/scripts/export-workflow.ts <workflow-id>
 * 
 * This script exports a workflow in the same format as the export API route.
 * It fetches the workflow state from normalized tables, combines it with metadata
 * and variables, sanitizes it, and outputs the JSON.
 * 
 * Make sure DATABASE_URL or POSTGRES_URL is set in your environment.
 */

// Suppress console logs from imported modules - only JSON should go to stdout
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
}
console.log = () => {}
console.warn = () => {}
console.error = () => {}

import { db, workflow } from '../../../packages/db/index.js'
import { eq } from 'drizzle-orm'
import { writeFileSync } from 'fs'
import { loadWorkflowFromNormalizedTables } from '../lib/workflows/db-helpers.js'
import { sanitizeForExport } from '../lib/workflows/json-sanitizer.js'

// ---------- CLI argument parsing ----------
const args = process.argv.slice(2)
const workflowId = args[0]
const outputFile = args[1] // Optional output filename

if (!workflowId) {
  process.stderr.write('Usage: bun apps/sim/scripts/export-workflow.ts <workflow-id> [output-file]\n')
  process.stderr.write('\n')
  process.stderr.write('Examples:\n')
  process.stderr.write('  bun apps/sim/scripts/export-workflow.ts abc123\n')
  process.stderr.write('  bun apps/sim/scripts/export-workflow.ts abc123 workflow.json\n')
  process.stderr.write('\n')
  process.stderr.write('Make sure DATABASE_URL or POSTGRES_URL is set in your environment.\n')
  process.exit(1)
}

// ---------- Main export function ----------
async function exportWorkflow(workflowId: string, outputFile?: string): Promise<void> {
  try {
    // Fetch workflow metadata
    const [workflowData] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData) {
      process.stderr.write(`Error: Workflow ${workflowId} not found\n`)
      process.exit(1)
    }

    // Load workflow from normalized tables
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

    if (!normalizedData) {
      process.stderr.write(`Error: Workflow ${workflowId} has no normalized data\n`)
      process.exit(1)
    }

    // Convert variables to array format
    let workflowVariables: any[] = []
    if (workflowData.variables && typeof workflowData.variables === 'object') {
      workflowVariables = Object.values(workflowData.variables).map((v: any) => ({
        id: v.id,
        name: v.name,
        type: v.type,
        value: v.value,
      }))
    }

    // Prepare export state - match the exact format from the UI
    const workflowState = {
      blocks: normalizedData.blocks,
      edges: normalizedData.edges,
      loops: normalizedData.loops,
      parallels: normalizedData.parallels,
      metadata: {
        name: workflowData.name,
        description: workflowData.description ?? undefined,
        color: workflowData.color ?? undefined,
        exportedAt: new Date().toISOString(),
      },
      variables: workflowVariables,
    }

    // Sanitize and export - this returns { version, exportedAt, state }
    const exportState = sanitizeForExport(workflowState)
    const jsonString = JSON.stringify(exportState, null, 2)

    // Write to file or stdout
    if (outputFile) {
      writeFileSync(outputFile, jsonString, 'utf-8')
      process.stderr.write(`Workflow exported to ${outputFile}\n`)
    } else {
      // Output the JSON to stdout only
      process.stdout.write(jsonString + '\n')
    }
  } catch (error) {
    process.stderr.write(`Error exporting workflow: ${error}\n`)
    process.exit(1)
  }
}

// ---------- Execute ----------
exportWorkflow(workflowId, outputFile)
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    process.stderr.write(`Unexpected error: ${error}\n`)
    process.exit(1)
  })

