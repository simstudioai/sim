import crypto from 'crypto'
import { dump as yamlDump, load as yamlParse } from 'js-yaml'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { parseWorkflowYaml } from '@/stores/workflows/yaml/importer'

const logger = createLogger('WorkflowYamlDiffAPI')

// Request schema for YAML diff operations
const YamlDiffRequestSchema = z.object({
  original_yaml: z.string().min(1, 'Original YAML content is required'),
  agent_yaml: z.string().min(1, 'Agent YAML content is required'),
})

type YamlDiffRequest = z.infer<typeof YamlDiffRequestSchema>

/**
 * Clean up YAML by removing empty blocks programmatically
 */
function cleanupYamlContent(yamlContent: string): string {
  try {
    // Parse the YAML
    const workflow = yamlParse(yamlContent) as any

    if (!workflow || !workflow.blocks) {
      return yamlContent
    }

    // Filter out empty blocks
    const cleanedBlocks: Record<string, any> = {}
    Object.entries(workflow.blocks).forEach(([blockId, block]) => {
      // Only include blocks that have at least type and name
      if (
        block &&
        typeof block === 'object' &&
        (block as any).type &&
        (block as any).name &&
        Object.keys(block).length > 0
      ) {
        cleanedBlocks[blockId] = block
      } else {
        logger.info(`Filtering out empty block: ${blockId}`)
      }
    })

    // Rebuild the workflow with cleaned blocks
    const cleanedWorkflow = {
      ...workflow,
      blocks: cleanedBlocks,
    }

    // Convert back to YAML
    return yamlDump(cleanedWorkflow, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    })
  } catch (error) {
    logger.warn('Failed to clean YAML content, returning original', error)
    return yamlContent
  }
}

interface EdgeDiff {
  new_edges: string[]
  deleted_edges: string[]
  unchanged_edges: string[]
}

interface DiffResult {
  deleted_blocks: string[]
  edited_blocks: string[]
  new_blocks: string[]
  field_diffs?: Record<string, { changed_fields: string[]; unchanged_fields: string[] }>
  edge_diff?: EdgeDiff
}

interface BlockHash {
  blockId: string
  name: string
  hash: string
  inputs?: Record<string, any>
}

interface EdgeIdentity {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

/**
 * Generate a unique identifier for an edge based on block names (not IDs)
 * Must match the frontend logic which defaults sourceHandle to 'success'
 */
function generateEdgeIdentity(
  sourceName: string,
  targetName: string,
  sourceHandle?: string,
  targetHandle?: string
): string {
  // Match frontend logic: use 'success' as default when sourceHandle is undefined/null
  const effectiveSourceHandle = sourceHandle || 'success'
  return `${sourceName}:${effectiveSourceHandle}->${targetName}${targetHandle ? `:${targetHandle}` : ''}`
}

/**
 * Extract edges from YAML workflow connections using block names
 */
function extractEdges(yamlWorkflow: any): EdgeIdentity[] {
  const edges: EdgeIdentity[] = []

  if (!yamlWorkflow.blocks || typeof yamlWorkflow.blocks !== 'object') {
    return edges
  }

  // Create mapping from block ID to block name
  const blockIdToName = new Map<string, string>()
  Object.entries(yamlWorkflow.blocks).forEach(([blockId, block]: [string, any]) => {
    if (block && typeof block === 'object' && block.name) {
      blockIdToName.set(blockId, block.name)
    }
  })

  Object.entries(yamlWorkflow.blocks).forEach(([blockId, block]: [string, any]) => {
    if (!block || typeof block !== 'object' || !block.connections) {
      return
    }

    const sourceName = blockIdToName.get(blockId)
    if (!sourceName) return

    const connections = block.connections

    // Handle 'default' connections (simple format)
    if (connections.default) {
      const targets = Array.isArray(connections.default)
        ? connections.default
        : [connections.default]
      targets.forEach((targetId: string) => {
        const targetName = blockIdToName.get(targetId)
        if (!targetName) return

        const edgeId = generateEdgeIdentity(sourceName, targetName)
        edges.push({
          id: edgeId,
          source: sourceName,
          target: targetName,
        })
      })
    }

    // Handle named output connections
    Object.entries(connections).forEach(([outputName, targets]) => {
      if (outputName === 'default') return // Already handled

      const targetList = Array.isArray(targets) ? targets : [targets]
      targetList.forEach((target: any) => {
        if (typeof target === 'string') {
          const targetName = blockIdToName.get(target)
          if (!targetName) return

          const edgeId = generateEdgeIdentity(sourceName, targetName, outputName)
          edges.push({
            id: edgeId,
            source: sourceName,
            target: targetName,
            sourceHandle: outputName,
          })
        } else if (target && typeof target === 'object' && target.block) {
          const targetName = blockIdToName.get(target.block)
          if (!targetName) return

          const edgeId = generateEdgeIdentity(sourceName, targetName, outputName, target.input)
          edges.push({
            id: edgeId,
            source: sourceName,
            target: targetName,
            sourceHandle: outputName,
            targetHandle: target.input,
          })
        }
      })
    })
  })

  return edges
}

/**
 * Compare edges between two workflows to find differences
 */
function compareEdges(
  originalEdges: EdgeIdentity[],
  agentEdges: EdgeIdentity[],
  blockNameToHash: {
    originalNameToHash: Map<string, string>
    agentNameToHash: Map<string, string>
  },
  blockDiff: { new_blocks: string[]; deleted_blocks: string[]; edited_blocks: string[] }
): EdgeDiff {
  const result: EdgeDiff = {
    new_edges: [],
    deleted_edges: [],
    unchanged_edges: [],
  }

  // Create edge ID sets for comparison
  const originalEdgeIds = new Set(originalEdges.map((e) => e.id))
  const agentEdgeIds = new Set(agentEdges.map((e) => e.id))

  // Get block names that are new or deleted
  const newBlockNames = new Set<string>()
  const deletedBlockNames = new Set<string>()

  // Map block IDs to names for new/deleted blocks
  Array.from(blockNameToHash.originalNameToHash.entries()).forEach(([name, _]) => {
    const nameExistsInAgent = blockNameToHash.agentNameToHash.has(name)
    if (!nameExistsInAgent) {
      deletedBlockNames.add(name)
    }
  })

  Array.from(blockNameToHash.agentNameToHash.entries()).forEach(([name, _]) => {
    const nameExistsInOriginal = blockNameToHash.originalNameToHash.has(name)
    if (!nameExistsInOriginal) {
      newBlockNames.add(name)
    }
  })

  // Find deleted edges (in original but not in agent)
  originalEdges.forEach((edge) => {
    // An edge is deleted if:
    // 1. The edge doesn't exist in the agent workflow (was removed), OR
    // 2. Either its source or target block was deleted
    const edgeRemoved = !agentEdgeIds.has(edge.id)
    const sourceDeleted = deletedBlockNames.has(edge.source)
    const targetDeleted = deletedBlockNames.has(edge.target)

    if (edgeRemoved || sourceDeleted || targetDeleted) {
      result.deleted_edges.push(edge.id)
    }
  })

  // Find new and unchanged edges in agent workflow
  agentEdges.forEach((edge) => {
    const isNewEdge = !originalEdgeIds.has(edge.id)
    const connectsToNewBlock = newBlockNames.has(edge.source) || newBlockNames.has(edge.target)

    if (isNewEdge || connectsToNewBlock) {
      result.new_edges.push(edge.id)
    } else {
      result.unchanged_edges.push(edge.id)
    }
  })

  return result
}

/**
 * Compare two block inputs to find which fields changed
 */
function compareBlockInputs(
  originalInputs: Record<string, any>,
  agentInputs: Record<string, any>
): { changed_fields: string[]; unchanged_fields: string[] } {
  const changed_fields: string[] = []
  const unchanged_fields: string[] = []

  // Get all unique field names from both blocks
  const allFields = new Set([
    ...Object.keys(originalInputs || {}),
    ...Object.keys(agentInputs || {}),
  ])

  for (const field of allFields) {
    const originalValue = originalInputs?.[field]
    const agentValue = agentInputs?.[field]

    // Normalize values for comparison (handle null/undefined/empty string equivalence)
    const normalizeValue = (value: any) => {
      if (value === null || value === undefined || value === '') {
        return null
      }
      if (typeof value === 'object') {
        return JSON.stringify(value)
      }
      return String(value).trim()
    }

    const normalizedOriginal = normalizeValue(originalValue)
    const normalizedAgent = normalizeValue(agentValue)

    if (normalizedOriginal !== normalizedAgent) {
      changed_fields.push(field)
    } else {
      unchanged_fields.push(field)
    }
  }

  return { changed_fields, unchanged_fields }
}

/**
 * Create a hash of block contents excluding IDs, name, and connections
 */
function hashBlockContents(block: any): string {
  // Create a copy of the block to avoid mutating the original
  const blockCopy = JSON.parse(JSON.stringify(block))

  // Extract the properties we want to hash
  const hashableContent = {
    type: blockCopy.type,
    inputs: blockCopy.inputs || {},
    parentId: blockCopy.parentId || null,
  }

  // Debug: Log what content will be hashed
  console.log(`Hashing block content for ${block.name}:`, JSON.stringify(hashableContent, null, 2))

  // Remove any ID fields from inputs recursively
  function removeIds(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map(removeIds)
    }

    if (typeof obj === 'object') {
      const cleaned: any = {}
      for (const [key, value] of Object.entries(obj)) {
        // Skip only actual ID fields (not fields like "apiKey" that contain "id")
        if (
          key === 'id' ||
          key === 'blockId' ||
          key === 'targetId' ||
          key === 'sourceId' ||
          key.endsWith('Id') ||
          key.endsWith('_id')
        ) {
          continue
        }
        cleaned[key] = removeIds(value)
      }
      return cleaned
    }

    return obj
  }

  const cleanedContent = removeIds(hashableContent)

  // Debug: Log what content will actually be hashed after ID removal
  console.log(`Cleaned content for ${block.name}:`, JSON.stringify(cleanedContent, null, 2))

  // Create deterministic JSON string (sorted keys recursively)
  const sortObjectKeys = (obj: any): any => {
    if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj
    }

    const sorted: any = {}
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        sorted[key] = sortObjectKeys(obj[key])
      })
    return sorted
  }

  const sortedContent = sortObjectKeys(cleanedContent)

  // Hash the content
  const hash = crypto.createHash('sha256').update(JSON.stringify(sortedContent)).digest('hex')

  console.log(`Generated hash for ${block.name}: ${hash.substring(0, 8)}...`)

  return hash
}

/**
 * Extract block hashes from a parsed YAML workflow
 */
function extractBlockHashes(yamlWorkflow: any): BlockHash[] {
  const blockHashes: BlockHash[] = []

  if (!yamlWorkflow.blocks || typeof yamlWorkflow.blocks !== 'object') {
    return blockHashes
  }

  Object.entries(yamlWorkflow.blocks).forEach(([blockId, block]: [string, any]) => {
    if (!block || typeof block !== 'object') {
      return
    }

    const hash = hashBlockContents(block)
    blockHashes.push({
      blockId,
      name: block.name || '',
      hash,
      inputs: block.inputs || {},
    })
  })

  return blockHashes
}

/**
 * POST /api/workflows/diff
 * Compare two YAML workflow configurations and return diff analysis
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()

  try {
    // Parse and validate request
    const body = await request.json()
    const { original_yaml, agent_yaml } = YamlDiffRequestSchema.parse(body)

    logger.info(`[${requestId}] Processing YAML diff request`, {
      originalYamlLength: original_yaml.length,
      agentYamlLength: agent_yaml.length,
    })

    // Debug: Log the actual YAML content being compared
    logger.info(
      `[${requestId}] Original YAML content (first 500 chars):`,
      original_yaml.substring(0, 500)
    )
    logger.info(
      `[${requestId}] Agent YAML content (first 500 chars):`,
      agent_yaml.substring(0, 500)
    )

    // Clean up YAML to remove empty blocks
    const cleanedOriginalYaml = cleanupYamlContent(original_yaml)
    const cleanedAgentYaml = cleanupYamlContent(agent_yaml)

    logger.info(`[${requestId}] Cleaned YAML by removing empty blocks`)

    // Parse both YAML documents
    const { data: originalWorkflow, errors: originalErrors } =
      parseWorkflowYaml(cleanedOriginalYaml)
    const { data: agentWorkflow, errors: agentErrors } = parseWorkflowYaml(cleanedAgentYaml)

    // Check for parsing errors
    if (!originalWorkflow || originalErrors.length > 0) {
      logger.error(`[${requestId}] Original YAML parsing failed`, { originalErrors })
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to parse original YAML workflow',
          errors: originalErrors,
        },
        { status: 400 }
      )
    }

    if (!agentWorkflow || agentErrors.length > 0) {
      logger.error(`[${requestId}] Agent YAML parsing failed`, { agentErrors })
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to parse agent YAML workflow',
          errors: agentErrors,
        },
        { status: 400 }
      )
    }

    // Extract block hashes from both workflows
    const originalHashes = extractBlockHashes(originalWorkflow)
    const agentHashes = extractBlockHashes(agentWorkflow)

    logger.info(`[${requestId}] Extracted block hashes`, {
      originalBlockCount: originalHashes.length,
      agentBlockCount: agentHashes.length,
    })

    // Create hash sets for efficient lookup
    const originalHashSet = new Set(originalHashes.map((b) => b.hash))
    const agentHashSet = new Set(agentHashes.map((b) => b.hash))

    // Create name-to-hash mappings for edited block detection
    const originalNameToHash = new Map(originalHashes.map((b) => [b.name, b.hash]))
    const agentNameToHash = new Map(agentHashes.map((b) => [b.name, b.hash]))

    // Create name-to-blockId mappings
    const originalNameToId = new Map(originalHashes.map((b) => [b.name, b.blockId]))
    const agentNameToId = new Map(agentHashes.map((b) => [b.name, b.blockId]))

    // Create name-to-block mappings for field comparison
    const originalNameToBlock = new Map(originalHashes.map((b) => [b.name, b]))
    const agentNameToBlock = new Map(agentHashes.map((b) => [b.name, b]))

    // Analyze differences
    const result: DiffResult = {
      deleted_blocks: [],
      edited_blocks: [],
      new_blocks: [],
      field_diffs: {},
    }

    // Find deleted blocks: blocks in original that don't exist in agent (by name AND hash)
    for (const originalBlock of originalHashes) {
      const nameExistsInAgent = agentNameToHash.has(originalBlock.name)
      const hashExistsInAgent = agentHashSet.has(originalBlock.hash)

      if (!nameExistsInAgent && !hashExistsInAgent) {
        result.deleted_blocks.push(originalBlock.blockId)
      }
    }

    // Find edited and new blocks in agent workflow
    for (const agentBlock of agentHashes) {
      const nameExistsInOriginal = originalNameToHash.has(agentBlock.name)
      const hashExistsInOriginal = originalHashSet.has(agentBlock.hash)

      logger.info(`[${requestId}] Checking agent block: ${agentBlock.name}`, {
        nameExistsInOriginal,
        hashExistsInOriginal,
        agentHash: agentBlock.hash.substring(0, 8),
        originalHash: originalNameToHash.get(agentBlock.name)?.substring(0, 8) || 'none',
      })

      if (nameExistsInOriginal) {
        // Block name exists in original
        const originalHash = originalNameToHash.get(agentBlock.name)
        if (originalHash !== agentBlock.hash) {
          // Same name but different hash = edited block
          logger.info(`[${requestId}] Found edited block: ${agentBlock.name}`)
          result.edited_blocks.push(agentBlock.blockId)

          // Calculate field-level differences for this edited block
          const originalBlock = originalNameToBlock.get(agentBlock.name)
          if (originalBlock) {
            const fieldDiff = compareBlockInputs(
              originalBlock.inputs || {},
              agentBlock.inputs || {}
            )
            result.field_diffs![agentBlock.blockId] = fieldDiff

            logger.info(`[${requestId}] Field diff for ${agentBlock.name}:`, {
              changed_fields: fieldDiff.changed_fields,
              unchanged_fields: fieldDiff.unchanged_fields.length,
            })
          }
        }
        // If same name and same hash, it's unchanged (no action needed)
      } else if (!hashExistsInOriginal) {
        // Block name doesn't exist in original AND hash doesn't exist = new block
        logger.info(`[${requestId}] Found new block: ${agentBlock.name}`)
        result.new_blocks.push(agentBlock.blockId)
      }
      // If name doesn't exist but hash exists, it's a renamed block (treat as unchanged)
    }

    // Extract and compare edges
    const originalEdges = extractEdges(originalWorkflow)
    const agentEdges = extractEdges(agentWorkflow)

    logger.info(`[${requestId}] Extracted edges`, {
      originalEdgeCount: originalEdges.length,
      agentEdgeCount: agentEdges.length,
    })

    // Compare edges
    const edgeDiff = compareEdges(
      originalEdges,
      agentEdges,
      { originalNameToHash, agentNameToHash },
      result
    )
    result.edge_diff = edgeDiff

    logger.info(`[${requestId}] Edge diff analysis`, {
      newEdges: edgeDiff.new_edges.length,
      deletedEdges: edgeDiff.deleted_edges.length,
      unchangedEdges: edgeDiff.unchanged_edges.length,
    })

    const elapsed = Date.now() - startTime

    logger.info(`[${requestId}] YAML diff completed in ${elapsed}ms`, {
      deletedCount: result.deleted_blocks.length,
      editedCount: result.edited_blocks.length,
      newCount: result.new_blocks.length,
      fieldDiffsCount: Object.keys(result.field_diffs || {}).length,
      originalBlocks: originalHashes.map((h) => `${h.name}:${h.hash.substring(0, 8)}`),
      agentBlocks: agentHashes.map((h) => `${h.name}:${h.hash.substring(0, 8)}`),
      fieldDiffs: result.field_diffs,
    })

    return NextResponse.json({
      success: true,
      data: result,
      metadata: {
        original_block_count: originalHashes.length,
        agent_block_count: agentHashes.length,
        processing_time_ms: elapsed,
      },
    })
  } catch (error) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] YAML diff failed in ${elapsed}ms`, error)

    return NextResponse.json(
      {
        success: false,
        message: `Failed to process YAML diff: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
