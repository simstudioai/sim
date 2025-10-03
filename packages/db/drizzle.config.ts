import type { Config } from 'drizzle-kit'

const getSSLConfig = () => {
  const sslMode = process.env.DATABASE_SSL?.toLowerCase()

  if (!sslMode || sslMode === 'disable') {
    return undefined
  }

  if (sslMode === 'prefer') {
    return 'prefer' as const
  }

  const sslConfig: any = {}

  if (sslMode === 'require') {
    sslConfig.rejectUnauthorized = false
  } else if (sslMode === 'verify-ca' || sslMode === 'verify-full') {
    sslConfig.rejectUnauthorized = true
    if (process.env.DATABASE_SSL_CA) {
      try {
        const ca = Buffer.from(process.env.DATABASE_SSL_CA, 'base64').toString('utf-8')
        sslConfig.ca = ca
      } catch (error) {
        console.error('Failed to parse DATABASE_SSL_CA:', error)
      }
    }
  }

  return sslConfig
}

const sslConfig = getSSLConfig()

export default {
  schema: './schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ...(sslConfig !== undefined && { ssl: sslConfig }),
  },
} satisfies Config
