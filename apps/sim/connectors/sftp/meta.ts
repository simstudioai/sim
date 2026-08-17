import { SftpIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const sftpConnectorMeta: ConnectorMeta = {
  id: 'sftp',
  name: 'SFTP',
  description:
    'Sync text-based files from a remote SFTP (SSH File Transfer Protocol) directory tree into your knowledge base',
  version: '2.0.0',
  icon: SftpIcon,

  auth: {
    mode: 'apiKey',
    label: 'Password or Private Key',
    placeholder: 'Password, or paste an unencrypted OpenSSH private key',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'e.g. sftp.example.com',
      required: true,
      description:
        'Hostname of the SFTP server. Private, loopback, and link-local addresses are rejected.',
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '22',
      required: false,
      description: 'SSH port. Defaults to 22.',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'e.g. sftp-user',
      required: true,
    },
    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Password', id: 'password' },
        { label: 'Private Key', id: 'privateKey' },
      ],
      description:
        'How the secret above is interpreted. Private keys must be unencrypted (no passphrase).',
    },
    {
      id: 'hostFingerprint',
      title: 'Host Key Fingerprint',
      type: 'short-input',
      placeholder: 'e.g. SHA256:abc123...',
      required: true,
      description:
        'Required. Expected SHA-256 host key fingerprint, pinned so the server is identified before any credential is sent. Get it with "ssh-keyscan -t rsa,ecdsa,ed25519 <host> | ssh-keygen -lf -" and paste the SHA256:... value. Without a pin, SSH accepts whatever host key answers, so an on-path attacker impersonating the server would be handed your password or private key. A mismatch refuses the connection.',
    },
    {
      id: 'rootPath',
      title: 'Root Path',
      type: 'short-input',
      placeholder: 'e.g. /home/sftp-user/docs',
      required: true,
      description: 'Absolute remote directory to sync. Only files under this path are indexed.',
    },
    {
      id: 'extensions',
      title: 'File Extensions',
      type: 'short-input',
      placeholder: 'e.g. txt, md, csv (optional)',
      required: false,
      description:
        'Comma-separated list of file extensions to sync. Leave blank to use the built-in text formats.',
    },
    {
      id: 'maxDepth',
      title: 'Max Directory Depth',
      type: 'short-input',
      placeholder: 'e.g. 5 (default: 5, max: 10)',
      required: false,
      description: 'How many directory levels below the root path to walk.',
    },
    {
      id: 'maxFiles',
      title: 'Max Files',
      type: 'short-input',
      placeholder: 'e.g. 2000 (default: 2000, max: 10000)',
      required: false,
      description: 'Stop syncing after this many files.',
    },
  ],

  tagDefinitions: [
    { id: 'directory', displayName: 'Folder', fieldType: 'text' },
    { id: 'extension', displayName: 'Extension', fieldType: 'text' },
    { id: 'fileSize', displayName: 'Size (bytes)', fieldType: 'number' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
