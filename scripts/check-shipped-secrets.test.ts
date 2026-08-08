import { describe, expect, it } from 'bun:test'
import { auditHandbuiltEnv, auditSource } from './check-shipped-secrets.ts'

const OLLAMA = 'docker-compose.ollama.yml'

const compose = (...environment: string[]) =>
  ['services:', '  app:', '    image: sim', '    environment:', ...environment].join('\n')

describe('check-shipped-secrets', () => {
  it('flags the $(...) default Compose emits verbatim', () => {
    const violations = auditSource(
      compose(
        '      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-sim_auth_secret_$(openssl rand -hex 16)}'
      ),
      OLLAMA
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].variable).toBe('BETTER_AUTH_SECRET')
    expect(violations[0].reason).toMatch(/shell syntax/)
  })

  it('flags a plain literal fallback for a secret', () => {
    const violations = auditSource(
      compose('      - ENCRYPTION_KEY=${ENCRYPTION_KEY:-hunter2hunter2hunter2hunter2hunt}'),
      OLLAMA
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].reason).toMatch(/fails closed/)
  })

  it('flags a shared default wherever it appears, not just under environment:', () => {
    const source = [
      'services:',
      '  app:',
      '    command: ["sh", "-c", "echo ${ENCRYPTION_KEY:-leaked}"]',
    ].join('\n')
    expect(auditSource(source, OLLAMA)).toHaveLength(1)
  })

  it('accepts the fail-closed form', () => {
    expect(
      auditSource(
        compose(
          "      - 'BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?is required. openssl rand -hex 32}'"
        ),
        OLLAMA
      )
    ).toEqual([])
  })

  it('accepts an empty fallback, which supplies no value', () => {
    expect(
      auditSource(compose('      - API_ENCRYPTION_KEY=${API_ENCRYPTION_KEY:-}'), OLLAMA)
    ).toEqual([])
  })

  it('ignores non-secret defaults and comments', () => {
    expect(
      auditSource(
        compose('      - NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}'),
        'docker-compose.prod.yml'
      )
    ).toEqual([])

    expect(
      auditSource(
        compose('      # - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-shared}'),
        'docker-compose.prod.yml'
      )
    ).toEqual([])
  })

  it('flags a hardcoded secret in hand-built container env', () => {
    const violations = auditHandbuiltEnv(
      "    'BETTER_AUTH_SECRET=your_auth_secret_here',",
      'packages/cli/src/index.ts'
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].variable).toBe('BETTER_AUTH_SECRET')
  })

  it('accepts hand-built env interpolating a generated value', () => {
    expect(
      auditHandbuiltEnv(
        '    `BETTER_AUTH_SECRET=${secrets.BETTER_AUTH_SECRET}`,',
        'packages/cli/src/index.ts'
      )
    ).toEqual([])
  })

  it('exempts dev-only files from the literal-fallback rule but never from shell syntax', () => {
    const literal = compose('      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-dev-secret-32-chars}')
    expect(auditSource(literal, 'docker-compose.local.yml')).toEqual([])
    expect(auditSource(literal, '.devcontainer/docker-compose.yml')).toEqual([])
    expect(auditSource(literal, OLLAMA)).toHaveLength(1)

    expect(
      auditSource(
        compose('      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-$(openssl rand -hex 16)}'),
        'docker-compose.local.yml'
      )
    ).toHaveLength(1)
  })
})
