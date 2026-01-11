'use server'

/**
 * Format n8n workflow for Copilot migration
 * Provides workflow summary and clear instructions
 */
export async function formatMigrationRequest(n8nWorkflowJson: string): Promise<string> {
  try {
    // Validate JSON
    const parsed = JSON.parse(n8nWorkflowJson)
    
    // Extract workflow info for better context
    const nodeCount = parsed.nodes?.length || 0
    const nodeTypes = parsed.nodes?.map((n: any) => n.type).filter(Boolean).slice(0, 5).join(', ') || 'unknown'
    const workflowName = parsed.name || 'Unnamed workflow'
    
    // Concise, action-focused message
    return `Convert this n8n workflow (${nodeCount} nodes) to Sim blocks.

Workflow: "${workflowName}"
Nodes: ${nodeTypes}${nodeCount > 5 ? ', ...' : ''}

Create ALL ${nodeCount} blocks in ONE edit_workflow call, then autolayout.

N8n JSON:
\`\`\`json
${n8nWorkflowJson}
\`\`\`

Create all blocks using edit_workflow with 'add' operations.`
    
  } catch (error) {
    throw new Error(`Invalid n8n workflow JSON: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
