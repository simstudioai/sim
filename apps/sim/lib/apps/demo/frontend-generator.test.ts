import { describe, expect, it } from 'vitest'
import type { BackendHandoff } from '@/lib/apps/demo/backend-handoff'
import {
  buildFallbackFrontend,
  mergeCurrentFrontendFiles,
  validateGeneratedFiles,
} from '@/lib/apps/demo/frontend-generator'
import { DRAFT_DEPLOYMENT_VERSION_SENTINEL } from '@/lib/apps/draft-binding'

const handoff: BackendHandoff = {
  actions: [
    {
      actionId: 'summarize',
      workflowId: 'wf-1',
      workflowName: 'Summarize',
      description: 'Summarize text',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      outputAllowlist: [
        {
          key: 'content',
          blockId: 'agent-1',
          path: 'content',
          schema: { type: 'string' },
        },
      ],
      schemaHash: 'hash-1',
      action: {
        actionId: 'summarize',
        workflowId: 'wf-1',
        deploymentVersionId: DRAFT_DEPLOYMENT_VERSION_SENTINEL,
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        outputAllowlist: [
          {
            key: 'content',
            blockId: 'agent-1',
            path: 'content',
            schema: { type: 'string' },
          },
        ],
        executionPolicy: 'sync',
        schemaHash: 'hash-1',
      },
    },
    {
      actionId: 'translate',
      workflowId: 'wf-2',
      workflowName: 'Translate',
      description: 'Translate text',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
      },
      outputAllowlist: [],
      schemaHash: 'hash-2',
      action: {
        actionId: 'translate',
        workflowId: 'wf-2',
        deploymentVersionId: DRAFT_DEPLOYMENT_VERSION_SENTINEL,
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
        },
        outputAllowlist: [],
        executionPolicy: 'sync',
        schemaHash: 'hash-2',
      },
    },
  ],
}

describe('validateGeneratedFiles', () => {
  it('accepts allowed src files and merges the template', () => {
    const result = validateGeneratedFiles([
      {
        path: 'src/App.tsx',
        content: 'export function App() { return null }',
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files['src/App.tsx']).toContain('export function App')
    expect(result.files['package.json']).toBeTruthy()
    expect(result.files['src/main.tsx']).toBeTruthy()
  })

  it('rejects platform-owned or illegal paths', () => {
    const result = validateGeneratedFiles([
      { path: 'package.json', content: '{}' },
      { path: 'src/App.tsx', content: 'export function App() { return null }' },
    ])
    expect(result.ok).toBe(false)
  })

  it('rejects an App module that only has a default export', () => {
    const result = validateGeneratedFiles([
      {
        path: 'src/App.tsx',
        content: 'export default function App() { return null }',
      },
    ])

    expect(result).toEqual({
      ok: false,
      error: 'src/App.tsx must export a named React component called App',
    })
  })
})

describe('mergeCurrentFrontendFiles', () => {
  it('preserves omitted files while applying returned edits', () => {
    const result = mergeCurrentFrontendFiles(
      {
        'src/App.tsx': 'export function App() { return <div>old</div> }',
        'src/styles.css': '.button { color: red }',
      },
      [{ path: 'src/App.tsx', content: 'export function App() { return <div>new</div> }' }]
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files['src/App.tsx']).toContain('new')
    expect(result.files['src/styles.css']).toBe('.button { color: red }')
  })
})

describe('buildFallbackFrontend', () => {
  it('renders a multi-action UI for every handoff action', () => {
    const result = buildFallbackFrontend(handoff, 'Build a summarize + translate app')
    expect(result.source).toBe('fallback')
    expect(result.files['src/App.tsx']).toContain('summarize')
    expect(result.files['src/App.tsx']).toContain('translate')
    expect(result.files['src/App.tsx']).toContain('sim.run')
    expect(result.files['src/App.tsx']).toContain('normalizeOutput')
    expect(result.files['src/App.tsx']).toContain('JSON.parse(trimmed)')
  })
})
