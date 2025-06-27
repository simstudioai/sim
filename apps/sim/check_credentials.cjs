const { db } = require('./db')
const { account } = require('./db/schema')
const { eq, and } = require('drizzle-orm')

async function checkCredentials() {
  try {
    console.log('Checking Google credentials in database...')
    
    // Get all google-email credentials
    const googleEmailAccounts = await db
      .select()
      .from(account)
      .where(eq(account.providerId, 'google-email'))
    
    console.log(`Found ${googleEmailAccounts.length} google-email credentials:`)
    
    for (const acc of googleEmailAccounts) {
      console.log(`\nAccount ID: ${acc.id}`)
      console.log(`User ID: ${acc.userId}`)
      console.log(`Account ID: ${acc.accountId}`)
      console.log(`Provider: ${acc.providerId}`)
      console.log(`Access Token: ${acc.accessToken ? 'Present' : 'Missing'}`)
      console.log(`Refresh Token: ${acc.refreshToken ? 'Present' : 'Missing'}`)
      console.log(`Access Token Expires: ${acc.accessTokenExpiresAt}`)
      console.log(`Refresh Token Expires: ${acc.refreshTokenExpiresAt}`)
      console.log(`Scope: ${acc.scope}`)
      console.log(`Created: ${acc.createdAt}`)
      console.log(`Updated: ${acc.updatedAt}`)
    }
    
    // Also check for other Google providers
    const allGoogleAccounts = await db
      .select()
      .from(account)
      .where(account.providerId.like('google%'))
    
    console.log(`\nTotal Google accounts: ${allGoogleAccounts.length}`)
    const providers = [...new Set(allGoogleAccounts.map(acc => acc.providerId))]
    console.log('Google providers found:', providers)
    
  } catch (error) {
    console.error('Error checking credentials:', error)
  } finally {
    process.exit(0)
  }
}

checkCredentials() 