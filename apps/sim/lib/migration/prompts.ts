/**
 * Generate optimized migration system prompt for Copilot
 * Minimal, context-aware prompt that leverages Copilot's existing knowledge
 */
export function getMigrationSystemPrompt(): string {
  return `Convert n8n workflow to Sim efficiently: analyze the workflow, create ALL blocks at once, then autolayout.

**Block Mappings**:
- HTTP/API → "api"
- Webhook → "webhook_trigger"
- Code → "function"
- Schedule → "schedule" 
- Manual → "manual_trigger"
- Variables → "variables"
- Conditions → "condition" or "router"

**Efficient Process**:
1. Analyze all n8n nodes and map to Sim block types
2. Query get_block_config for any unclear block types
3. Create ALL blocks in ONE edit_workflow call with multiple 'add' operations:
   - Set triggerMode: true for first/trigger nodes
   - Use rough positions (x: 100, y: 100 + index*200)
   - Map all parameters from n8n to Sim subBlocks
   - Heights: triggers=172, functions=143, others=127
4. After all blocks created, call the autolayout tool to organize positions

**Important**: Create ALL blocks in a SINGLE edit_workflow call, not incrementally. Then autolayout for clean positioning.`
}
