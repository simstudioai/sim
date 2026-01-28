import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { normalizedStringify, normalizeWorkflowState } from './normalize'

/**
 * Compare the current workflow state with the deployed state to detect meaningful changes.
 * Uses the shared normalizeWorkflowState function to ensure consistency with snapshot hashing.
 *
 * @param currentState - The current workflow state
 * @param deployedState - The deployed workflow state
 * @returns True if there are meaningful changes, false if only position changes or no changes
 */
export function hasWorkflowChanged(
  currentState: WorkflowState,
  deployedState: WorkflowState | null
): boolean {
  // If no deployed state exists, then the workflow has changed
  if (!deployedState) return true

  const normalizedCurrent = normalizeWorkflowState(currentState)
  const normalizedDeployed = normalizeWorkflowState(deployedState)

  const currentStr = normalizedStringify(normalizedCurrent)
  const deployedStr = normalizedStringify(normalizedDeployed)

  if (currentStr !== deployedStr) {
    // Debug: Find what's different
    console.log('[hasWorkflowChanged] Detected differences:')

    // Compare edges
    if (
      normalizedStringify(normalizedCurrent.edges) !== normalizedStringify(normalizedDeployed.edges)
    ) {
      console.log('  - Edges differ')
      console.log('    Current:', JSON.stringify(normalizedCurrent.edges, null, 2))
      console.log('    Deployed:', JSON.stringify(normalizedDeployed.edges, null, 2))
    }

    // Compare blocks
    const currentBlockIds = Object.keys(normalizedCurrent.blocks).sort()
    const deployedBlockIds = Object.keys(normalizedDeployed.blocks).sort()

    if (normalizedStringify(currentBlockIds) !== normalizedStringify(deployedBlockIds)) {
      console.log('  - Block IDs differ')
      console.log('    Current:', currentBlockIds)
      console.log('    Deployed:', deployedBlockIds)
    } else {
      for (const blockId of currentBlockIds) {
        const currentBlock = normalizedCurrent.blocks[blockId]
        const deployedBlock = normalizedDeployed.blocks[blockId]

        if (normalizedStringify(currentBlock) !== normalizedStringify(deployedBlock)) {
          console.log(`  - Block "${blockId}" differs:`)

          // Compare subBlocks
          const currentSubBlockIds = Object.keys(currentBlock.subBlocks || {}).sort()
          const deployedSubBlockIds = Object.keys(deployedBlock.subBlocks || {}).sort()

          if (
            normalizedStringify(currentSubBlockIds) !== normalizedStringify(deployedSubBlockIds)
          ) {
            console.log('    SubBlock IDs differ:')
            console.log('      Current:', currentSubBlockIds)
            console.log('      Deployed:', deployedSubBlockIds)
          } else {
            for (const subBlockId of currentSubBlockIds) {
              const currentSub = currentBlock.subBlocks[subBlockId]
              const deployedSub = deployedBlock.subBlocks[subBlockId]

              if (normalizedStringify(currentSub) !== normalizedStringify(deployedSub)) {
                console.log(`    SubBlock "${subBlockId}" differs:`)
                console.log('      Current:', JSON.stringify(currentSub, null, 2))
                console.log('      Deployed:', JSON.stringify(deployedSub, null, 2))
              }
            }
          }

          // Compare block properties (excluding subBlocks)
          const { subBlocks: _cs, ...currentBlockRest } = currentBlock
          const { subBlocks: _ds, ...deployedBlockRest } = deployedBlock

          if (normalizedStringify(currentBlockRest) !== normalizedStringify(deployedBlockRest)) {
            console.log('    Block properties differ:')
            console.log('      Current:', JSON.stringify(currentBlockRest, null, 2))
            console.log('      Deployed:', JSON.stringify(deployedBlockRest, null, 2))
          }
        }
      }
    }

    // Compare loops
    if (
      normalizedStringify(normalizedCurrent.loops) !== normalizedStringify(normalizedDeployed.loops)
    ) {
      console.log('  - Loops differ')
      console.log('    Current:', JSON.stringify(normalizedCurrent.loops, null, 2))
      console.log('    Deployed:', JSON.stringify(normalizedDeployed.loops, null, 2))
    }

    // Compare parallels
    if (
      normalizedStringify(normalizedCurrent.parallels) !==
      normalizedStringify(normalizedDeployed.parallels)
    ) {
      console.log('  - Parallels differ')
      console.log('    Current:', JSON.stringify(normalizedCurrent.parallels, null, 2))
      console.log('    Deployed:', JSON.stringify(normalizedDeployed.parallels, null, 2))
    }

    // Compare variables
    if (
      normalizedStringify(normalizedCurrent.variables) !==
      normalizedStringify(normalizedDeployed.variables)
    ) {
      console.log('  - Variables differ')
      console.log('    Current:', JSON.stringify(normalizedCurrent.variables, null, 2))
      console.log('    Deployed:', JSON.stringify(normalizedDeployed.variables, null, 2))
    }

    return true
  }

  return false
}
