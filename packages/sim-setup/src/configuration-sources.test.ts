import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type ConfigurationCommandRunner,
  type ConfigurationSourceDiscoveryOptions,
  discoverConfigurationSources as discoverConfigurationSourcesFromEnvironment,
  parseComposeFileEnvironment,
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
  it('enumerates split development and prepared Compose configuration separately', () => {
    const root = temporaryDirectory()
    mkdirSync(path.join(root, 'apps/sim'), { recursive: true })
    mkdirSync(path.join(root, 'apps/realtime'), { recursive: true })
    mkdirSync(path.join(root, 'packages/db'), { recursive: true })
    writeFileSync(path.join(root, 'apps/sim/.env'), 'RESEND_API_KEY=dev-email\n')
    writeFileSync(path.join(root, 'apps/realtime/.env'), 'REDIS_URL=redis://localhost:6379\n')
    writeFileSync(path.join(root, 'packages/db/.env'), 'DATABASE_URL=postgresql://dev\n')
    writeFileSync(path.join(root, '.env'), 'RESEND_API_KEY=compose-email\n')
    writeFileSync(
      path.join(root, 'docker-compose.prod.yml'),
      `services:
  simstudio:
    image: ghcr.io/simstudioai/simstudio:latest
    env_file:
      - .env
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio
      - NEXT_PUBLIC_APP_URL=\${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
      - BETTER_AUTH_URL=\${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
      - REDIS_URL=\${REDIS_URL:-redis://redis:6379}
`
    )
    const runner: ConfigurationCommandRunner = () => commandResult(1)

    const sources = discoverConfigurationSources({ root, runner })

    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({ kind: 'dev', managedByCurrentCheckout: true })
    expect(sources[0].values?.get('RESEND_API_KEY')).toBe('dev-email')
    expect(sources[0].values?.has('DATABASE_URL')).toBe(false)
    expect(sources[1]).toMatchObject({ kind: 'compose', managedByCurrentCheckout: false })
    expect(sources[1].values?.get('RESEND_API_KEY')).toBe('compose-email')
    expect(sources[1].values?.get('REDIS_URL')).toBe('redis://redis:6379')
    expect(sources[1].values?.get('DATABASE_URL')).toBe(
      'postgresql://postgres:postgres@db:5432/simstudio'
    )
  })

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

  it('retains Chat configuration from a prepared Compose .env file', () => {
    const root = temporaryDirectory()
    writeFileSync(
      path.join(root, '.env'),
      [
        'COPILOT_API_KEY=existing-chat-key',
        'NEXT_PUBLIC_CHAT_DISABLED=false',
        'SIM_AGENT_API_URL=https://copilot.example.com',
      ].join('\n')
    )
    writeFileSync(
      path.join(root, 'docker-compose.prod.yml'),
      'services:\n  simstudio:\n    image: ghcr.io/simstudioai/simstudio:latest\n    env_file: .env\n'
    )

    const sources = discoverConfigurationSources({ root, runner: () => commandResult(1) })

    expect(sources).toHaveLength(1)
    expect(sources[0].values?.get('COPILOT_API_KEY')).toBe('existing-chat-key')
    expect(sources[0].values?.get('NEXT_PUBLIC_CHAT_DISABLED')).toBe('false')
    expect(sources[0].values?.get('SIM_AGENT_API_URL')).toBe('https://copilot.example.com')
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

  it('does not claim a live current-checkout project is setup-managed without root .env', () => {
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
          JSON.stringify([{ Name: 'current-sim', Status: 'running', ConfigFiles: composeFile }])
        )
      }
      if (command === 'docker' && args[0] === 'ps') return commandResult(0, 'container-id\n')
      if (command === 'docker' && args[0] === 'inspect') {
        return commandResult(
          0,
          JSON.stringify([{ State: { Running: true }, Config: { Env: ['NODE_ENV=production'] } }])
        )
      }
      return commandResult(1)
    }

    const sources = discoverConfigurationSources({ root, runner })

    expect(sources).toHaveLength(1)
    expect(sources[0].managedByCurrentCheckout).toBe(false)
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

  it('reports missing files in the split development configuration', () => {
    const root = temporaryDirectory()
    const appDirectory = path.join(root, 'apps/sim')
    mkdirSync(appDirectory, { recursive: true })
    writeFileSync(
      path.join(appDirectory, '.env'),
      [
        'DATABASE_URL=postgresql://localhost/sim',
        `BETTER_AUTH_SECRET=${'a'.repeat(32)}`,
        'BETTER_AUTH_URL=http://localhost:3000',
        'NEXT_PUBLIC_APP_URL=http://localhost:3000',
        `ENCRYPTION_KEY=${'b'.repeat(64)}`,
        `INTERNAL_API_SECRET=${'c'.repeat(32)}`,
      ].join('\n')
    )

    const sources = discoverConfigurationSources({ root, runner: () => commandResult(1) })

    expect(sources).toHaveLength(1)
    expect(sources[0].configurationIssues).toEqual(
      expect.arrayContaining(['apps/realtime/.env is missing', 'packages/db/.env is missing'])
    )
  })

  it('reports shared-value drift across split development env files', () => {
    const root = temporaryDirectory()
    mkdirSync(path.join(root, 'apps/sim'), { recursive: true })
    mkdirSync(path.join(root, 'apps/realtime'), { recursive: true })
    mkdirSync(path.join(root, 'packages/db'), { recursive: true })
    writeFileSync(
      path.join(root, 'apps/sim/.env'),
      [
        'DATABASE_URL=postgresql://localhost/sim',
        `BETTER_AUTH_SECRET=${'a'.repeat(32)}`,
        'BETTER_AUTH_URL=http://localhost:3000',
        'NEXT_PUBLIC_APP_URL=http://localhost:3000',
        `ENCRYPTION_KEY=${'b'.repeat(64)}`,
        `INTERNAL_API_SECRET=${'c'.repeat(32)}`,
      ].join('\n')
    )
    writeFileSync(
      path.join(root, 'apps/realtime/.env'),
      [
        'DATABASE_URL=postgresql://localhost/sim',
        `BETTER_AUTH_SECRET=${'d'.repeat(32)}`,
        'BETTER_AUTH_URL=http://localhost:3000',
        'NEXT_PUBLIC_APP_URL=http://localhost:3000',
        `INTERNAL_API_SECRET=${'c'.repeat(32)}`,
      ].join('\n')
    )
    writeFileSync(path.join(root, 'packages/db/.env'), 'DATABASE_URL=postgresql://localhost/other')

    const sources = discoverConfigurationSources({ root, runner: () => commandResult(1) })

    expect(sources[0].configurationIssues).toEqual(
      expect.arrayContaining([
        'BETTER_AUTH_SECRET differs between apps/sim/.env and apps/realtime/.env',
        'DATABASE_URL differs between apps/sim/.env and packages/db/.env',
      ])
    )
  })

  it('identifies a Helm release by current context, namespace, and release', () => {
    const root = temporaryDirectory()
    const runner: ConfigurationCommandRunner = (command, args) => {
      if (command === 'helm') {
        if (args.includes('-a') || !args.includes('--deployed') || !args.includes('--failed')) {
          return commandResult(1)
        }
        if (args.at(-2) !== '--kube-context' || args.at(-1) !== 'production-cluster') {
          return commandResult(1)
        }
        return commandResult(
          0,
          JSON.stringify([{ name: 'sim-prod', namespace: 'production', chart: 'sim-1.2.3' }])
        )
      }
      if (command === 'kubectl' && args[0] === 'config') {
        return commandResult(0, 'production-cluster\n')
      }
      if (!args.includes('--context') || !args.includes('production-cluster')) {
        return commandResult(1)
      }
      if (command === 'kubectl' && args[1] === 'deployments') {
        return commandResult(
          0,
          JSON.stringify({
            items: [
              {
                spec: {
                  template: {
                    spec: {
                      containers: [
                        {
                          name: 'app',
                          env: [{ name: 'NEXT_PUBLIC_APP_URL', value: 'https://sim.example.com' }],
                        },
                      ],
                    },
                  },
                },
              },
            ],
          })
        )
      }
      return commandResult(1)
    }

    const sources = discoverConfigurationSources({ root, runner })

    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      kind: 'helm',
      label: 'Helm release "sim-prod"',
      location: 'context production-cluster · namespace production · release sim-prod',
      managedByCurrentCheckout: false,
    })
    expect(sources[0].values?.get('NEXT_PUBLIC_APP_URL')).toBe('https://sim.example.com')
  })

  it('keeps every Compose config file after one file identifies Sim', () => {
    const parent = temporaryDirectory()
    const root = path.join(parent, 'checkout')
    const deployment = path.join(parent, 'deployment')
    mkdirSync(root)
    mkdirSync(deployment)
    const baseFile = path.join(deployment, 'compose.yml')
    const overrideFile = path.join(deployment, 'compose.override.yml')
    writeFileSync(
      baseFile,
      'services:\n  simstudio:\n    image: ghcr.io/simstudioai/simstudio:latest\n'
    )
    writeFileSync(
      overrideFile,
      'services:\n  simstudio:\n    environment:\n      - REDIS_URL=redis://override\n'
    )
    let renderedWithOverride = false
    const runner: ConfigurationCommandRunner = (command, args) => {
      if (command === 'docker' && args[0] === 'info') return commandResult(0)
      if (command === 'docker' && args[0] === 'compose' && args[1] === 'ls') {
        return commandResult(
          0,
          JSON.stringify([
            {
              Name: 'external-sim',
              Status: 'running',
              ConfigFiles: `${baseFile},${overrideFile}`,
            },
          ])
        )
      }
      if (command === 'docker' && args[0] === 'ps') return commandResult(0)
      if (command === 'docker' && args[0] === 'compose' && args.includes('config')) {
        renderedWithOverride = args.includes(overrideFile)
        return commandResult(
          0,
          JSON.stringify({
            services: { simstudio: { environment: { REDIS_URL: 'redis://override' } } },
          })
        )
      }
      return commandResult(1)
    }

    const sources = discoverConfigurationSources({ root, runner })

    expect(renderedWithOverride).toBe(true)
    expect(sources[0].location).toContain(overrideFile)
    expect(sources[0].values?.get('REDIS_URL')).toBe('redis://override')
  })

  it('fails fast when Docker Compose returns malformed discovery output', () => {
    const root = temporaryDirectory()
    const runner: ConfigurationCommandRunner = (command, args) => {
      if (command === 'docker' && args[0] === 'info') return commandResult(0)
      if (command === 'docker' && args[0] === 'compose' && args[1] === 'ls') {
        return commandResult(0, 'not-json')
      }
      return commandResult(1)
    }

    expect(() => discoverConfigurationSources({ root, runner })).toThrow(
      'Docker Compose returned an invalid project list'
    )
  })

  it('fails fast when a Docker Compose project entry changes shape', () => {
    const root = temporaryDirectory()
    const runner: ConfigurationCommandRunner = (command, args) => {
      if (command === 'docker' && args[0] === 'info') return commandResult(0)
      if (command === 'docker' && args[0] === 'compose' && args[1] === 'ls') {
        return commandResult(0, JSON.stringify([{ Name: 'sim-without-config-files' }]))
      }
      return commandResult(1)
    }

    expect(() => discoverConfigurationSources({ root, runner })).toThrow(
      'Docker Compose returned an invalid project list'
    )
  })

  it('does not treat unrelated Docker tooling as a Sim configuration source', () => {
    const root = temporaryDirectory()
    const runner: ConfigurationCommandRunner = (command, args) => {
      if (command === 'docker' && args[0] === '--version') return commandResult(0)
      return commandResult(1)
    }

    const sources = discoverConfigurationSources({ root, runner })

    expect(sources).toHaveLength(0)
  })

  it('does not treat an unrelated Kubernetes context as a Sim configuration source', () => {
    const root = temporaryDirectory()
    const runner: ConfigurationCommandRunner = (command, args) => {
      if (command === 'kubectl' && args[0] === 'config') {
        return commandResult(0, 'production-cluster\n')
      }
      return commandResult(1)
    }

    const sources = discoverConfigurationSources({ root, runner })

    expect(sources).toHaveLength(0)
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

  it('reports a known Compose project as unknown when its containers cannot be enumerated', () => {
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
      if (command === 'docker' && args[0] === 'ps') return commandResult(1)
      return commandResult(1)
    }

    const sources = discoverConfigurationSources({ root, runner })

    expect(sources).toHaveLength(1)
    expect(sources[0].values).toBeNull()
    expect(sources[0].warning).toContain('could not be enumerated')
  })

  it('fails fast when a Helm release entry changes shape', () => {
    const root = temporaryDirectory()
    const runner: ConfigurationCommandRunner = (command, args) => {
      if (command === 'kubectl' && args[0] === 'config') {
        return commandResult(0, 'production-cluster\n')
      }
      if (command === 'helm' && args[0] === 'list') {
        return commandResult(0, JSON.stringify([{ name: 'sim-prod', namespace: 'production' }]))
      }
      return commandResult(1)
    }

    expect(() => discoverConfigurationSources({ root, runner })).toThrow(
      'Helm returned an invalid release list'
    )
  })
})

describe('parseComposeFileEnvironment', () => {
  it('does not inject root .env when the service has no env_file', () => {
    const values = parseComposeFileEnvironment(
      'services:\n  simstudio:\n    image: ghcr.io/simstudioai/simstudio:latest\n    environment:\n      - REDIS_URL=redis://redis:6379\n',
      new Map([['RESEND_API_KEY', 'must-not-be-injected']])
    )

    expect(values?.get('REDIS_URL')).toBe('redis://redis:6379')
    expect(values?.has('RESEND_API_KEY')).toBe(false)
  })

  it('returns unknown for unsupported inline environment syntax', () => {
    const values = parseComposeFileEnvironment(
      'services:\n  simstudio:\n    image: ghcr.io/simstudioai/simstudio:latest\n    env_file: .env\n    environment: { RESEND_API_KEY: override }\n',
      new Map([['RESEND_API_KEY', 'root-value']])
    )

    expect(values).toBeNull()
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
