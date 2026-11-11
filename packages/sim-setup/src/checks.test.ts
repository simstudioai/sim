import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { fakeRoot } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  return { fakeRoot: mkdtempSync(join(tmpdir(), 'sim-setup-checks-')) }
})

vi.mock('./context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./context')>()
  return { ...actual, SETUP_CONTEXT: { kind: 'source', root: fakeRoot } }
})

import { type CheckContext, loadCheckContext, runChecks } from './checks'
import type { EnvFile, EnvTarget } from './env-files'

function envFile(target: EnvTarget, values: Record<string, string> = {}): EnvFile {
  return {
    target,
    path: `${target}.env`,
    exists: target === 'root',
    content: '',
    vars: new Map(Object.entries(values)),
    verbatim: new Map(Object.entries(values)),
  }
}

function rootContext(values: Record<string, string>): CheckContext {
  const root = envFile('root', values)
  return {
    layout: 'root',
    primary: root,
    live: false,
    env: {
      root,
      sim: envFile('sim'),
      realtime: envFile('realtime'),
      db: envFile('db'),
    },
  }
}

describe('setup coherence checks', () => {
  it('requires a signing secret when native Slack triggers are enabled', async () => {
    const findings = await runChecks(
      rootContext({
        SLACK_EXTENDED_SCOPES: 'true',
        NEXT_PUBLIC_SLACK_EXTENDED_SCOPES: 'true',
      }),
      ['coherence']
    )

    expect(findings).toContainEqual({
      group: 'coherence',
      status: 'fail',
      message:
        'SLACK_EXTENDED_SCOPES is on but SLACK_SIGNING_SECRET is not set — native Slack triggers will fail at runtime',
      fix: 'set SLACK_SIGNING_SECRET or remove SLACK_EXTENDED_SCOPES and NEXT_PUBLIC_SLACK_EXTENDED_SCOPES',
    })
  })

  it('treats a whitespace-only Slack signing secret as missing', async () => {
    const findings = await runChecks(
      rootContext({
        SLACK_EXTENDED_SCOPES: 'true',
        NEXT_PUBLIC_SLACK_EXTENDED_SCOPES: 'true',
        SLACK_SIGNING_SECRET: '   ',
      }),
      ['coherence']
    )

    expect(findings).toContainEqual({
      group: 'coherence',
      status: 'fail',
      message:
        'SLACK_EXTENDED_SCOPES is on but SLACK_SIGNING_SECRET is not set — native Slack triggers will fail at runtime',
      fix: 'set SLACK_SIGNING_SECRET or remove SLACK_EXTENDED_SCOPES and NEXT_PUBLIC_SLACK_EXTENDED_SCOPES',
    })
  })
})

describe('doctor --fix on env files', () => {
  const files = {
    sim: path.join(fakeRoot, 'apps/sim/.env'),
    realtime: path.join(fakeRoot, 'apps/realtime/.env'),
    db: path.join(fakeRoot, 'packages/db/.env'),
  }

  function writeFiles(contents: Record<keyof typeof files, string>) {
    for (const [target, content] of Object.entries(contents)) {
      const file = files[target as keyof typeof files]
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, content)
    }
  }

  async function fix(groups: Parameters<typeof runChecks>[1]) {
    for (const finding of await runChecks(loadCheckContext(false), groups)) finding.autofix?.()
  }

  function nextLoads(file: string, key: string): string | undefined {
    const silent = { info: () => {}, error: () => {} }
    try {
      return loadEnvConfig(path.dirname(file), false, silent, true).parsedEnv?.[key]
    } finally {
      Reflect.deleteProperty(process.env, key)
    }
  }

  beforeEach(() => rmSync(fakeRoot, { recursive: true, force: true }))
  afterAll(() => rmSync(fakeRoot, { recursive: true, force: true }))

  it.each([
    ['a differing value', 'DATABASE_URL=postgresql://other@localhost/sim\n'],
    [
      'a reference an earlier fix escaped',
      'DATABASE_URL="postgresql://\\${DB_USER}@localhost/sim"\n',
    ],
  ])('mirrors a hand-written ${VAR} reference as a reference over %s', async (_, dbFile) => {
    const dsn = 'postgresql://${DB_USER}@localhost/sim'
    writeFiles({ sim: `DB_USER=alice\nDATABASE_URL=${dsn}\n`, realtime: '', db: dbFile })

    await fix(['consistency'])

    expect(readFileSync(files.db, 'utf8')).toBe(`DATABASE_URL=${dsn}\n`)
  })

  it('rewrites a single-quoted $ value so the app reads it literally', async () => {
    writeFiles({ sim: "SMTP_PASSWORD='pa$$word$HOME'\n", realtime: '', db: '' })

    await fix(['schema'])

    expect(nextLoads(files.sim, 'SMTP_PASSWORD')).toBe('pa$$word$HOME')
  })
})
