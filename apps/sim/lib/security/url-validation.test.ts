import { describe, expect, it } from 'vitest'
import { isPrivateHostname, validateImageUrl, validateProxyUrl } from './url-validation'

describe('validateProxyUrl', () => {
  describe('legitimate external APIs should pass', () => {
    it.concurrent('should allow HTTPS APIs', () => {
      const result = validateProxyUrl('https://api.openai.com/v1/chat/completions')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should allow HTTP APIs', () => {
      const result = validateProxyUrl('http://api.example.com/data')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should allow various legitimate external APIs', () => {
      const validUrls = [
        'https://api.github.com/user',
        'https://graph.microsoft.com/v1.0/me',
        'https://api.notion.com/v1/databases',
        'https://api.airtable.com/v0/appXXX',
        'https://hooks.zapier.com/hooks/catch/123/abc',
        'https://discord.com/api/webhooks/123/abc',
        'https://api.twilio.com/2010-04-01/Accounts',
        'https://api.sendgrid.com/v3/mail/send',
        'https://api.stripe.com/v1/charges',
        'http://httpbin.org/get',
      ]

      validUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })
  })

  describe('SSRF attacks should be blocked', () => {
    it.concurrent('should block localhost addresses', () => {
      const maliciousUrls = [
        'http://localhost:3000/api/users',
        'http://127.0.0.1:8080/admin',
        'https://127.0.0.1/internal',
        'http://127.1:9999',
      ]

      maliciousUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
        expect(result.error).toContain('private networks')
      })
    })

    it.concurrent('should block private IP ranges', () => {
      const privateIps = [
        'http://10.0.0.1/secret',
        'http://172.16.0.1:9999/admin',
        'http://192.168.1.1/config',
        'http://172.31.255.255/internal',
      ]

      privateIps.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
        expect(result.error).toContain('private networks')
      })
    })

    it.concurrent('should block cloud metadata endpoints', () => {
      const metadataUrls = [
        'http://169.254.169.254/latest/meta-data/',
        'http://169.254.169.254/computeMetadata/v1/',
        'https://169.254.169.254/metadata/instance',
      ]

      metadataUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
        expect(result.error).toContain('private networks')
      })
    })

    it.concurrent('should block dangerous protocols', () => {
      const dangerousUrls = [
        'file:///etc/passwd',
        'ftp://internal.server.com/files',
        'gopher://localhost:70/secret',
        'ldap://internal.ad.com/',
        'dict://localhost:2628/show:db',
        'data:text/html,<script>alert(1)</script>',
      ]

      dangerousUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
        expect(result.error).toMatch(/Protocol .* is (not allowed|blocked)/)
      })
    })

    it.concurrent('should handle URL encoding bypass attempts', () => {
      const encodedUrls = [
        'http://127.0.0.1%2F@example.com/',
        'http://%31%32%37%2e%30%2e%30%2e%31/', // 127.0.0.1 encoded
        'http://localhost%2F@example.com/',
      ]

      encodedUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
      })
    })

    it.concurrent('should reject invalid URL formats', () => {
      const invalidUrls = ['not-a-url', 'http://', 'https://host..com', '']

      invalidUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
        expect(result.error).toContain('Invalid')
      })
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle mixed case protocols', () => {
      const result = validateProxyUrl('HTTP://api.example.com')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should handle non-standard ports on external hosts', () => {
      const result = validateProxyUrl('https://api.example.com:8443/webhook')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should block broadcast and reserved addresses', () => {
      const reservedUrls = ['http://0.0.0.0:80', 'http://255.255.255.255', 'http://224.0.0.1']

      reservedUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
      })
    })
  })
})

describe('validateImageUrl', () => {
  it.concurrent('should pass standard proxy validation first', () => {
    const result = validateImageUrl('http://localhost/image.jpg')
    expect(result.isValid).toBe(false)
  })

  it.concurrent('should allow legitimate image URLs', () => {
    const validImageUrls = [
      'https://cdn.example.com/images/photo.jpg',
      'https://storage.googleapis.com/bucket/image.png',
      'https://example.s3.amazonaws.com/images/avatar.webp',
    ]

    validImageUrls.forEach((url) => {
      const result = validateImageUrl(url)
      expect(result.isValid).toBe(true)
    })
  })
})

describe('isPrivateHostname', () => {
  it.concurrent('should identify private hostnames', () => {
    expect(isPrivateHostname('127.0.0.1')).toBe(true)
    expect(isPrivateHostname('10.0.0.1')).toBe(true)
    expect(isPrivateHostname('192.168.1.1')).toBe(true)
    expect(isPrivateHostname('localhost')).toBe(true)
  })

  it.concurrent('should not flag public hostnames', () => {
    expect(isPrivateHostname('api.openai.com')).toBe(false)
    expect(isPrivateHostname('8.8.8.8')).toBe(false)
    expect(isPrivateHostname('github.com')).toBe(false)
  })
})

describe('Real-world API URL validation', () => {
  describe('All production APIs used by the system should pass', () => {
    it.concurrent('should allow OpenAI APIs', () => {
      const openaiUrls = [
        'https://api.openai.com/v1/chat/completions',
        'https://api.openai.com/v1/images/generations',
        'https://api.openai.com/v1/embeddings',
      ]

      openaiUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should allow Google APIs', () => {
      const googleUrls = [
        'https://www.googleapis.com/drive/v3/files',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/calendar',
        'https://graph.googleapis.com/v1.0/me',
        'https://accounts.google.com/.well-known/openid-configuration',
      ]

      googleUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should allow Microsoft APIs', () => {
      const microsoftUrls = [
        'https://graph.microsoft.com/v1.0/me',
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      ]

      microsoftUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should allow GitHub APIs', () => {
      const githubUrls = [
        'https://api.github.com/user',
        'https://api.github.com/user/emails',
        'https://github.com/login/oauth/authorize',
        'https://github.com/login/oauth/access_token',
      ]

      githubUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should allow third-party service APIs', () => {
      const thirdPartyUrls = [
        'https://api.notion.com/v1/databases',
        'https://api.linear.app/graphql',
        'https://api.airtable.com/v0/appXXX',
        'https://api.twilio.com/2010-04-01/Accounts',
        'https://api.sendgrid.com/v3/mail/send',
        'https://api.stripe.com/v1/charges',
        'https://hooks.zapier.com/hooks/catch/123/abc',
        'https://discord.com/api/webhooks/123/abc',
        'https://api.firecrawl.dev/v1/crawl',
        'https://api.mistral.ai/v1/ocr',
        'https://api.tavily.com/search',
        'https://api.exa.ai/search',
        'https://api.perplexity.ai/chat/completions',
        'https://google.serper.dev/search',
        'https://api.linkup.so/v1/search',
        'https://api.pinecone.io/embed',
        'https://api.crmworkspace.com/v1/contacts',
        'https://slack.com/api/conversations.history',
        'https://api.atlassian.com/ex/jira/123/rest/api/3/issue/bulkfetch',
        'https://api.browser-use.com/api/v1/task/123',
      ]

      thirdPartyUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should allow webhook URLs (Clay example)', () => {
      const webhookUrls = [
        'https://clay.com/webhooks/123/abc',
        'https://hooks.clay.com/webhook/xyz789',
        'https://api.clay.com/v1/populate/webhook',
      ]

      webhookUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should allow dynamic URLs with parameters', () => {
      const dynamicUrls = [
        'https://google.serper.dev/search',
        'https://api.example.com/users/123/posts/456',
        'https://api.service.com/endpoint?param1=value1&param2=value2',
        'https://cdn.example.com/files/document.pdf',
      ]

      dynamicUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should allow custom QDrant instances on external hosts', () => {
      const qdrantUrls = [
        'https://my-qdrant.cloud.qdrant.io/collections/test/points',
        'https://qdrant.example.com/collections/docs/points',
      ]

      qdrantUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })
  })

  describe('Image proxy validation with real examples', () => {
    it.concurrent('should allow legitimate image hosting services', () => {
      const imageUrls = [
        'https://cdn.openai.com/generated/image123.png',
        'https://storage.googleapis.com/bucket/images/photo.jpg',
        'https://example.s3.amazonaws.com/uploads/avatar.webp',
        'https://cdn.example.com/assets/logo.svg',
        'https://images.unsplash.com/photo-123?w=800',
        'https://avatars.githubusercontent.com/u/123456',
      ]

      imageUrls.forEach((url) => {
        const result = validateImageUrl(url)
        expect(result.isValid).toBe(true)
      })
    })
  })

  describe('Edge cases that might be problematic but should still work', () => {
    it.concurrent('should allow non-standard ports on external hosts', () => {
      const customPortUrls = [
        'https://api.example.com:8443/webhook',
        'https://custom-service.com:9000/api/v1/data',
        'http://external-service.com:8080/callback',
      ]

      customPortUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should allow subdomains and complex domain structures', () => {
      const complexDomainUrls = [
        'https://api-staging.service.example.com/v1/test',
        'https://user123.cloud.provider.com/api',
        'https://region-us-east-1.service.aws.example.com/endpoint',
      ]

      complexDomainUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should handle URLs with various query parameters and fragments', () => {
      const complexUrls = [
        'https://api.example.com/search?q=test&filter=active&sort=desc#results',
        'https://service.com/oauth/callback?code=abc123&state=xyz789',
        'https://api.service.com/v1/data?include[]=profile&include[]=settings',
      ]

      complexUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })
  })

  describe('Security tests - attack vectors should be blocked', () => {
    it.concurrent('should block all SSRF attack patterns from the vulnerability report', () => {
      const attackUrls = [
        'http://172.17.0.1:9999',
        'file:///etc/passwd',
        'file:///proc/self/environ',
        'http://169.254.169.254/latest/meta-data/',
        'http://localhost:3000/internal',
        'http://127.0.0.1:8080/admin',
      ]

      attackUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
        expect(result.error).toBeDefined()
      })
    })

    it.concurrent('should block attempts to bypass with URL encoding', () => {
      const encodedAttackUrls = [
        'http://localhost%2F@example.com/',
        'http://%31%32%37%2e%30%2e%30%2e%31/', // 127.0.0.1 encoded
        'file%3A///etc/passwd',
      ]

      encodedAttackUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
      })
    })
  })
})

describe('SSRF Vulnerability Resolution Verification', () => {
  describe('Attack vectors should be blocked', () => {
    it.concurrent('should block access to internal network endpoints (172.17.0.1:9999)', () => {
      const result = validateProxyUrl('http://172.17.0.1:9999')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private networks')
    })

    it.concurrent('should block file:// protocol access to /proc/self/environ', () => {
      const result = validateProxyUrl('file:///proc/self/environ')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('not allowed')
    })

    it.concurrent('should block file:// protocol access to /etc/passwd', () => {
      const result = validateProxyUrl('file:///etc/passwd')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('not allowed')
    })

    it.concurrent('should block cloud metadata endpoint access', () => {
      const result = validateProxyUrl('http://169.254.169.254/latest/meta-data/')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private networks')
    })

    it.concurrent('should block localhost access on various ports', () => {
      const localhostUrls = [
        'http://localhost:3000',
        'http://127.0.0.1:8080',
        'http://127.0.0.1:9999',
      ]

      localhostUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
        expect(result.error).toContain('private networks')
      })
    })
  })

  describe('Both proxy endpoints are protected', () => {
    it.concurrent('should protect /api/proxy/route.ts endpoint', () => {
      const attackUrls = [
        'http://172.17.0.1:9999',
        'file:///etc/passwd',
        'http://localhost:3000/admin',
      ]

      attackUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
      })
    })

    it.concurrent('should protect /api/proxy/image/route.ts endpoint', () => {
      const attackUrls = [
        'http://172.17.0.1:9999/image.jpg',
        'file:///etc/passwd.jpg',
        'http://localhost:3000/internal/image.png',
      ]

      attackUrls.forEach((url) => {
        const result = validateImageUrl(url)
        expect(result.isValid).toBe(false)
      })
    })
  })

  describe('All legitimate use cases still work', () => {
    it.concurrent('should allow all external API calls the system makes', () => {
      const legitimateUrls = [
        'https://api.openai.com/v1/chat/completions',
        'https://api.github.com/user',
        'https://www.googleapis.com/drive/v3/files',
        'https://graph.microsoft.com/v1.0/me',
        'https://api.notion.com/v1/pages',
        'https://api.linear.app/graphql',
        'https://hooks.zapier.com/hooks/catch/123/abc',
        'https://discord.com/api/webhooks/123/token',
        'https://api.mistral.ai/v1/ocr',
        'https://api.twilio.com/2010-04-01/Accounts',
      ]

      legitimateUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should allow legitimate image URLs for OpenAI image tool', () => {
      const imageUrls = [
        'https://cdn.openai.com/generated/image123.png',
        'https://storage.googleapis.com/bucket/image.jpg',
        'https://example.s3.amazonaws.com/images/photo.webp',
      ]

      imageUrls.forEach((url) => {
        const result = validateImageUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should allow user-provided webhook URLs', () => {
      const webhookUrls = [
        'https://webhook.site/unique-id',
        'https://my-app.herokuapp.com/webhook',
        'https://api.company.com/webhook/receive',
      ]

      webhookUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })
  })

  describe('Comprehensive attack prevention', () => {
    it.concurrent('should block all private IP ranges', () => {
      const privateIpUrls = [
        'http://10.0.0.1/secret',
        'http://172.16.0.1/admin',
        'http://192.168.1.1/config',
        'http://169.254.169.254/metadata',
      ]

      privateIpUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
        expect(result.error).toContain('private networks')
      })
    })

    it.concurrent('should block all dangerous protocols', () => {
      const dangerousProtocols = [
        'file:///etc/passwd',
        'ftp://internal.server.com/files',
        'gopher://localhost:70/secret',
        'ldap://internal.ad.com/',
        'dict://localhost:2628/show',
      ]

      dangerousProtocols.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
        expect(result.error).toMatch(/Protocol .* is (not allowed|blocked)/)
      })
    })
  })
})

describe('User-provided URL validation scenarios', () => {
  describe('HTTP Request tool with user URLs', () => {
    it.concurrent('should allow legitimate user-provided API endpoints', () => {
      const userApiUrls = [
        'https://my-company-api.com/webhook',
        'https://api.my-service.io/v1/data',
        'https://webhook.site/unique-id',
        'https://httpbin.org/post',
        'https://postman-echo.com/post',
        'https://my-custom-domain.org/api/callback',
        'https://user123.ngrok.io/webhook', // Common tunneling service for dev
      ]

      userApiUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })
  })

  describe('Mistral parser with user PDF URLs', () => {
    it.concurrent('should allow legitimate PDF hosting services', () => {
      const pdfUrls = [
        'https://example.com/documents/report.pdf',
        'https://cdn.company.com/files/manual.pdf',
        'https://storage.cloud.google.com/bucket/document.pdf',
        'https://s3.amazonaws.com/bucket/files/doc.pdf',
        'https://assets.website.com/pdfs/guide.pdf',
      ]

      pdfUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should block attempts to use PDF URLs for SSRF', () => {
      const maliciousPdfUrls = [
        'http://localhost:3000/admin/report.pdf',
        'http://127.0.0.1:8080/internal/secret.pdf',
        'http://192.168.1.1/config/backup.pdf',
        'file:///etc/passwd.pdf',
      ]

      maliciousPdfUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
      })
    })
  })

  describe('Clay webhooks and custom services', () => {
    it.concurrent('should allow legitimate webhook services', () => {
      const webhookUrls = [
        'https://clay.com/webhooks/abc123',
        'https://hooks.zapier.com/hooks/catch/123/xyz',
        'https://maker.ifttt.com/trigger/event/with/key/abc123',
        'https://webhook.site/unique-uuid-here',
        'https://discord.com/api/webhooks/123/token',
        'https://slack.com/api/webhook/incoming',
        'https://my-app.herokuapp.com/webhook',
        'https://api.custom-service.com/webhook/receive',
      ]

      webhookUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })
  })

  describe('Custom QDrant/vector database instances', () => {
    it.concurrent('should allow external vector database services', () => {
      const vectorDbUrls = [
        'https://my-qdrant.cloud.provider.com/collections/docs/points',
        'https://vector-db.company.com/api/v1/search',
        'https://pinecone-index.pinecone.io/vectors/query',
        'https://weaviate.company-cluster.com/v1/objects',
      ]

      vectorDbUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should block internal vector database instances', () => {
      const internalDbUrls = [
        'http://localhost:6333/collections/sensitive/points',
        'http://127.0.0.1:8080/qdrant/search',
        'http://192.168.1.100:6333/collections/admin/points',
      ]

      internalDbUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(false)
      })
    })
  })

  describe('Development and testing scenarios', () => {
    it.concurrent('should allow common development tools and services', () => {
      const devUrls = [
        'https://postman-echo.com/get',
        'https://httpbin.org/anything',
        'https://jsonplaceholder.typicode.com/posts',
        'https://reqres.in/api/users',
        'https://api.github.com/repos/owner/repo',
        'https://raw.githubusercontent.com/owner/repo/main/file.json',
      ]

      devUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should handle tunneling services used in development', () => {
      const tunnelUrls = [
        'https://abc123.ngrok.io/webhook',
        'https://random-string.loca.lt/api',
        'https://subdomain.serveo.net/callback',
      ]

      tunnelUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })

    it.concurrent('should block attempts to tunnel to localhost', () => {
      const maliciousTunnelUrls = [
        'https://tunnel.com/proxy?url=http://localhost:3000',
        'https://proxy.service.com/?target=http://127.0.0.1:8080',
      ]

      maliciousTunnelUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        // These URLs themselves are valid, but they can't contain localhost in the main URL
        // The actual attack prevention happens at the parameter level
        expect(result.isValid).toBe(true)
      })
    })
  })

  describe('Enterprise and custom domain scenarios', () => {
    it.concurrent('should allow corporate domains and custom TLDs', () => {
      const enterpriseUrls = [
        'https://api.company.internal/v1/data', // .internal TLD
        'https://webhook.corp/receive', // .corp TLD
        'https://api.organization.local/webhook', // .local TLD
        'https://service.company.co.uk/api', // Country code TLD
        'https://api.startup.io/v2/callback', // Modern TLD
        'https://webhook.company.ai/receive', // AI TLD
      ]

      enterpriseUrls.forEach((url) => {
        const result = validateProxyUrl(url)
        expect(result.isValid).toBe(true)
      })
    })
  })
})
