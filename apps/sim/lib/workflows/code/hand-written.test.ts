/**
 * Source written by hand against the real block catalog, the way an author or agent writes it
 * rather than the way the printer writes it: apply it, read it back, apply it again.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBlock } from '@sim/testing/factories/block.factory'
import {
  type CanonicalWorkflow,
  canonicalize,
  compileWorkflow,
  diffCanonical,
  materialize,
  printWorkflow,
  type ResourceKeyResolver,
} from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { generateRegistryCorpus } from '@/lib/workflows/code/corpus'
import { CORPUS_RESOURCES } from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { typeCheckAgainstSdk, writeSdkTypes } from '@/lib/workflows/code/sdk-typecheck.test-helpers'

const hooks = createMaterializeHooks()

const workDir = mkdtempSync(path.join(tmpdir(), 'workflow-code-hand-written-'))

afterAll(() => rmSync(workDir, { recursive: true, force: true }))

let typesWritten = false

/** Type-checks one source file against the SDK generated from the real catalog. */
function typeCheck(name: string, text: string): string {
  if (!typesWritten) {
    writeSdkTypes(workDir, catalog)
    typesWritten = true
  }
  const file = path.join(workDir, `${name}.ts`)
  writeFileSync(file, text)
  return typeCheckAgainstSdk(workDir, name, [file])
}

const RESOURCES: ResourceKeyResolver = {
  toKey: (_kind, id) => (id.startsWith('id-') ? id.slice(3) : null),
  toId: (_kind, key) => `id-${key}`,
  nameOf: () => null,
}

const HEADER = '// @sim-sdk 1\n'

function compile(text: string, stored?: CanonicalWorkflow) {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(),
    catalog,
    sdkMajor: catalog.sdkMajor,
    ...(stored && { knownKeys: new Set(Object.keys(stored.blocks)), stored }),
  })
}

/** Applies `text` to an empty workflow, then again over what the first apply stored. */
function applyTwice(text: string) {
  const first = compile(text)
  if (!first.workflow) throw new Error(first.diagnostics.map((d) => d.message).join('; '))
  const stored = materialize(first.workflow, null, {
    catalog,
    hooks,
    resources: RESOURCES,
    lockFreshness: 'none',
  }).state
  const canonical = canonicalize(stored, {
    catalog,
    meta: first.workflow.meta,
    resources: RESOURCES,
  }).workflow
  const again = compile(text, canonical)
  if (!again.workflow) throw new Error(again.diagnostics.map((d) => d.message).join('; '))
  const written = materialize(again.workflow, null, {
    catalog,
    hooks,
    prev: stored,
    resources: RESOURCES,
    lockFreshness: 'none',
  })
  const readBack = printWorkflow({
    workflow: canonical,
    catalog,
    options: { functionCode: 'inline' },
  }).files[0].text
  return {
    first,
    stored,
    canonical,
    diff: diffCanonical(canonical, { ...written.workflow, meta: canonical.meta }, new Map()),
    rewritten: written.state,
    readBack,
  }
}

/** One stored block canonicalized, printed and compiled back against what it continues. */
function printAndCompile(type: string, values: Record<string, unknown>) {
  const subBlocks = Object.fromEntries(
    Object.entries(values).map(([id, value]) => [id, { id, type: 'short-input', value }])
  )
  const state: WorkflowState = {
    blocks: { b1: createBlock({ id: 'b1', type, name: 'Block', subBlocks } as never) },
    edges: [],
    loops: {},
    parallels: {},
  }
  const canonical = canonicalize(state, {
    catalog,
    meta: { name: 'W', description: null },
    resources: RESOURCES,
  }).workflow
  const text = printWorkflow({ workflow: canonical, catalog, options: { functionCode: 'inline' } })
    .files[0].text
  return { text, diagnostics: compile(text, canonical).diagnostics }
}

describe('hand-written source over the real catalog', () => {
  it.each([
    [
      'elevenlabs',
      { operation: 'sound_effects', text: 'rain', modelId: 'eleven_text_to_sound_v2' },
    ],
    ['elevenlabs', { operation: 'speech_to_speech', modelId: 'eleven_multilingual_sts_v2' }],
    ['stt', { provider: 'deepgram', model: 'nova-3' }],
  ])(
    'reads a %s field declared more than once by the declaration its values select',
    (type, values) => {
      const { text, diagnostics } = printAndCompile(type, values)
      expect(text).not.toContain('raw(')
      expect(
        diagnostics.filter((d) => d.code === 'W_FIELD_NOT_APPLICABLE' || d.code === 'W_VALUE_KIND')
      ).toEqual([])
    },
    120_000
  )

  it('re-applies an agent with builder tools as a no-op and reads back without modes', () => {
    const text = `${HEADER}import { agent, credential, slack, t, trigger, workflow } from '@sim/workflow-sdk'
export default workflow('Notify', {}, () => {
  const start = trigger.start('Start', {})
  const a = agent('A', {
    model: 'gpt-4o',
    apiKey: 'x',
    messages: [{ role: 'user', content: t\`\${start.input}\` }],
    tools: [slack.tool.sendMessage({ credential: credential('ops'), channel: 'C1', text: 'hi' })],
  })
  start.to(a)
})
`
    const run = applyTwice(text)
    expect(run.diff.noop).toBe(true)
    expect(run.rewritten.blocks).toEqual(run.stored.blocks)
    expect(run.readBack).toContain('slack.tool.sendMessage(')
    expect(run.readBack).not.toContain('modes:')
  }, 120_000)

  it('keeps a credential in a response body form out of the file, warning where source writes it', () => {
    const bearer = ['Bearer ', 'abcdefghij', 'klmnopqrstuvwxyz0123456789'].join('')
    const text = `${HEADER}import { response, trigger, workflow } from '@sim/workflow-sdk'
export default workflow('Reply', {}, () => {
  const start = trigger.start('Start', {})
  const reply = response('Reply', { body: { ok: true }, headers: { Authorization: '${bearer}' } })
  start.to(reply)
})
`
    const run = applyTwice(text)
    expect(
      run.first.diagnostics.filter((d) => d.code === 'W_LITERAL_SECRET').map((d) => d.param)
    ).toEqual(['headers'])
    expect(run.readBack).not.toContain(bearer)
    expect(run.readBack).toContain('headers: stored()')
    const again = compile(run.readBack, run.canonical)
    expect(again.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(again.workflow?.blocks.reply).toEqual(run.canonical.blocks.reply)
  }, 120_000)

  it("types and compiles a Slack trigger's streamed outputs, which the runtime reads", () => {
    const text = `${HEADER}import { agent, credential, env, trigger, workflow } from '@sim/workflow-sdk'
export default workflow('Stream', {}, () => {
  const s = trigger.slack.oauth('Slack', {
    botCredential: credential('ops'),
    eventType: 'app_mention',
    streamResponse: true,
    streamOutputs: ['answer.content'],
  })
  const answer = agent('Answer', {
    model: 'gpt-4o',
    apiKey: env.OPENAI_API_KEY,
    messages: [{ role: 'user', content: 'Answer the mention.' }],
  })
  s.to(answer)
})
`
    expect(typeCheck('stream', text)).toBe('')
    const compiled = compile(text)
    expect(compiled.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    const stored = compiled.workflow
      ? materialize(compiled.workflow, null, {
          catalog,
          hooks,
          resources: RESOURCES,
          lockFreshness: 'none',
        }).state
      : null
    const slack = Object.values(stored?.blocks ?? {}).find((block) => block.triggerMode)
    expect(slack?.subBlocks.streamOutputs?.value).toEqual(['answer.content'])
  }, 120_000)

  it("types the Start block's built-in outputs, which hand-written source reads", () => {
    const text = `${HEADER}import { agent, env, t, trigger, workflow } from '@sim/workflow-sdk'
export default workflow('Chat', {}, () => {
  const start = trigger.start('Start', {})
  const a = agent('A', {
    model: 'gpt-4o',
    apiKey: env.OPENAI_API_KEY,
    messages: [{ role: 'user', content: t\`\${start.input} \${start.conversationId}\` }],
    files: start.files,
  })
  start.to(a)
})
`
    expect(typeCheck('start', text)).toBe('')
    expect(compile(text).diagnostics).toEqual([])
  }, 120_000)

  it('reads a stored uploaded file back as source that type-checks and compiles clean', () => {
    const file = { name: 'a.txt', path: '/api/files/serve/a.txt', size: 3, type: 'text/plain' }
    const { text, diagnostics } = printAndCompile('agent', {
      model: 'gpt-4o',
      attachmentFiles: [file],
    })
    expect(text).toContain("path: '/api/files/serve/a.txt'")
    expect(diagnostics.filter((d) => d.code === 'W_VALUE_KIND')).toEqual([])
    expect(typeCheck('upload', text)).toBe('')
  }, 120_000)

  it('says a schedule created with no timezone runs in UTC, and only then', () => {
    const schedule = (
      params: string
    ) => `${HEADER}import { trigger, workflow } from '@sim/workflow-sdk'
export default workflow('Nightly', {}, () => {
  trigger.schedule('Nightly', { scheduleType: 'daily', dailyTime: '02:00'${params} })
})
`
    const codes = (text: string) => compile(text).diagnostics.map((d) => `${d.severity}:${d.code}`)
    expect(codes(schedule(''))).toEqual(['info:I_SCHEDULE_UTC'])
    expect(codes(schedule(", timezone: 'America/New_York'"))).toEqual([])
  }, 120_000)

  it('reads the corpus agent with every kind of tool back through each tool form', () => {
    const subject = generateRegistryCorpus().find(
      (corpusCase) => corpusCase.id === 'agent-tools:agent:every-kind'
    )
    if (!subject) throw new Error('missing corpus case')
    const workflow = canonicalize(subject.state, {
      catalog,
      meta: { name: 'Tools', description: null },
      resources: CORPUS_RESOURCES,
    }).workflow
    const [entry] = printWorkflow({ workflow, catalog, options: { functionCode: 'inline' } }).files
    for (const form of [
      'slack.tool.sendMessage(',
      "customTool('corpus-custom-tool'",
      '.tool(',
      'childWorkflow(',
    ]) {
      expect(entry.text).toContain(form)
    }
    expect(entry.text).not.toContain('modes:')
    expect(typeCheck('every-tool', entry.text)).toBe('')
  }, 120_000)
})
