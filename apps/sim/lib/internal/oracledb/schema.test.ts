/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { oracleConnectionInputSchema, oracleQueryInputSchema } from '@/lib/internal/oracledb/schema'

const CONNECTION = {
  host: 'db.example.com',
  port: 1521,
  protocol: 'tcp',
  connectionType: 'serviceName',
  serviceName: 'FREEPDB1',
  username: 'application',
  password: 'secret',
  connectionTimeout: 15000,
} as const

describe('Oracle Database input schemas', () => {
  it('applies connection defaults and enforces exactly one identifier', () => {
    expect(
      oracleConnectionInputSchema.parse({
        host: 'db.example.com',
        serviceName: 'FREEPDB1',
        username: 'application',
        password: 'secret',
      })
    ).toMatchObject({ port: 1521, protocol: 'tcp', connectionType: 'serviceName' })

    expect(oracleConnectionInputSchema.safeParse({ ...CONNECTION, sid: 'ORCL' }).success).toBe(
      false
    )
    expect(
      oracleConnectionInputSchema.safeParse({
        ...CONNECTION,
        connectionType: 'sid',
        serviceName: undefined,
      }).success
    ).toBe(false)
  })

  it('accepts a simple PEM wallet only with TCPS', () => {
    const walletContent = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'
    expect(oracleConnectionInputSchema.safeParse({ ...CONNECTION, walletContent }).success).toBe(
      false
    )
    expect(
      oracleConnectionInputSchema.safeParse({
        ...CONNECTION,
        protocol: 'tcps',
        walletContent,
        walletPassword: 'wallet-secret',
      }).success
    ).toBe(true)
  })

  it('allows only named string, finite-number, and null binds', () => {
    expect(
      oracleQueryInputSchema.safeParse({
        ...CONNECTION,
        query: 'SELECT :id FROM DUAL',
        binds: { id: 42, label: 'value', missing: null },
      }).success
    ).toBe(true)
    expect(
      oracleQueryInputSchema.safeParse({
        ...CONNECTION,
        query: 'SELECT :enabled FROM DUAL',
        binds: { enabled: true },
      }).success
    ).toBe(false)
    expect(
      oracleQueryInputSchema.safeParse({
        ...CONNECTION,
        query: 'SELECT :nested FROM DUAL',
        binds: { nested: { value: 1 } },
      }).success
    ).toBe(false)
  })

  it('rejects descriptor injection and oversized wallet content', () => {
    expect(
      oracleConnectionInputSchema.safeParse({
        ...CONNECTION,
        serviceName: 'FREEPDB1)(ADDRESS=(HOST=169.254.169.254))',
      }).success
    ).toBe(false)
    const walletContent = `-----BEGIN CERTIFICATE-----\n${'a'.repeat(1024 * 1024)}\n-----END CERTIFICATE-----`
    expect(
      oracleConnectionInputSchema.safeParse({
        ...CONNECTION,
        protocol: 'tcps',
        walletContent,
      }).success
    ).toBe(false)
  })
})
