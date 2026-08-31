import type { ListFilesResponse, ReadFileTextResponse } from 'sim/embed'
import {
  type AgentCliCommand,
  type AgentCliRuntime,
  agentCliFail,
  agentCliOk,
} from '@/lib/mothership/tools/handlers/agent-cli/types'

/**
 * Content grep across workspace files (the Go copilot's VFS-wide grep, files
 * half). Text extraction rides the v2 read-text endpoint, which already
 * handles binary/degraded files honestly, so this stays a pure projection.
 */

const MAX_MATCHES = 200
const MAX_FILES = 300
const MAX_BYTES_PER_FILE = 262_144
const READ_CONCURRENCY = 5
const CONTEXT_CHARS = 120

function compilePattern(raw: string): (value: string) => boolean {
  try {
    const regex = new RegExp(raw, 'i')
    return (value) => regex.test(value)
  } catch {
    const needle = raw.toLowerCase()
    return (value) => value.toLowerCase().includes(needle)
  }
}

function matchingLines(
  text: string,
  matches: (value: string) => boolean,
  label: string,
  out: string[]
): void {
  const lines = text.split('\n')
  for (let lineNo = 0; lineNo < lines.length && out.length < MAX_MATCHES; lineNo++) {
    const line = lines[lineNo]
    if (!matches(line)) continue
    const snippet = line.length > CONTEXT_CHARS ? `${line.slice(0, CONTEXT_CHARS)}…` : line
    out.push(`${label}:${lineNo + 1}: ${snippet.trim()}`)
  }
}

async function listAllFiles(runtime: AgentCliRuntime): Promise<ListFilesResponse['data']> {
  const rows: ListFilesResponse['data'] = []
  let cursor: string | null = null
  do {
    const page: ListFilesResponse = await runtime.client.request<ListFilesResponse>(
      '/api/v2/files',
      {
        query: { workspaceId: runtime.workspaceId, ...(cursor ? { cursor } : {}) },
      }
    )
    rows.push(...page.data)
    cursor = page.nextCursor
  } while (cursor && rows.length < MAX_FILES)
  return rows.slice(0, MAX_FILES)
}

export const filesGrepCommand: AgentCliCommand = {
  path: ['files', 'grep'],
  summary: 'Search the content of every workspace file for a pattern',
  usage: 'files grep <pattern> [folder-path-prefix]',
  async execute(rest, runtime) {
    const [pattern, folderPrefix] = [rest[0], rest[1]]
    if (!pattern) return agentCliFail('Usage: sim files grep <pattern> [folder-path-prefix]')
    const matches = compilePattern(pattern)
    const files = (await listAllFiles(runtime)).filter(
      (file) => !folderPrefix || file.folderPath.startsWith(folderPrefix)
    )
    const out: string[] = []
    let unreadable = 0
    for (let i = 0; i < files.length && out.length < MAX_MATCHES; i += READ_CONCURRENCY) {
      const batch = files.slice(i, i + READ_CONCURRENCY)
      const texts = await Promise.all(
        batch.map(async (file) => {
          try {
            const response = await runtime.client.request<ReadFileTextResponse>(
              `/api/v2/files/${encodeURIComponent(file.id)}/text`,
              { query: { workspaceId: runtime.workspaceId, maxBytes: String(MAX_BYTES_PER_FILE) } }
            )
            return { file, text: response.data.degraded ? null : response.data.text }
          } catch {
            // Binary or unreadable files must not sink the whole search.
            return { file, text: null }
          }
        })
      )
      for (const { file, text } of texts) {
        const label = file.folderPath ? `${file.folderPath}/${file.name}` : file.name
        if (matches(file.name) && out.length < MAX_MATCHES) out.push(`${label}: name matches`)
        if (text === null) {
          unreadable++
          continue
        }
        matchingLines(text, matches, label, out)
      }
    }
    if (out.length === 0) {
      return agentCliOk(
        unreadable > 0 ? `No matches (${unreadable} non-text files skipped).` : 'No matches.'
      )
    }
    const capped = out.length >= MAX_MATCHES ? [...out, `[capped at ${MAX_MATCHES} matches]`] : out
    return agentCliOk(capped.join('\n'))
  },
}
