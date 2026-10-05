import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const digest = `sha256:${'a'.repeat(64)}`
const otherDigest = `sha256:${'b'.repeat(64)}`
const execution = (id: string, time: number, revision: string, status = 'Succeeded') => ({
  pipelineExecutionId: id,
  startTime: new Date(time * 1000).toISOString(),
  status,
  sourceRevisions: [{ actionName: 'ECR_Source', revisionId: revision }],
})
const current = execution('current', 2, digest)
const older = execution('older', 1, otherDigest)
const pending = execution('pending', 3, otherDigest, 'InProgress')

const cases = [
  {
    name: 'accepts the latest completed acknowledged release in unordered history',
    histories: [
      [older, current],
      [older, current],
    ],
    allowed: true,
  },
  {
    name: 'rejects a stale acknowledgement after a different release succeeds',
    histories: [[execution('different', 3, otherDigest), current]],
    allowed: false,
  },
  {
    name: 'rejects a newer pending release even when an older success appears first',
    histories: [[current, pending]],
    allowed: false,
  },
  {
    name: 'rejects a newer deployment discovered in the final unordered history',
    histories: [[current], [current, pending]],
    allowed: false,
  },
] as const

/** Exercises the preflight CLI against deployment histories without contacting an AWS account. */
describe('Project rollout release acknowledgement', () => {
  it.each(cases)('$name', async ({ histories, allowed }) => {
    const directory = await mkdtemp(join(tmpdir(), 'project-rollout-'))
    try {
      const fixture = join(directory, 'history.json')
      await writeFile(fixture, JSON.stringify({ histories, digest }))
      await writeFile(
        join(directory, 'aws'),
        `#!/usr/bin/env python3
import json, os, pathlib, sys
fixture = pathlib.Path(os.environ['PROJECT_ROLLOUT_FIXTURE'])
data = json.loads(fixture.read_text())
args = sys.argv
if 'list-pipeline-executions' in args:
    counter = fixture.with_suffix('.count')
    index = int(counter.read_text()) if counter.exists() else 0
    counter.write_text(str(index + 1))
    result = {'pipelineExecutionSummaries': data['histories'][min(index, len(data['histories']) - 1)]}
elif 'get-deployment-group' in args:
    result = {'deploymentGroupInfo': {'ecsServices': [{'clusterName': 'fixture', 'serviceName': 'fixture'}]}}
elif 'describe-services' in args:
    result = {'services': [{'desiredCount': 1, 'runningCount': 1, 'pendingCount': 0}]}
elif 'list-tasks' in args:
    result = {'taskArns': ['fixture-task'] if args[args.index('--desired-status') + 1] == 'RUNNING' else []}
elif 'describe-tasks' in args:
    result = {'tasks': [{'lastStatus': 'RUNNING', 'desiredStatus': 'RUNNING', 'containers': [{'name': 'app', 'imageDigest': data['digest']}]}]}
else:
    raise SystemExit('Unexpected AWS command')
print(json.dumps(result))
`,
        { mode: 0o700 }
      )
      const result = spawnSync(
        'python3',
        [
          resolve('.github/scripts/check-project-rollout.py'),
          '--environment',
          'staging',
          '--region',
          'fixture-region',
          '--expected-image-digest',
          digest,
        ],
        {
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            PATH: `${directory}${delimiter}${process.env.PATH}`,
            PROJECT_ROLLOUT_FIXTURE: fixture,
          },
        }
      )
      if (allowed) {
        expect(result.status, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout)).toMatchObject({
          ecsRetired: true,
          pipelineExecutionId: 'current',
        })
      } else {
        expect(result.status, result.stdout).toBe(1)
        expect(result.stderr).toContain('Project rollout preflight refused:')
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
