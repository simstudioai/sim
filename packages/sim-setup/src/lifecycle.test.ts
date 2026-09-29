import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureProductionComposeFile } from './compose-asset'
import {
  composeInstallFromDirectory,
  composeServiceQuery,
  composeServiceState,
  type Install,
  serviceStatusRows,
} from './lifecycle'

describe('setup lifecycle', () => {
  it('does not duplicate a running install restored from its directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sim-setup-lifecycle-'))
    try {
      const file = ensureProductionComposeFile({ kind: 'standalone', root, existing: false })
      const active = [{ kind: 'compose', file, dir: root, project: 'sim-live' }] as const

      expect(composeInstallFromDirectory(root, active)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reads a Compose service as running when any replica is running', () => {
    expect(composeServiceState('running')).toEqual({ state: 'running' })
    expect(composeServiceState('exited\nrunning\n')).toEqual({ state: 'running' })
  })

  it('reads a Compose service with only stopped containers as stopped', () => {
    expect(composeServiceState('exited')).toEqual({ state: 'stopped' })
    expect(composeServiceState('created\nexited')).toEqual({ state: 'stopped' })
  })

  it('reads an empty Compose query as absent and a failed one as unknown', () => {
    expect(composeServiceState('')).toBeNull()
    expect(composeServiceState('\n  \n')).toBeNull()
    expect(composeServiceState(null)).toBe('unknown')
  })
})

describe('status service rows', () => {
  const compose = (project: string): Install => ({
    kind: 'compose',
    file: `/srv/${project}/docker-compose.prod.yml`,
    dir: `/srv/${project}`,
    project,
  })
  const dev: Install = { kind: 'dev', postgres: true, redis: true }
  const standalone = { db: { state: 'running' as const }, redis: null }

  /** Answers `docker ps` by the project/service labels in the query, like Docker would. */
  const fakeDocker =
    (states: Record<string, string | null>) =>
    (args: string[]): string | null => {
      const project = args.find((a) => a.startsWith('label=com.docker.compose.project='))
      const service = args.find((a) => a.startsWith('label=com.docker.compose.service='))
      const key = `${project?.split('=').pop()}/${service?.split('=').pop()}`
      return key in states ? states[key]! : ''
    }

  it('queries Compose services by project and service label', () => {
    expect(composeServiceQuery('sim-abc', 'db')).toEqual([
      'ps',
      '-a',
      '--filter',
      'label=com.docker.compose.project=sim-abc',
      '--filter',
      'label=com.docker.compose.service=db',
      '--format',
      '{{.State}}',
    ])
  })

  it('shows only Compose rows for a Compose install', () => {
    const rows = serviceStatusRows(
      [compose('sim-abc')],
      standalone,
      fakeDocker({ 'sim-abc/db': 'running', 'sim-abc/redis': 'exited' })
    )
    expect(rows).toEqual([
      { label: 'postgres (compose db)', state: { state: 'running' } },
      { label: 'redis (compose redis)', state: { state: 'stopped' } },
    ])
  })

  it('reports a failed Compose query as unknown, not absent', () => {
    const rows = serviceStatusRows([compose('sim-abc')], standalone, () => null)
    expect(rows.map((row) => row.state)).toEqual(['unknown', 'unknown'])
  })

  it('keeps standalone rows when a dev install is present', () => {
    const rows = serviceStatusRows(
      [dev, compose('sim-abc')],
      standalone,
      fakeDocker({ 'sim-abc/db': 'running', 'sim-abc/redis': 'running' })
    )
    expect(rows.map((row) => row.label)).toEqual([
      'postgres (sim-postgres)',
      'redis (sim-redis)',
      'postgres (compose db)',
      'redis (compose redis)',
    ])
    expect(rows[0]!.state).toEqual({ state: 'running' })
    expect(rows[1]!.state).toBeNull()
  })

  it('never queries Compose labels without a Compose install', () => {
    let queried = false
    const rows = serviceStatusRows([dev], standalone, () => {
      queried = true
      return ''
    })
    expect(queried).toBe(false)
    expect(rows.map((row) => row.label)).toEqual(['postgres (sim-postgres)', 'redis (sim-redis)'])
  })

  it('prefixes rows with the project when several Compose stacks run', () => {
    const rows = serviceStatusRows(
      [compose('sim-a'), compose('sim-b')],
      standalone,
      fakeDocker({ 'sim-a/db': 'running', 'sim-b/db': '' })
    )
    expect(rows.map((row) => [row.label, row.state])).toEqual([
      ['sim-a postgres (compose db)', { state: 'running' }],
      ['sim-a redis (compose redis)', null],
      ['sim-b postgres (compose db)', null],
      ['sim-b redis (compose redis)', null],
    ])
  })
})
