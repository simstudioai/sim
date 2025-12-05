import { GitBranch, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

interface GenerateDiagramArgs {
  diagramText: string
  language?: 'mermaid'
}

/**
 * Client tool for rendering diagrams in the copilot chat.
 * This tool renders mermaid diagrams directly in the UI without server execution.
 */
export class GenerateDiagramClientTool extends BaseClientTool {
  static readonly id = 'generate_diagram'

  constructor(toolCallId: string) {
    super(toolCallId, GenerateDiagramClientTool.id, GenerateDiagramClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Designing workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Designing workflow', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Designing workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Designed workflow', icon: GitBranch },
      [ClientToolCallState.error]: { text: 'Failed to design workflow', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted designing workflow', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped designing workflow', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(args?: GenerateDiagramArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)

      const diagramText = args?.diagramText
      const language = args?.language || 'mermaid'

      if (!diagramText?.trim()) {
        await this.markToolComplete(400, 'No diagram text provided')
        this.setState(ClientToolCallState.error)
        return
      }

      // The actual rendering happens in the UI component (tool-call.tsx)
      // We just need to mark the tool as complete with the diagram data
      await this.markToolComplete(200, 'Diagram rendered successfully', {
        diagramText,
        language,
        rendered: true,
      })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
