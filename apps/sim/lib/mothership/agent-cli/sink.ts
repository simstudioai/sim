import { writeSessionSandboxFile } from '@/lib/execution/remote-sandbox/session-files'
import type { AgentCliRawResult, AgentCliSink } from '@/lib/mothership/generated/agent-cli'

/**
 * Lands stdout on the agent's machine (the chat's workbench sandbox) instead of
 * returning it through the model window — the other half of the file bridge. Only a
 * successful command's output is redirected, so an error stays visible inline.
 */
export async function applySink(
  sink: AgentCliSink,
  sessionKey: string | null,
  result: AgentCliRawResult
): Promise<AgentCliRawResult> {
  if (result.exitCode !== 0) return result
  if (!sessionKey) {
    return {
      ...result,
      stdout: `${result.stdout}\n[outputFile not written: no chat-scoped machine — output returned inline instead]`,
    }
  }
  const written = await writeSessionSandboxFile(sessionKey, sink.path, result.stdout)
  if (written.outcome === 'written') {
    return {
      ...result,
      stdout: `[stdout written to ${sink.path} on your machine: ${result.stdout.length} chars. Read or process it with run_code, or pass it back as @${sink.path}.]`,
    }
  }
  if (written.outcome === 'no-session') {
    return {
      ...result,
      stdout: `${result.stdout}\n[outputFile not written: your machine is not booted yet — run any run_code first. Output returned inline instead]`,
    }
  }
  return {
    ...result,
    stdout: `${result.stdout}\n[outputFile write failed — output returned inline instead]`,
  }
}
