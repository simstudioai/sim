import { describe, expect, it } from 'vitest'
import type { ConfigurationSource } from './configuration-sources'
import { buildSetupStatusReport, renderSetupStatusReport } from './setup-status'

function source(values: Record<string, string>): ConfigurationSource {
  return {
    kind: 'dev',
    label: 'Local dev',
    location: 'apps/sim/.env',
    values: new Map(Object.entries(values)),
    managedByCurrentCheckout: true,
  }
}

const CORE_VALUES = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/sim',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  ENCRYPTION_KEY: 'b'.repeat(64),
  INTERNAL_API_SECRET: 'c'.repeat(32),
}

describe('setup status', () => {
  it('renders providers and missing integrations without exposing configured values', () => {
    const report = buildSetupStatusReport(
      source({
        ...CORE_VALUES,
        RESEND_API_KEY: 'resend-super-secret',
        SLACK_CLIENT_ID: 'slack-client-secret-value',
        SLACK_CLIENT_SECRET: 'slack-client-secret',
      })
    )
    const output = renderSetupStatusReport(report)

    expect(report.failed).toBe(false)
    expect(output).toContain('Email delivery: Resend')
    expect(output).toContain('OAuth ready')
    expect(output).toContain('Slack')
    expect(output).toContain('Unavailable')
    expect(output).not.toContain('resend-super-secret')
    expect(output).not.toContain('slack-client-secret-value')
    expect(output).not.toContain('slack-client-secret')
    expect(report.source).not.toHaveProperty('values')
  })

  it('fails on partial configuration while continuing to render other capabilities', () => {
    const report = buildSetupStatusReport(
      source({
        ...CORE_VALUES,
        SMTP_HOST: 'localhost',
        MICROSOFT_CLIENT_ID: 'partial-client',
      })
    )
    const output = renderSetupStatusReport(report)

    expect(report.failed).toBe(true)
    expect(output).toContain('Email delivery: Not configured')
    expect(output).toContain('SMTP_PORT')
    expect(output).toContain('Misconfigured')
    expect(output).toContain('MICROSOFT_CLIENT_SECRET')
    expect(output).not.toContain('partial-client')
  })

  it('warns about an incomplete email fallback without failing a configured provider', () => {
    const report = buildSetupStatusReport(
      source({
        ...CORE_VALUES,
        RESEND_API_KEY: 'resend-super-secret',
        SMTP_HOST: 'localhost',
      })
    )
    const output = renderSetupStatusReport(report)

    expect(report.failed).toBe(false)
    expect(report.capabilityStatus?.features.email.state).toBe('configured')
    expect(output).toContain('Email delivery: Resend')
    expect(output).toContain('SMTP_PORT')
    expect(output).toContain('configure: npx sim-setup add email')
    expect(output).not.toContain('Run npx sim-setup add email')
    expect(output).not.toContain('resend-super-secret')
  })

  it('marks an unreadable effective source unknown instead of missing', () => {
    const unknown: ConfigurationSource = {
      kind: 'helm',
      label: 'Helm release sim',
      location: 'context prod · namespace sim',
      values: null,
      warning: 'cannot read app Secret',
      managedByCurrentCheckout: false,
    }
    const report = buildSetupStatusReport(unknown)
    const output = renderSetupStatusReport(report)

    expect(report.failed).toBe(true)
    expect(output).toContain('Effective environment is unavailable')
    expect(output).not.toContain('Not configured')
  })

  it('fails on a partial OAuth client even when it is not in the visible catalog', () => {
    const report = buildSetupStatusReport(
      source({
        ...CORE_VALUES,
        SPOTIFY_CLIENT_ID: 'partial-client-value',
      })
    )
    const output = renderSetupStatusReport(report)

    expect(report.failed).toBe(true)
    expect(output).toContain('Spotify OAuth client: partial')
    expect(output).toContain('SPOTIFY_CLIENT_SECRET')
    expect(output).not.toContain('partial-client-value')
  })

  it('names fields missing from an explicitly selected storage provider', () => {
    const report = buildSetupStatusReport(
      source({
        ...CORE_VALUES,
        STORAGE_PROVIDER: 's3',
        AWS_REGION: 'us-east-1',
      })
    )
    const output = renderSetupStatusReport(report)

    expect(report.failed).toBe(true)
    expect(output).toContain('S3_BUCKET_NAME')
  })

  it('fails on missing split-development files without retaining source values', () => {
    const development = source(CORE_VALUES)
    development.configurationIssues = ['apps/realtime/.env is missing']

    const report = buildSetupStatusReport(development)
    const output = renderSetupStatusReport(report)

    expect(report.failed).toBe(true)
    expect(output).toContain('apps/realtime/.env is missing')
    expect(report.source).not.toHaveProperty('values')
  })
})
