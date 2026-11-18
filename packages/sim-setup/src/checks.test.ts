import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
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
import { type EnvFile, type EnvTarget, parseEnv } from './env-files'

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
  const referencingDsn = `postgresql://\${DB_USER}@localhost/sim`

  function writeFiles(contents: Record<keyof typeof files, string>) {
    for (const [target, content] of Object.entries(contents)) {
      const file = files[target as keyof typeof files]
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, content)
    }
  }

  async function fixConsistency() {
    const findings = await runChecks(loadCheckContext(false), ['consistency'])
    for (const finding of findings) finding.autofix?.()
    return findings.find((finding) => finding.message.startsWith('DATABASE_URL differs'))
  }

  beforeEach(() => rmSync(fakeRoot, { recursive: true, force: true }))
  afterAll(() => rmSync(fakeRoot, { recursive: true, force: true }))

  it.each([
    ['a different URL', 'DATABASE_URL=postgresql://other@localhost/sim\n'],
    [
      'the reference escaped into a literal',
      `DATABASE_URL="postgresql://\\\${DB_USER}@localhost/sim"\n`,
    ],
  ])('reports a $VAR DATABASE_URL against %s and leaves it for a hand copy', async (_, dbFile) => {
    writeFiles({
      sim: `DB_USER=alice\nDATABASE_URL=${referencingDsn}\n`,
      realtime: '',
      db: dbFile,
    })

    const finding = await fixConsistency()

    expect(finding).toMatchObject({ status: 'fail', autofix: undefined })
    expect(readFileSync(files.db, 'utf8')).toBe(dbFile)
  })

  it.each([
    ['missing', 'DATABASE_URL=postgresql://localhost/sim\n'],
    ['a placeholder', 'BETTER_AUTH_SECRET=your_auth_secret_here\n'],
  ])(
    'never generates a shared secret it cannot copy when realtime has it %s',
    async (_, realtime) => {
      const secret = `BETTER_AUTH_SECRET=\${AUTH_SECRET_BASE}0123456789abcdef0123456789abcdef`
      writeFiles({ sim: `${secret}\n`, realtime, db: '' })

      for (const finding of await runChecks(loadCheckContext(false), ['schema']))
        finding.autofix?.()

      const after = parseEnv(readFileSync(files.realtime, 'utf8')).get('BETTER_AUTH_SECRET')
      expect(after).toBe(parseEnv(realtime).get('BETTER_AUTH_SECRET'))
    }
  )

  it('reports a value it cannot write instead of aborting the other fixes', async () => {
    const unwritable = 'DATABASE_URL="postgresql://u:p\\$x\\y@localhost/sim"\n'
    const dbFile = 'DATABASE_URL=postgresql://other@localhost/sim\n'
    writeFiles({ sim: unwritable, realtime: '', db: dbFile })

    const finding = await fixConsistency()

    expect(finding).toMatchObject({ status: 'fail', autofix: undefined })
    expect(readFileSync(files.db, 'utf8')).toBe(dbFile)
  })

  it('accepts a $VAR DATABASE_URL written the same way in both files', async () => {
    const line = `DATABASE_URL=${referencingDsn}\n`
    writeFiles({ sim: `DB_USER=alice\n${line}`, realtime: '', db: line })

    expect(await fixConsistency()).toBeUndefined()
  })
})
