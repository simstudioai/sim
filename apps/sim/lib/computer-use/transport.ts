import type { ComputerUseInput, ComputerUseResult } from '@sim/desktop-bridge/computer-use'
import { ComputerUseResultSchema } from '@sim/desktop-bridge/computer-use'
import { getDesktopBridge } from '@/lib/desktop'

/** Desktop main independently authorizes the tool ID and executes only the server's canonical args. */
export async function executeComputerUseTool(
  toolCallId: string,
  input: ComputerUseInput,
  signal?: AbortSignal
): Promise<ComputerUseResult> {
  signal?.throwIfAborted()
  const bridge = getDesktopBridge()?.computerUse
  if (!bridge) throw new Error('Computer use requires the macOS desktop app')
  const status = await bridge.getStatus()
  signal?.throwIfAborted()
  if (!status.supported || !status.enabled)
    throw new Error('Enable Computer Use in Desktop settings first')
  return ComputerUseResultSchema.parse(await bridge.executeTool(toolCallId, input))
}

export async function cancelComputerUseTool(toolCallId?: string): Promise<void> {
  await getDesktopBridge()?.computerUse?.cancel(toolCallId)
}
