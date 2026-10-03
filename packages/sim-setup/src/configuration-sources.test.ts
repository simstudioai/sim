import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type ConfigurationCommandRunner,
  type ConfigurationSourceDiscoveryOptions,
  discoverConfigurationSources as discoverConfigurationSourcesFromEnvironment,
  resolveKubernetesContainerEnvironment,
} from './configuration-sources'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'sim-configuration-sources-'))
  temporaryDirectories.push(directory)
  return directory
}

function commandResult(status: number, stdout = '') {
  return { status, stdout, stderr: '' }
}

function discoverConfigurationSources(options: ConfigurationSourceDiscoveryOptions) {
  return discoverConfigurationSourcesFromEnvironment({ processEnvironment: {}, ...options })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('discoverConfigurationSources', () => {
  it('uses the last active value from a prepared Compose .env file', () => {
    const root = temporaryDirectory()
    writeFileSync(path.join(root, '.env'), 'RESEND_API_KEY=old\nRESEND_API_KEY=current\n')
    writeFileSync(
      path.join(root, 'docker-compose.prod.yml'),
      'services:\n  simstudio:\n    image: ghcr.io/simstudioai/simstudio:latest\n    env_file: .env\n'
    )

    const sources = discoverConfigurationSources({ root, runner: () => commandResult(1) })

    expect(sources).toHaveLength(1)
    expect(sources[0].values?.get('RESEND_API_KEY')).toBe('current')
  })

  it('uses the effective environment of a stopped Compose app container', () => {
    const parent = temporaryDirectory()
    const root = path.join(parent, 'checkout')
    const deployment = path.join(parent, 'deployment')
    mkdirSync(root)
    mkdirSync(deployment)
    const composeFile = path.join(deployment, 'compose.yml')
    writeFileSync(
      composeFile,
      'services:\n  simstudio:\n    image: ghcr.io/simstudioai/simstudio:latest\n'
    )
    const runner: ConfigurationCommandRunner = (command, args) => {
      if (command === 'docker' && args[0] === 'info') return commandResult(0)
      if (command === 'docker' && args[0] === 'compose' && args[1] === 'ls') {
        return commandResult(
          0,
          JSON.stringify([{ Name: 'external-sim', Status: 'exited', ConfigFiles: composeFile }])
        )
      }
      if (command === 'docker' && args[0] === 'ps') return commandResult(0, 'container-id\n')
      if (command === 'docker' && args[0] === 'inspect') {
        return commandResult(
          0,
          JSON.stringify([
            {
              Created: '2026-01-01T00:00:00Z',
              State: { Running: false },
              Config: { Env: ['RESEND_API_KEY=secret', 'REDIS_URL=redis://redis:6379'] },
            },
          ])
        )
      }
      return commandResult(1)
    }

    const sources = discoverConfigurationSources({ root, runner })

    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      kind: 'compose',
      label: 'Compose project "external-sim"',
      managedByCurrentCheckout: false,
    })
    expect(sources[0].values?.get('REDIS_URL')).toBe('redis://redis:6379')
    expect(sources[0].values?.get('RESEND_API_KEY')).toBe('secret')
  })

  it('replaces the prepared root source with one unambiguous live project', () => {
    const root = temporaryDirectory()
    writeFileSync(path.join(root, '.env'), 'RESEND_API_KEY=prepared\n')
    const composeFile = path.join(root, 'docker-compose.prod.yml')
    writeFileSync(
      composeFile,
      'services:\n  simstudio:\n    image: ghcr.io/simstudioai/simstudio:latest\n'
    )
    const runner: ConfigurationCommandRunner = (command, args) => {
      if (command === 'docker' && args[0] === 'info') return commandResult(0)
      if (command === 'docker' && args[0] === 'compose' && args[1] === 'ls') {
        return commandResult(
          0,
          JSON.stringify([{ Name: 'current-sim', Status: 'running', ConfigFiles: composeFile }])
        )
      }
      if (command === 'docker' && args[0] === 'ps') return commandResult(0, 'container-id\n')
      if (command === 'docker' && args[0] === 'inspect') {
        return commandResult(
          0,
          JSON.stringify([
            {
              Created: '2026-01-01T00:00:00Z',
              State: { Running: true },
              Config: { Env: ['RESEND_API_KEY=effective'] },
            },
          ])
        )
      }
      return commandResult(1)
    }

    const sources = discoverConfigurationSources({ root, runner })

    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      label: 'Compose project "current-sim"',
      managedByCurrentCheckout: true,
    })
    expect(sources[0].values?.get('RESEND_API_KEY')).toBe('effective')
  })

  it('loads development env files with Next precedence', () => {
    const root = temporaryDirectory()
    const appDirectory = path.join(root, 'apps/sim')
    mkdirSync(appDirectory, { recursive: true })
    writeFileSync(path.join(appDirectory, '.env'), 'STATUS_PRECEDENCE=base\n')
    writeFileSync(path.join(appDirectory, '.env.development'), 'STATUS_PRECEDENCE=development\n')
    writeFileSync(path.join(appDirectory, '.env.local'), 'STATUS_PRECEDENCE=local\n')
    writeFileSync(
      path.join(appDirectory, '.env.development.local'),
      'STATUS_PRECEDENCE=development-local\n'
    )

    const sources = discoverConfigurationSources({ root, runner: () => commandResult(1) })

    expect(sources).toHaveLength(1)
    expect(sources[0].values?.get('STATUS_PRECEDENCE')).toBe('development-local')
    expect(sources[0].location).toContain('.env.development.local')
    expect(sources[0].location).toContain('process environment')
    expect(sources[0].managedByCurrentCheckout).toBe(false)
  })

  it('does not offer setup writes when a process-only capability value wins', () => {
    const root = temporaryDirectory()
    const appDirectory = path.join(root, 'apps/sim')
    mkdirSync(appDirectory, { recursive: true })
    writeFileSync(path.join(appDirectory, '.env'), 'SLACK_CLIENT_SECRET=file-secret\n')
    const sources = discoverConfigurationSources({
      root,
      runner: () => commandResult(1),
      processEnvironment: { SLACK_CLIENT_ID: 'process-client-id' },
    })

    expect(sources[0].values?.get('SLACK_CLIENT_ID')).toBe('process-client-id')
    expect(sources[0].managedByCurrentCheckout).toBe(false)
  })

  it('does not substitute desired Compose values when a known container cannot be inspected', () => {
    const root = temporaryDirectory()
    const composeFile = path.join(root, 'docker-compose.prod.yml')
    writeFileSync(
      composeFile,
      'services:\n  simstudio:\n    image: ghcr.io/simstudioai/simstudio:latest\n'
    )
    const runner: ConfigurationCommandRunner = (command, args) => {
      if (command === 'docker' && args[0] === 'info') return commandResult(0)
      if (command === 'docker' && args[0] === 'compose' && args[1] === 'ls') {
        return commandResult(
          0,
          JSON.stringify([{ Name: 'known-sim', Status: 'running', ConfigFiles: composeFile }])
        )
      }
      if (command === 'docker' && args[0] === 'ps') return commandResult(0, 'container-id\n')
      if (command === 'docker' && args[0] === 'inspect') return commandResult(1)
      if (command === 'docker' && args[0] === 'compose') {
        return commandResult(
          0,
          JSON.stringify({
            services: { simstudio: { environment: { RESEND_API_KEY: 'desired' } } },
          })
        )
      }
      return commandResult(1)
    }

    const sources = discoverConfigurationSources({ root, runner })

    expect(sources).toHaveLength(1)
    expect(sources[0].values).toBeNull()
    expect(sources[0].warning).toContain('could not be inspected')
  })
})

describe('resolveKubernetesContainerEnvironment', () => {
  it('applies envFrom order and then explicit env/valueFrom precedence', () => {
    const resources = new Map([
      [
        'secret/app-secret',
        {
          data: {
            SHARED: Buffer.from('secret').toString('base64'),
            SECRET_ONLY: Buffer.from('secret-only').toString('base64'),
            EXPLICIT_SOURCE: Buffer.from('from-secret-key').toString('base64'),
          },
        },
      ],
      ['configmap/app-config', { data: { SHARED: 'configmap', CONFIG_ONLY: 'config-only' } }],
    ])
    const resolution = resolveKubernetesContainerEnvironment(
      {
        envFrom: [{ secretRef: { name: 'app-secret' } }, { configMapRef: { name: 'app-config' } }],
        env: [
          { name: 'SHARED', value: 'explicit' },
          {
            name: 'FROM_SECRET',
            valueFrom: { secretKeyRef: { name: 'app-secret', key: 'EXPLICIT_SOURCE' } },
          },
        ],
      },
      (kind, name) => {
        const resource = resources.get(`${kind}/${name}`)
        return resource ? { state: 'found', resource } : { state: 'missing' }
      }
    )

    expect(resolution.warning).toBeUndefined()
    expect(resolution.values).toEqual(
      new Map([
        ['SHARED', 'explicit'],
        ['SECRET_ONLY', 'secret-only'],
        ['EXPLICIT_SOURCE', 'from-secret-key'],
        ['CONFIG_ONLY', 'config-only'],
        ['FROM_SECRET', 'from-secret-key'],
      ])
    )
  })

  it('returns unknown instead of claiming missing configuration when a Secret is inaccessible', () => {
    const resolution = resolveKubernetesContainerEnvironment(
      { envFrom: [{ secretRef: { name: 'restricted-secret' } }] },
      () => ({ state: 'inaccessible' })
    )

    expect(resolution.values).toBeNull()
    expect(resolution.warning).toContain('RBAC')
    expect(resolution.warning).not.toContain('secret-value')
  })
})
