import {
  connectOperatorDatabase,
  parseOperatorDatabaseUrl,
  SearchProjectionPurgeError,
} from '@sim/db/scripts/purge-search-projection'
import { describe, expect, it } from 'vitest'

const primary = 'postgresql://operator:secret@fixture.pg.psdb.cloud:5432/app'
const tls = 'sslmode=verify-full&sslrootcert=system'

describe('purge operator connection', () => {
  it.each([
    ['a missing URL', undefined],
    ['a non-PostgreSQL URL', 'mysql://operator:secret@fixture.pg.psdb.cloud:5432/app'],
    [
      'a URL without a database name',
      `postgresql://operator:secret@fixture.pg.psdb.cloud:5432/?${tls}`,
    ],
    ['a pooler port', `postgresql://operator:secret@fixture.pg.psdb.cloud:6432/app?${tls}`],
    [
      'a routed pooler role',
      `postgresql://operator%7Creplica:secret@fixture.pg.psdb.cloud:5432/app?${tls}`,
    ],
    ['an unverified host', `postgresql://operator:secret@db.fixture.test:5432/app?${tls}`],
    ['a primary without verified TLS', `${primary}?sslmode=require`],
    ['a connection override', `${primary}?${tls}&options=-c%20statement_timeout%3D0`],
    ['a loopback database without a test segment', 'postgresql://postgres@localhost:5432/app'],
  ])('refuses %s', (_, url) => {
    expect(() => parseOperatorDatabaseUrl(url)).toThrow(SearchProjectionPurgeError)
  })

  it('accepts a verified primary and a loopback test fixture', () => {
    expect(parseOperatorDatabaseUrl(`${primary}?${tls}`).hosted).toBe(true)
    expect(parseOperatorDatabaseUrl('postgresql://postgres@localhost:5432/sim_test').hosted).toBe(
      false
    )
  })

  it('sends no TLS URL parameter as a startup parameter, enforcing it as ssl instead', async () => {
    const sql = connectOperatorDatabase(`${primary}?${tls}`)
    try {
      expect(sql.options.ssl).toBe('verify-full')
      expect(Object.keys(sql.options.connection)).not.toContain('sslrootcert')
      expect(Object.keys(sql.options.connection)).not.toContain('sslmode')
    } finally {
      await sql.end()
    }
  })
})
