import {
  resolveSessionPath,
  writeSessionSandboxFile,
} from '@/lib/execution/remote-sandbox/session-files'
import type { AgentCliRawResult, AgentCliSink } from '@/lib/mothership/generated/agent-cli'

/**
 * Lands stdout on the agent's machine (the chat's workbench sandbox) instead of
 * returning it through the model window — the other half of the file bridge. Only a
 * successful command's output is redirected, so an error stays visible inline.
 */
export async function applySink(
  sink: AgentCliSink,
  sessionKey: string | null,
  result: AgentCliRawResult,
  signal?: AbortSignal
): Promise<AgentCliRawResult> {
  if (result.exitCode !== 0 || signal?.aborted) return result
  if (!sessionKey) {
    return {
      ...result,
      stdout: `${result.stdout}\n[outputFile not written: no chat-scoped machine — output returned inline instead]`,
    }
  }
  const written = await writeSessionSandboxFile(sessionKey, sink.path, result.stdout, signal)
  if (written.outcome === 'written') {
    return {
      ...result,
      stdout: `[stdout written to ${resolveSessionPath(sink.path)} on your machine: ${result.stdout.length} chars. Read or process it with run_code, or pass it back as @${sink.path}.]`,
    }
  }
  return {
    ...result,
    stdout: `[Command succeeded; writing its output to ${sink.path} could not be confirmed. The output follows inline. Do not repeat a mutation to recover its output.]\n${result.stdout}`,
  }
}
