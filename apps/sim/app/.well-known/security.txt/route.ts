import { getBaseUrl } from '@/lib/core/utils/urls'

export async function GET() {
  const baseUrl = getBaseUrl()

  const expiresDate = new Date()
  expiresDate.setFullYear(expiresDate.getFullYear() + 1)
  const expires = expiresDate.toISOString()

  const securityTxt = `# Security Policy for Sim
# https://securitytxt.org/
# RFC 9116: https://www.rfc-editor.org/rfc/rfc9116.html

# Required: Contact information for security reports
Contact: mailto:security@sim.ai

# Required: When this file expires (ISO 8601 format, within 1 year)
Expires: ${expires}

# Preferred languages for security reports
Preferred-Languages: en

# Canonical URL for this security.txt file
Canonical: ${baseUrl}/.well-known/security.txt

# Link to security policy page
Policy: ${baseUrl}/security

# Acknowledgments page for security researchers
# Acknowledgments: ${baseUrl}/security/thanks

# If you discover a security vulnerability, please report it responsibly.
# We appreciate your help in keeping Sim and our users secure.
`

  return new Response(securityTxt, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
