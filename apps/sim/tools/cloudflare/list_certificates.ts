import type {
  CloudflareListCertificatesParams,
  CloudflareListCertificatesResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const listCertificatesTool: ToolConfig<
  CloudflareListCertificatesParams,
  CloudflareListCertificatesResponse
> = {
  id: 'cloudflare_list_certificates',
  name: 'Cloudflare List Certificates',
  description: 'Lists SSL/TLS certificate packs for a zone.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to list certificates for',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter certificate packs by status (e.g., "all", "active", "pending")',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number of paginated results (default: 1)',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of certificate packs per page (default: 20, min: 5, max: 50)',
    },
    deploy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by deployment environment: "staging" or "production"',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${params.zoneId}/ssl/certificate_packs`
      )
      if (params.status) url.searchParams.append('status', params.status)
      if (params.page) url.searchParams.append('page', String(params.page))
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.deploy) url.searchParams.append('deploy', params.deploy)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { certificates: [], total_count: 0 },
        error: data.errors?.[0]?.message ?? 'Failed to list certificates',
      }
    }

    return {
      success: true,
      output: {
        certificates:
          data.result?.map((cert: any) => ({
            id: cert.id ?? '',
            type: cert.type ?? '',
            hosts: cert.hosts ?? [],
            primary_certificate: cert.primary_certificate ?? '',
            status: cert.status ?? '',
            certificates:
              cert.certificates?.map((c: any) => ({
                id: c.id ?? '',
                hosts: c.hosts ?? [],
                issuer: c.issuer ?? '',
                signature: c.signature ?? '',
                status: c.status ?? '',
                bundle_method: c.bundle_method ?? '',
                zone_id: c.zone_id ?? '',
                uploaded_on: c.uploaded_on ?? '',
                modified_on: c.modified_on ?? '',
                expires_on: c.expires_on ?? '',
                priority: c.priority ?? 0,
                geo_restrictions: c.geo_restrictions ?? undefined,
              })) ?? [],
            cloudflare_branding: cert.cloudflare_branding ?? false,
            validation_method: cert.validation_method ?? '',
            validity_days: cert.validity_days ?? 0,
            certificate_authority: cert.certificate_authority ?? '',
            validation_errors:
              cert.validation_errors?.map((e: any) => ({
                message: e.message ?? '',
              })) ?? [],
            validation_records:
              cert.validation_records?.map((r: any) => ({
                cname: r.cname ?? '',
                cname_target: r.cname_target ?? '',
                emails: r.emails ?? [],
                http_body: r.http_body ?? '',
                http_url: r.http_url ?? '',
                status: r.status ?? '',
                txt_name: r.txt_name ?? '',
                txt_value: r.txt_value ?? '',
              })) ?? [],
            dcv_delegation_records:
              cert.dcv_delegation_records?.map((r: any) => ({
                cname: r.cname ?? '',
                cname_target: r.cname_target ?? '',
                emails: r.emails ?? [],
                http_body: r.http_body ?? '',
                http_url: r.http_url ?? '',
                status: r.status ?? '',
                txt_name: r.txt_name ?? '',
                txt_value: r.txt_value ?? '',
              })) ?? [],
          })) ?? [],
        total_count: data.result_info?.total_count ?? data.result?.length ?? 0,
      },
    }
  },

  outputs: {
    certificates: {
      type: 'array',
      description: 'List of SSL/TLS certificate packs',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Certificate pack ID' },
          type: { type: 'string', description: 'Certificate type (e.g., "universal", "advanced")' },
          hosts: {
            type: 'array',
            description: 'Hostnames covered by this certificate pack',
            items: {
              type: 'string',
              description: 'Hostname',
            },
          },
          primary_certificate: {
            type: 'string',
            description: 'ID of the primary certificate in the pack',
            optional: true,
          },
          status: {
            type: 'string',
            description: 'Certificate pack status (e.g., "active", "pending")',
          },
          certificates: {
            type: 'array',
            description: 'Individual certificates within the pack',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Certificate ID' },
                hosts: {
                  type: 'array',
                  description: 'Hostnames covered by this certificate',
                  items: { type: 'string', description: 'Hostname' },
                },
                issuer: { type: 'string', description: 'Certificate issuer' },
                signature: {
                  type: 'string',
                  description: 'Signature algorithm (e.g., "ECDSAWithSHA256")',
                },
                status: { type: 'string', description: 'Certificate status' },
                bundle_method: {
                  type: 'string',
                  description: 'Bundle method (e.g., "ubiquitous")',
                },
                zone_id: { type: 'string', description: 'Zone ID the certificate belongs to' },
                uploaded_on: { type: 'string', description: 'Upload date (ISO 8601)' },
                modified_on: { type: 'string', description: 'Last modified date (ISO 8601)' },
                expires_on: { type: 'string', description: 'Expiration date (ISO 8601)' },
                priority: {
                  type: 'number',
                  description: 'Certificate priority order',
                  optional: true,
                },
                geo_restrictions: {
                  type: 'object',
                  description: 'Geographic restrictions for the certificate',
                  optional: true,
                  properties: {
                    label: {
                      type: 'string',
                      description: 'Geographic restriction label',
                    },
                  },
                },
              },
            },
          },
          cloudflare_branding: {
            type: 'boolean',
            description: 'Whether Cloudflare branding is enabled on the certificate',
            optional: true,
          },
          validation_method: {
            type: 'string',
            description: 'Validation method (e.g., "txt", "http", "cname")',
            optional: true,
          },
          validity_days: {
            type: 'number',
            description: 'Validity period in days',
            optional: true,
          },
          certificate_authority: {
            type: 'string',
            description: 'Certificate authority (e.g., "lets_encrypt", "google")',
            optional: true,
          },
          validation_errors: {
            type: 'array',
            description: 'Validation issues for the certificate pack',
            optional: true,
            items: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'Validation error message',
                },
              },
            },
          },
          validation_records: {
            type: 'array',
            description: 'Validation records for the certificate pack',
            optional: true,
            items: {
              type: 'object',
              properties: {
                cname: { type: 'string', description: 'CNAME record name' },
                cname_target: { type: 'string', description: 'CNAME record target' },
                emails: {
                  type: 'array',
                  description: 'Email addresses for validation',
                  items: { type: 'string', description: 'Email address' },
                },
                http_body: { type: 'string', description: 'HTTP validation body content' },
                http_url: { type: 'string', description: 'HTTP validation URL' },
                status: { type: 'string', description: 'Validation record status' },
                txt_name: { type: 'string', description: 'TXT record name' },
                txt_value: { type: 'string', description: 'TXT record value' },
              },
            },
          },
          dcv_delegation_records: {
            type: 'array',
            description: 'Domain control validation delegation records',
            optional: true,
            items: {
              type: 'object',
              properties: {
                cname: { type: 'string', description: 'CNAME record name' },
                cname_target: { type: 'string', description: 'CNAME record target' },
                emails: {
                  type: 'array',
                  description: 'Email addresses for validation',
                  items: { type: 'string', description: 'Email address' },
                },
                http_body: { type: 'string', description: 'HTTP validation body content' },
                http_url: { type: 'string', description: 'HTTP validation URL' },
                status: { type: 'string', description: 'Delegation record status' },
                txt_name: { type: 'string', description: 'TXT record name' },
                txt_value: { type: 'string', description: 'TXT record value' },
              },
            },
          },
        },
      },
    },
    total_count: {
      type: 'number',
      description: 'Total number of certificate packs',
    },
  },
}
