import { describe, expect, it } from 'vitest'
import { type CheckContext, runChecks } from './checks'
import type { EnvFile, EnvTarget } from './env-files'

function envFile(target: EnvTarget, values: Record<string, string> = {}): EnvFile {
  return {
    target,
    path: `${target}.env`,
    exists: target === 'root',
    content: '',
    vars: new Map(Object.entries(values)),
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

  it('does not require a signing secret for outbound-only Slack OAuth', async () => {
    const findings = await runChecks(
      rootContext({
        SLACK_CLIENT_ID: 'client-id',
        SLACK_CLIENT_SECRET: 'client-secret',
      }),
      ['coherence']
    )

    expect(findings.some((finding) => finding.message.includes('SLACK_SIGNING_SECRET'))).toBe(false)
  })
})
