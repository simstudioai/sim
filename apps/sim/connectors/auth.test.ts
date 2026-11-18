import { describe, expect, it } from 'vitest'
import {
  connectorHasAuthSource,
  connectorUsesCredential,
  getConnectorCredentialService,
  isConnectorCredentialTypeAllowed,
} from '@/connectors/auth'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import { databricksConnectorMeta } from '@/connectors/databricks/meta'
import { githubConnectorMeta } from '@/connectors/github/meta'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'
import { s3ConnectorMeta } from '@/connectors/s3/meta'

describe('connector credential eligibility', () => {
  it.each([confluenceConnectorMeta, googleDriveConnectorMeta])(
    'requires a service account for $name central indexing and preserves member and workspace OAuth',
    ({ auth }) => {
      expect(isConnectorCredentialTypeAllowed(auth, 'admin', 'oauth')).toBe(false)
      expect(isConnectorCredentialTypeAllowed(auth, 'admin', undefined)).toBe(false)
      expect(isConnectorCredentialTypeAllowed(auth, 'admin', 'service_account')).toBe(true)
      expect(isConnectorCredentialTypeAllowed(auth, 'members', 'oauth')).toBe(true)
      expect(isConnectorCredentialTypeAllowed(auth, 'workspace', 'oauth')).toBe(true)
    }
  )

  it.each(['admin', 'members', 'workspace'] as const)(
    'never stores a managed browsing credential as the %s indexing account',
    (mode) => {
      expect(
        isConnectorCredentialTypeAllowed(confluenceConnectorMeta.auth, mode, 'managed_oauth')
      ).toBe(false)
    }
  )
})

describe('connector auth source', () => {
  const s3Auth = s3ConnectorMeta.auth
  const keyOnlyAuth = databricksConnectorMeta.auth

  it('keeps a stored-key S3 connector on its key', () => {
    const row = { credentialId: null, encryptedApiKey: 'encrypted-key' }
    expect(connectorUsesCredential(s3Auth, row)).toBe(false)
    expect(connectorHasAuthSource(s3Auth, row)).toBe(true)
  })

  it('authenticates an S3 connector that names a saved credential with that credential', () => {
    const row = { credentialId: 'credential-1', encryptedApiKey: null }
    expect(connectorUsesCredential(s3Auth, row)).toBe(true)
    expect(connectorHasAuthSource(s3Auth, row)).toBe(true)
  })

  it('treats an S3 connector whose credential was removed as needing reconnection', () => {
    expect(connectorHasAuthSource(s3Auth, { credentialId: null, encryptedApiKey: null })).toBe(
      false
    )
  })

  it('never routes a key-only connector to a credential it does not accept', () => {
    const row = { credentialId: 'credential-1', encryptedApiKey: 'encrypted-key' }
    expect(connectorUsesCredential(keyOnlyAuth, row)).toBe(false)
    expect(getConnectorCredentialService(keyOnlyAuth)).toBeUndefined()
  })

  it('keeps an OAuth connector with a token alternative on the token it stored', () => {
    expect(
      connectorUsesCredential(githubConnectorMeta.auth, {
        credentialId: null,
        encryptedApiKey: 'encrypted-token',
      })
    ).toBe(false)
    expect(
      connectorUsesCredential(githubConnectorMeta.auth, {
        credentialId: 'credential-1',
        encryptedApiKey: null,
      })
    ).toBe(true)
  })
})
