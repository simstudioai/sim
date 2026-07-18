import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { validateSourceCaps } from '@/lib/apps/build/e2b-app-build'
import { isAllowedUserPath } from '@/lib/apps/build/prepare-source'
import type { BackendHandoff } from '@/lib/apps/demo/backend-handoff'
import { runDemoFrontendPass } from '@/lib/apps/demo/headless-mothership'
import { APP_TEMPLATE_FILES } from '@/lib/apps/template/versions'

const logger = createLogger('FullstackDemoFrontendGenerator')

const FRONTEND_RESPONSE_SCHEMA = `{
  "files": [
    { "path": "src/App.tsx", "content": "..." }
  ]
}`

const MAX_DIAGNOSTIC_CHARS = 4_000

export type GeneratedFrontend = {
  files: Record<string, string>
  source: 'hosted' | 'fallback'
  repairAttempted?: boolean
}

const MAX_SOURCE_CHARS = 80_000

function serializeHandoffActions(handoff: BackendHandoff): string {
  return JSON.stringify(
    handoff.actions.map((action) => ({
      actionId: action.actionId,
      workflowName: action.workflowName,
      description: action.description,
      inputSchema: action.inputSchema,
      outputAllowlist: action.outputAllowlist.map((o) => ({
        key: o.key,
        blockId: o.blockId,
        path: o.path,
        schema: o.schema,
      })),
    })),
    null,
    2
  )
}

function buildFrontendPrompt(
  prompt: string,
  handoff: BackendHandoff,
  repairDiagnostics?: string,
  currentFiles?: Record<string, string>
): string {
  const actionsJson = serializeHandoffActions(handoff)
  const isEdit = Boolean(currentFiles && Object.keys(currentFiles).length > 0)

  const lines = [
    isEdit
      ? 'You are editing an existing Vite + React + TypeScript frontend for a Sim Full-stack App.'
      : 'You are generating a Vite + React + TypeScript frontend for a Sim Full-stack App.',
    'This is a STATELESS, TOOL-LESS request. Respond with ONLY valid JSON matching this schema (no markdown fences):',
    FRONTEND_RESPONSE_SCHEMA,
    '',
    'Rules:',
    '- Only include user-editable files under src/** or public/** (tsx/ts/jsx/js/css/json/svg/etc).',
    '- Do NOT include package.json, vite.config, index.html, or src/sim.generated.ts (platform-owned).',
    '- You MUST provide src/App.tsx and it MUST export a named React component called App (for example: export function App() { ... }). Do not use only a default export.',
    '- Import generated action wrappers from "./sim.generated" OR call sim.run(actionId, input) via createSimClientFromWindow from @sim/app-sdk.',
    '- Never call raw workflow URLs or invent deployment endpoints.',
    '- Never include OAuth credential IDs, API keys, secrets, or credential selector fields in the UI or source.',
    '- Never use external image/media CDN URLs. File/image outputs arrive as same-origin objects shaped like { url, name, mimeType, size }; render them with <img src={file.url} /> (url is already same-origin).',
    '- Write real Unicode characters in JSX/text (e.g. →). Never emit escaped sequences like \\u2192 in display text.',
    '- Expose every backend action below with a clear UI control tailored to the user prompt.',
    '- Render controls from the typed input schema: enum values as selects, booleans as checkboxes, numbers as numeric inputs, and descriptions as labels/help text. Never expose raw provider configuration controls.',
    '- Recursively render structured outputs. If an output is a JSON-encoded string, parse it before display. Render errors as readable messages rather than quoted JSON.',
    isEdit
      ? '- Apply the latest instruction to the provided current files. Return the FULL updated file set for every user-editable file you keep (not a partial patch).'
      : '- Prefer a polished single-page UI that matches the prompt.',
    '',
    `User prompt:\n${prompt}`,
    '',
    `Backend actions (credential-free typed handoff):\n${actionsJson}`,
  ]

  if (isEdit && currentFiles) {
    const sourceJson = JSON.stringify(currentFiles, null, 2)
    if (sourceJson.length > MAX_SOURCE_CHARS) {
      throw new Error(
        `Current App source exceeds the ${MAX_SOURCE_CHARS}-character isolated edit limit`
      )
    }
    lines.push(
      '',
      'Current user-editable source files (authoritative; do not rely on memory):',
      sourceJson
    )
  }

  if (repairDiagnostics) {
    lines.push(
      '',
      'Previous generation failed validation/build. Fix ONLY the reported issues and return a complete corrected files array:',
      repairDiagnostics.slice(0, MAX_DIAGNOSTIC_CHARS)
    )
  }

  return lines.join('\n')
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch?.[1]?.trim() || trimmed

  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

export function validateGeneratedFiles(
  files: Array<{ path: string; content: string }>
): { ok: true; files: Record<string, string> } | { ok: false; error: string } {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, error: 'No files returned' }
  }

  const out: Record<string, string> = {}
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      return { ok: false, error: 'Invalid file entry' }
    }
    if (!isAllowedUserPath(file.path)) {
      return {
        ok: false,
        error: `Unsupported path: ${file.path}. Only src/** and public/** are allowed.`,
      }
    }
    out[file.path] = file.content
  }

  const appSource = out['src/App.tsx']
  if (!appSource) {
    return { ok: false, error: 'Generated frontend must include src/App.tsx' }
  }
  const hasNamedAppExport =
    /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+App\b/.test(appSource) ||
    /\bexport\s*\{[^}]*\bApp\b[^}]*\}/s.test(appSource)
  if (!hasNamedAppExport) {
    return {
      ok: false,
      error: 'src/App.tsx must export a named React component called App',
    }
  }

  // Merge onto template so required scaffold files exist for the build worker.
  // Platform regenerates sim.generated.ts; drop any model-authored copy.
  const { 'src/sim.generated.ts': _ignored, ...userFiles } = out
  const merged = {
    ...APP_TEMPLATE_FILES,
    ...userFiles,
    'src/sim.generated.ts': APP_TEMPLATE_FILES['src/sim.generated.ts']!,
  }

  const caps = validateSourceCaps(merged)
  if (!caps.ok) return caps
  return { ok: true, files: merged }
}

export function mergeCurrentFrontendFiles(
  currentFiles: Record<string, string>,
  returnedFiles: Array<{ path: string; content: string }>
): ReturnType<typeof validateGeneratedFiles> {
  const merged = new Map(Object.entries(currentFiles))
  for (const file of returnedFiles) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      return { ok: false, error: 'Invalid file entry' }
    }
    merged.set(file.path, file.content)
  }
  return validateGeneratedFiles([...merged.entries()].map(([path, content]) => ({ path, content })))
}

function escapeForJsxText(value: string): string {
  return value.replace(/`/g, "'").replace(/\$/g, '').replace(/\\/g, '')
}

export function buildFallbackFrontend(handoff: BackendHandoff, prompt: string): GeneratedFrontend {
  const actionButtons = handoff.actions.map((action, index) => {
    const props = (action.inputSchema.properties || {}) as Record<string, unknown>
    const fields = Object.keys(props)
    const fieldState = fields
      .map((name) => {
        const schema =
          props[name] && typeof props[name] === 'object'
            ? (props[name] as Record<string, unknown>)
            : {}
        return `    ${JSON.stringify(name)}: ${schema.type === 'boolean' ? 'false' : "''"}`
      })
      .join(',\n')
    const inputs = fields
      .map((name) => {
        const schema =
          props[name] && typeof props[name] === 'object'
            ? (props[name] as Record<string, unknown>)
            : {}
        const label =
          typeof schema.description === 'string' && schema.description.trim()
            ? schema.description
            : name
        if (Array.isArray(schema.enum) && schema.enum.length > 0) {
          const options = schema.enum
            .map(
              (value) =>
                `            <option value=${JSON.stringify(String(value))}>${escapeForJsxText(String(value))}</option>`
            )
            .join('\n')
          return `        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={{ display: 'block', fontSize: 12, opacity: 0.7 }}>${escapeForJsxText(label)}</span>
          <select
            value={String(inputs${index}[${JSON.stringify(name)}] ?? '')}
            onChange={(e) => setInputs${index}((prev) => ({ ...prev, [${JSON.stringify(name)}]: e.target.value }))}
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #333', background: '#151820', color: 'inherit' }}
          >
${options}
          </select>
        </label>`
        }
        if (schema.type === 'boolean') {
          return `        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={Boolean(inputs${index}[${JSON.stringify(name)}])}
            onChange={(e) => setInputs${index}((prev) => ({ ...prev, [${JSON.stringify(name)}]: e.target.checked }))}
          />
          <span style={{ fontSize: 12, opacity: 0.8 }}>${escapeForJsxText(label)}</span>
        </label>`
        }
        return `        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={{ display: 'block', fontSize: 12, opacity: 0.7 }}>${escapeForJsxText(label)}</span>
          <input
            type=${JSON.stringify(schema.type === 'number' ? 'number' : 'text')}
            value={String(inputs${index}[${JSON.stringify(name)}] ?? '')}
            onChange={(e) => setInputs${index}((prev) => ({ ...prev, [${JSON.stringify(name)}]: ${schema.type === 'number' ? "e.target.value === '' ? '' : Number(e.target.value)" : 'e.target.value'} }))}
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #333', background: '#151820', color: 'inherit' }}
          />
        </label>`
      })
      .join('\n')

    return {
      actionId: action.actionId,
      title: action.workflowName,
      description: action.description,
      fieldState: fieldState || '',
      inputs,
      index,
    }
  })

  const stateDecls = actionButtons
    .map((a) => {
      const initial = a.fieldState ? `{\n${a.fieldState}\n  }` : '{}'
      return `  const [inputs${a.index}, setInputs${a.index}] = useState<Record<string, unknown>>(${initial})`
    })
    .join('\n')

  const cards = actionButtons
    .map(
      (
        a
      ) => `      <section style={{ border: '1px solid #2a2f3a', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>${escapeForJsxText(a.title)}</h2>
        <p style={{ margin: '0 0 12px', opacity: 0.7, fontSize: 13 }}>${escapeForJsxText(a.description)}</p>
${a.inputs}
        <button
          disabled={busy === ${JSON.stringify(a.actionId)}}
          onClick={() => void onRun(${JSON.stringify(a.actionId)}, inputs${a.index})}
          style={{ marginTop: 8 }}
        >
          {busy === ${JSON.stringify(a.actionId)} ? 'Running…' : 'Run ${escapeForJsxText(a.title)}'}
        </button>
      </section>`
    )
    .join('\n')

  const appTsx = `import { useState } from 'react'
import { createSimClientFromWindow } from '@sim/app-sdk'

const sim = createSimClientFromWindow()

function normalizeOutput(value: unknown, depth = 0): unknown {
  if (depth > 4) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return normalizeOutput(JSON.parse(trimmed), depth + 1) } catch { return value }
    }
    return value
  }
  if (Array.isArray(value)) return value.map((item) => normalizeOutput(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeOutput(item, depth + 1)]))
  }
  return value
}

function renderOutput(rawValue: unknown) {
  const value = normalizeOutput(rawValue)
  if (typeof value === 'string') {
    return <p style={{ background: '#11141a', padding: 12, borderRadius: 8 }}>{value}</p>
  }
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { url?: unknown }).url === 'string' &&
    typeof (value as { mimeType?: unknown }).mimeType === 'string' &&
    String((value as { mimeType: string }).mimeType).startsWith('image/')
  ) {
    const file = value as { url: string; name?: string }
    return <img src={file.url} alt={file.name || 'output'} style={{ maxWidth: '100%', borderRadius: 8 }} />
  }
  return <pre style={{ background: '#11141a', padding: 12, borderRadius: 8 }}>{JSON.stringify(value, null, 2)}</pre>
}

export function App() {
  const [result, setResult] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)
${stateDecls}

  async function onRun(actionId: string, input: Record<string, unknown>) {
    setBusy(actionId)
    try {
      const response = await sim.run(actionId, input)
      if (!response.success) throw new Error(response.error || 'Action failed')
      setResult(response.outputs)
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Generated App</h1>
      <p style={{ opacity: 0.75 }}>${escapeForJsxText(prompt)}</p>
${cards}
      <div style={{ marginTop: 16 }}>{result == null ? null : renderOutput(result)}</div>
    </main>
  )
}
`

  return {
    source: 'fallback',
    files: {
      ...APP_TEMPLATE_FILES,
      'src/App.tsx': appTsx,
    },
  }
}

async function attemptFrontendGeneration(params: {
  userId: string
  workspaceId: string
  prompt: string
  handoff: BackendHandoff
  abortSignal?: AbortSignal
  repairDiagnostics?: string
  currentFiles?: Record<string, string>
}): Promise<{ ok: true; files: Record<string, string> } | { ok: false; error: string }> {
  const result = await runDemoFrontendPass({
    userId: params.userId,
    workspaceId: params.workspaceId,
    message: buildFrontendPrompt(
      params.prompt,
      params.handoff,
      params.repairDiagnostics,
      params.currentFiles
    ),
    abortSignal: params.abortSignal,
  })

  if (!result.success) {
    return { ok: false, error: result.error || 'Hosted frontend generation failed' }
  }

  const parsed = extractJsonObject(result.content)
  if (!isRecordLike(parsed) || !Array.isArray(parsed.files)) {
    return { ok: false, error: 'Frontend generation returned non-JSON' }
  }

  const returnedFiles = parsed.files as Array<{ path: string; content: string }>
  if (!params.currentFiles) {
    return validateGeneratedFiles(returnedFiles)
  }

  // Frontend edits are merged server-side so omitted unchanged files cannot be
  // accidentally deleted by a partial model response.
  return mergeCurrentFrontendFiles(params.currentFiles, returnedFiles)
}

/**
 * Isolated hosted frontend pass. One bounded repair, then deterministic fallback.
 */
export async function generateFrontendFiles(params: {
  userId: string
  workspaceId: string
  /** Kept for call-site compatibility; frontend pass is intentionally chat-less. */
  chatId?: string
  prompt: string
  handoff: BackendHandoff
  abortSignal?: AbortSignal
  /** When set, the model receives the current immutable revision source. */
  currentFiles?: Record<string, string>
  /** When true, preserve prior files on total failure instead of overwriting with fallback. */
  preserveOnFailure?: boolean
}): Promise<GeneratedFrontend | { source: 'unchanged'; files: Record<string, string> }> {
  try {
    const first = await attemptFrontendGeneration(params)
    if (first.ok) {
      return { source: 'hosted', files: first.files, repairAttempted: false }
    }

    logger.warn('Hosted frontend generation failed; attempting one isolated repair', {
      error: first.error,
    })

    const repaired = await attemptFrontendGeneration({
      ...params,
      repairDiagnostics: first.error,
    })
    if (repaired.ok) {
      return { source: 'hosted', files: repaired.files, repairAttempted: true }
    }

    if (params.preserveOnFailure && params.currentFiles) {
      logger.warn('Isolated frontend repair failed; preserving previous source', {
        error: repaired.error,
      })
      return { source: 'unchanged', files: params.currentFiles }
    }

    logger.warn('Isolated frontend repair failed; using fallback', { error: repaired.error })
    return {
      ...buildFallbackFrontend(params.handoff, params.prompt),
      repairAttempted: true,
    }
  } catch (error) {
    if (params.preserveOnFailure && params.currentFiles) {
      logger.warn('Frontend generation threw; preserving previous source', { error })
      return { source: 'unchanged', files: params.currentFiles }
    }
    logger.warn('Frontend generation threw; using fallback', { error })
    return {
      ...buildFallbackFrontend(params.handoff, params.prompt),
      repairAttempted: true,
    }
  }
}
