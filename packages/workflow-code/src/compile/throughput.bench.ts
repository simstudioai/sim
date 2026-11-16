import { test } from 'vitest'
import { compileWorkflow } from './index'
import { TEST_CATALOG } from './test-catalog'

/**
 * Compile latency on a 200-block workflow of about 44 KB (s3 §5 "Performance": p95 under 50 ms
 * warm). Not part of `bun run test` (the package runs `*.test.ts` only) and not a CI gate. Run:
 * `bun run --cwd packages/workflow-code vitest bench --run src/compile/throughput.bench.ts`.
 * With `--reporter=verbose` it prints mean, p75 and p99 latency; p99 bounds the p95 target.
 */

const BLOCKS = 200

function blockSource(index: number): string {
  const previous = index === 0 ? 'start' : `step${index - 1}`
  const ref = (path: string) => `\${${previous}.${path}}`
  switch (index % 4) {
    case 0:
      return [
        `  const step${index} = api('Step ${index}', {`,
        `    url: t\`https://api.example.com/items/${ref('data')}?page=${index}\`,`,
        "    method: 'GET',",
        `    headers: { Authorization: t\`Bearer \${env.API_TOKEN}\`, 'X-Request': '${index}', 'X-Trace': 'bench-trace' },`,
        '  })',
      ].join('\n')
    case 1:
      return [
        `  const step${index} = agent('Step ${index}', {`,
        "    model: 'claude-sonnet-5-5',",
        `    messages: [{ role: 'user', content: t\`Summarize ${ref('data')} for run ${index}\` }],`,
        '    temperature: 0.2,',
        '  })',
      ].join('\n')
    case 2:
      return [
        `  const step${index} = slack.sendMessage('Step ${index}', {`,
        "    authMethod: 'oauth',",
        "    credential: binding('support-slack'),",
        `    channel: picked('C0${index}'),`,
        `    text: t\`Update ${index}: ${ref('content')}\`,`,
        '  })',
      ].join('\n')
    default:
      return [
        `  // Score step ${index}`,
        `  const step${index} = fn('Step ${index}', {`,
        "    language: 'javascript',",
        `    code: js\`const value = ${ref('ts')}`,
        `return { value, index: ${index} }\`,`,
        '  })',
      ].join('\n')
  }
}

const SOURCE = [
  '// @sim-sdk 1',
  "import { agent, api, binding, env, fn, js, picked, slack, t, trigger, workflow } from '@sim/workflow-sdk'",
  '',
  "export default workflow('Bench', { description: 'Two hundred blocks.' }, () => {",
  "  const start = trigger.start('Start', { inputFormat: { query: 'string' } })",
  ...Array.from({ length: BLOCKS }, (_, index) => blockSource(index)),
  '',
  ...Array.from({ length: BLOCKS }, (_, index) =>
    index === 0 ? '  start.to(step0)' : `  step${index - 1}.to(step${index})`
  ),
  '})',
  '',
].join('\n')

function compile() {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text: SOURCE },
    files: new Map(),
    catalog: TEST_CATALOG,
    sdkMajor: 1,
  })
}

test(`compile ${BLOCKS} blocks (${Math.round(SOURCE.length / 1024)} KB)`, async ({
  bench,
  expect,
}) => {
  const warm = compile()
  expect(warm.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  expect(Object.keys(warm.workflow?.blocks ?? {})).toHaveLength(BLOCKS + 1)
  await bench('compileWorkflow', () => {
    compile()
  }).run()
})
