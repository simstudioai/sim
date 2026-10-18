import type { ToolOutputProperty } from '@/tools/types'

const ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_PROPERTIES_FIELDS = {
  group: {
    type: 'json',
    description: 'group',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of a previously created Access group.',
        optional: false,
      },
    },
    optional: true,
  },
  any_valid_service_token: {
    type: 'json',
    description: 'An empty object which matches on all service tokens.',
    optional: true,
  },
  auth_context: {
    type: 'json',
    description: 'auth context',
    properties: {
      ac_id: {
        type: 'string',
        description: 'The ACID of an Authentication context.',
        optional: false,
      },
      id: {
        type: 'string',
        description: 'The ID of an Authentication context.',
        optional: false,
      },
      identity_provider_id: {
        type: 'string',
        description: 'The ID of your Azure identity provider.',
        optional: false,
      },
    },
    optional: true,
  },
  auth_method: {
    type: 'json',
    description: 'auth method',
    properties: {
      auth_method: {
        type: 'string',
        description:
          'The type of authentication method https://datatracker.ietf.org/doc/html/rfc8176#section-2.',
        optional: false,
      },
    },
    optional: true,
  },
  azureAD: {
    type: 'json',
    description: 'azureAD',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of an Azure group.',
        optional: false,
      },
      identity_provider_id: {
        type: 'string',
        description: 'The ID of your Azure identity provider.',
        optional: false,
      },
    },
    optional: true,
  },
  certificate: {
    type: 'json',
    description: 'certificate',
    optional: true,
  },
  common_name: {
    type: 'json',
    description: 'common name',
    properties: {
      common_name: {
        type: 'string',
        description: 'The common name to match.',
        optional: false,
      },
    },
    optional: true,
  },
  geo: {
    type: 'json',
    description: 'geo',
    properties: {
      country_code: {
        type: 'string',
        description: 'The country code that should be matched.',
        optional: false,
      },
    },
    optional: true,
  },
  device_posture: {
    type: 'json',
    description: 'device posture',
    properties: {
      account_id: {
        type: 'string',
        description: 'Identifier.',
        optional: true,
      },
      integration_uid: {
        type: 'string',
        description: 'The ID of a device posture integration.',
        optional: false,
      },
    },
    optional: true,
  },
  email_domain: {
    type: 'json',
    description: 'email domain',
    properties: {
      domain: {
        type: 'string',
        description: 'The email domain to match.',
        optional: false,
      },
    },
    optional: true,
  },
  email_list: {
    type: 'json',
    description: 'email list',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of a previously created email list.',
        optional: false,
      },
    },
    optional: true,
  },
  email: {
    type: 'json',
    description: 'email',
    properties: {
      email: {
        type: 'string',
        description: 'The email of the user.',
        optional: false,
      },
    },
    optional: true,
  },
  everyone: {
    type: 'json',
    description: 'An empty object which matches on all users.',
    optional: true,
  },
  external_evaluation: {
    type: 'json',
    description: 'external evaluation',
    properties: {
      evaluate_url: {
        type: 'string',
        description: 'The API endpoint containing your business logic.',
        optional: false,
      },
      keys_url: {
        type: 'string',
        description:
          'The API endpoint containing the key that Access uses to verify that the response came from your API.',
        optional: false,
      },
    },
    optional: true,
  },
  'github-organization': {
    type: 'json',
    description: 'github-organization',
    properties: {
      identity_provider_id: {
        type: 'string',
        description: 'The ID of your Github identity provider.',
        optional: false,
      },
      name: {
        type: 'string',
        description: 'The name of the organization.',
        optional: false,
      },
      team: {
        type: 'string',
        description: 'The name of the team',
        optional: true,
      },
    },
    optional: true,
  },
  gsuite: {
    type: 'json',
    description: 'gsuite',
    properties: {
      email: {
        type: 'string',
        description: 'The email of the Google Workspace group.',
        optional: false,
      },
      identity_provider_id: {
        type: 'string',
        description: 'The ID of your Google Workspace identity provider.',
        optional: false,
      },
    },
    optional: true,
  },
  login_method: {
    type: 'json',
    description: 'login method',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of an identity provider.',
        optional: false,
      },
    },
    optional: true,
  },
  ip_list: {
    type: 'json',
    description: 'ip list',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of a previously created IP list.',
        optional: false,
      },
    },
    optional: true,
  },
  ip: {
    type: 'json',
    description: 'ip',
    properties: {
      ip: {
        type: 'string',
        description: 'An IPv4 or IPv6 CIDR block.',
        optional: false,
      },
    },
    optional: true,
  },
  okta: {
    type: 'json',
    description: 'okta',
    properties: {
      identity_provider_id: {
        type: 'string',
        description: 'The ID of your Okta identity provider.',
        optional: false,
      },
      name: {
        type: 'string',
        description: 'The name of the Okta group.',
        optional: false,
      },
    },
    optional: true,
  },
  saml: {
    type: 'json',
    description: 'saml',
    properties: {
      attribute_name: {
        type: 'string',
        description: 'The name of the SAML attribute.',
        optional: false,
      },
      attribute_value: {
        type: 'string',
        description: 'The SAML attribute value to look for.',
        optional: false,
      },
      identity_provider_id: {
        type: 'string',
        description: 'The ID of your SAML identity provider.',
        optional: false,
      },
    },
    optional: true,
  },
  oidc: {
    type: 'json',
    description: 'oidc',
    properties: {
      claim_name: {
        type: 'string',
        description: 'The name of the OIDC claim.',
        optional: false,
      },
      claim_value: {
        type: 'string',
        description: 'The OIDC claim value to look for.',
        optional: false,
      },
      identity_provider_id: {
        type: 'string',
        description: 'The ID of your OIDC identity provider.',
        optional: false,
      },
    },
    optional: true,
  },
  service_token: {
    type: 'json',
    description: 'service token',
    properties: {
      token_id: {
        type: 'string',
        description: 'The ID of a Service Token.',
        optional: false,
      },
    },
    optional: true,
  },
  linked_app_token: {
    type: 'json',
    description: 'linked app token',
    properties: {
      app_uid: {
        type: 'string',
        description: 'The ID of an Access OIDC SaaS application',
        optional: false,
      },
    },
    optional: true,
  },
  user_risk_score: {
    type: 'json',
    description: 'user risk score',
    properties: {
      user_risk_score: {
        type: 'array',
        description:
          'A list of risk score levels to match. Values can be low, medium, high, or unscored.',
        items: {
          type: 'string',
          description: 'user risk score item Values: low, medium, high, unscored.',
        },
        optional: false,
      },
    },
    optional: true,
  },
  cloudflare_account_member: {
    type: 'json',
    description: 'cloudflare account member',
    properties: {
      account_id: {
        type: 'string',
        description: 'Identifier.',
        optional: true,
      },
    },
    optional: true,
  },
} as const

const ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_FIELDS = {
  type: 'json',
  description:
    'Matches users who are members of a specific Cloudflare account. Requires a Cloudflare identity provider.',
  properties: ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_PROPERTIES_FIELDS,
} as const

const ACCESS_GROUP_OUTPUTS_INCLUDE_FIELDS = {
  type: 'array',
  description:
    'Rules evaluated with an OR logical operator. A user needs to meet only one of the Include rules.',
  items: ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_FIELDS,
} as const

const ACCESS_GROUP_OUTPUTS_IS_DEFAULT_FIELDS = {
  type: 'array',
  description:
    'Rules evaluated with an AND logical operator. To match a policy, a user must meet all of the Require rules.',
  items: ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_FIELDS,
} as const

const CERTIFICATE_OUTPUTS_DCV_DELEGATION_RECORDS_ITEMS_PROPERTIES_FIELDS = {
  cname: {
    type: 'string',
    description: 'The CNAME record hostname for DCV delegation.',
    optional: true,
  },
  cname_target: {
    type: 'string',
    description: 'The CNAME record target value for DCV delegation.',
    optional: true,
  },
  emails: {
    type: 'array',
    description:
      'The set of email addresses that the certificate authority (CA) will use to complete domain validation.',
    items: {
      type: 'string',
      description: 'emails item',
    },
    optional: true,
  },
  http_body: {
    type: 'string',
    description:
      'The content that the certificate authority (CA) will expect to find at the http_url during the domain validation.',
    optional: true,
  },
  http_url: {
    type: 'string',
    description: 'The url that will be checked during domain validation.',
    optional: true,
  },
  status: {
    type: 'string',
    description: 'Status of the validation record.',
    optional: true,
  },
  txt_name: {
    type: 'string',
    description:
      'The hostname that the certificate authority (CA) will check for a TXT record during domain validation .',
    optional: true,
  },
  txt_value: {
    type: 'string',
    description:
      'The TXT record that the certificate authority (CA) will check during domain validation.',
    optional: true,
  },
} as const

const CERTIFICATE_OUTPUTS_DCV_DELEGATION_RECORDS_ITEMS_FIELDS = {
  type: 'json',
  description: "Certificate's required validation record.",
  properties: CERTIFICATE_OUTPUTS_DCV_DELEGATION_RECORDS_ITEMS_PROPERTIES_FIELDS,
} as const

const TUNNEL_CONFIGURATION_OUTPUTS_CONFIG_PROPERTIES_INGRESS_ITEMS_PROPERTIES_ORIGINREQUEST_PROPERTIES_FIELDS =
  {
    access: {
      type: 'json',
      description:
        "For all L7 requests to this hostname, cloudflared will validate each request's Cf-Access-Jwt-Assertion request header.",
      properties: {
        audTag: {
          type: 'array',
          description:
            'Access applications that are allowed to reach this hostname for this Tunnel. Audience tags can be identified in the dashboard or via the List Access policies API.',
          items: {
            type: 'string',
            description: 'audTag item',
          },
          optional: false,
        },
        required: {
          type: 'boolean',
          description: 'Deny traffic that has not fulfilled Access authorization.',
          optional: true,
        },
        teamName: {
          type: 'string',
          description: 'teamName',
          optional: false,
        },
      },
      optional: true,
    },
    caPool: {
      type: 'string',
      description:
        'Path to the certificate authority (CA) for the certificate of your origin. This option should be used only if your certificate is not signed by Cloudflare.',
      optional: true,
    },
    connectTimeout: {
      type: 'number',
      description:
        'Timeout for establishing a new TCP connection to your origin server. This excludes the time taken to establish TLS, which is controlled by tlsTimeout.',
      optional: true,
    },
    disableChunkedEncoding: {
      type: 'boolean',
      description: 'Disables chunked transfer encoding. Useful if you are running a WSGI server.',
      optional: true,
    },
    http2Origin: {
      type: 'boolean',
      description: 'Attempt to connect to origin using HTTP2. Origin must be configured as https.',
      optional: true,
    },
    httpHostHeader: {
      type: 'string',
      description: 'Sets the HTTP Host header on requests sent to the local service.',
      optional: true,
    },
    keepAliveConnections: {
      type: 'number',
      description:
        'Maximum number of idle keepalive connections between Tunnel and your origin. This does not restrict the total number of concurrent connections.',
      optional: true,
    },
    keepAliveTimeout: {
      type: 'number',
      description: 'Timeout after which an idle keepalive connection can be discarded.',
      optional: true,
    },
    matchSNItoHost: {
      type: 'boolean',
      description: 'Auto configure the Hostname on the origin server certificate.',
      optional: true,
    },
    noHappyEyeballs: {
      type: 'boolean',
      description:
        'Disable the \u201chappy eyeballs\u201d algorithm for IPv4/IPv6 fallback if your local network has misconfigured one of the protocols.',
      optional: true,
    },
    noTLSVerify: {
      type: 'boolean',
      description:
        'Disables TLS verification of the certificate presented by your origin. Will allow any certificate from the origin to be accepted.',
      optional: true,
    },
    originServerName: {
      type: 'string',
      description: 'Hostname that cloudflared should expect from your origin server certificate.',
      optional: true,
    },
    proxyType: {
      type: 'string',
      description:
        'cloudflared starts a proxy server to translate HTTP traffic into TCP when proxying, for example, SSH or RDP. This configures what type of proxy will be started. Valid options are: "" for the regular proxy and "socks" for a SOCKS5 proxy.',
      optional: true,
    },
    tcpKeepAlive: {
      type: 'number',
      description:
        'The timeout after which a TCP keepalive packet is sent on a connection between Tunnel and the origin server.',
      optional: true,
    },
    tlsTimeout: {
      type: 'number',
      description:
        'Timeout for completing a TLS handshake to your origin server, if you have chosen to connect Tunnel to an HTTPS server.',
      optional: true,
    },
  } as const

const TUNNEL_CONFIGURATION_OUTPUTS_CONFIG_PROPERTIES_INGRESS_ITEMS_PROPERTIES_ORIGINREQUEST_FIELDS =
  {
    type: 'json',
    description:
      'Configuration parameters for the public hostname specific connection settings between cloudflared and origin server.',
    properties:
      TUNNEL_CONFIGURATION_OUTPUTS_CONFIG_PROPERTIES_INGRESS_ITEMS_PROPERTIES_ORIGINREQUEST_PROPERTIES_FIELDS,
    optional: true,
  } as const

const WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_PROPERTIES_LOGS_PROPERTIES_FIELDS = {
  destinations: {
    type: 'array',
    description: 'A list of destinations where logs will be exported to.',
    items: {
      type: 'string',
      description: 'destinations item',
    },
    optional: true,
  },
  enabled: {
    type: 'boolean',
    description: 'Whether logs are enabled for the Worker.',
    optional: false,
  },
  head_sampling_rate: {
    type: 'number',
    description: 'The sampling rate for logs. From 0 to 1 (1 = 100%, 0.1 = 10%). Default is 1.',
    optional: true,
  },
  invocation_logs: {
    type: 'boolean',
    description:
      'Whether [invocation logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#invocation-logs) are enabled for the Worker.',
    optional: false,
  },
  persist: {
    type: 'boolean',
    description: 'Whether log persistence is enabled for the Worker.',
    optional: true,
  },
} as const

const WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_PROPERTIES_LOGS_FIELDS = {
  type: 'json',
  description: 'Log settings for the Worker.',
  properties: WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_PROPERTIES_LOGS_PROPERTIES_FIELDS,
  optional: true,
} as const

const WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_PROPERTIES_TRACES_PROPERTIES_FIELDS = {
  destinations: {
    type: 'array',
    description: 'A list of destinations where traces will be exported to.',
    items: {
      type: 'string',
      description: 'destinations item',
    },
    optional: true,
  },
  enabled: {
    type: 'boolean',
    description: 'Whether traces are enabled for the Worker.',
    optional: true,
  },
  head_sampling_rate: {
    type: 'number',
    description: 'The sampling rate for traces. From 0 to 1 (1 = 100%, 0.1 = 10%). Default is 1.',
    optional: true,
  },
  persist: {
    type: 'boolean',
    description: 'Whether trace persistence is enabled for the Worker.',
    optional: true,
  },
  propagation_policy: {
    type: 'string',
    description:
      'Controls how inbound trace context (traceparent/tracestate) headers on incoming requests are handled.',
    optional: true,
  },
} as const

const WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_PROPERTIES_TRACES_FIELDS = {
  type: 'json',
  description: 'Trace settings for the Worker.',
  properties: WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_PROPERTIES_TRACES_PROPERTIES_FIELDS,
  optional: true,
} as const

const WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_PROPERTIES_FIELDS = {
  enabled: {
    type: 'boolean',
    description: 'Whether observability is enabled for the Worker.',
    optional: false,
  },
  head_sampling_rate: {
    type: 'number',
    description:
      'The sampling rate for incoming requests. From 0 to 1 (1 = 100%, 0.1 = 10%). Default is 1.',
    optional: true,
  },
  issues: {
    type: 'json',
    description: 'Real-time Issues settings for the Worker.',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Whether real-time Issues are enabled for the Worker.',
        optional: true,
      },
    },
    optional: true,
  },
  logs: WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_PROPERTIES_LOGS_FIELDS,
  redact_query_string: {
    type: 'boolean',
    description: 'Whether query strings are removed from request URLs in logs and traces.',
    optional: true,
  },
  traces: WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_PROPERTIES_TRACES_FIELDS,
} as const

const WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_FIELDS = {
  type: 'json',
  description: 'Observability settings for the Worker.',
  properties: WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_PROPERTIES_FIELDS,
  nullable: true,
} as const

export const ACCESS_APPLICATION_OUTPUTS = {
  aud: {
    type: 'string',
    description: 'Audience tag.',
    nullable: true,
  },
  created_at: {
    type: 'string',
    description: 'created at',
    nullable: true,
  },
  id: {
    type: 'string',
    description: 'UUID.',
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'updated at',
    nullable: true,
  },
  allowed_idps: {
    type: 'array',
    description:
      'The identity providers your users can select when connecting to this application. Defaults to all IdPs configured in your account.',
    items: {
      type: 'string',
      description: 'The identity providers selected for application.',
    },
  },
  destinations: {
    type: 'array',
    description:
      'List of destinations secured by Access. This supersedes `self_hosted_domains` to allow for more flexibility in defining different types of domains. If `destinations` are provided, then `self_hosted_domains` will be ignored.',
    items: {
      type: 'json',
      description:
        'Protects the preview deployments of all Cloudflare Workers on the account with Access.',
      properties: {
        overrides: {
          type: 'array',
          description:
            'Rules that override how Access handles requests to this destination. Each rule can make a matching path public, bypassing Access authentication. Overrides are supported for public destinations and Worker destinations.',
          items: {
            type: 'json',
            description: 'overrides item',
            properties: {
              behavior: {
                type: 'string',
                description: 'The behavior to apply to matching requests. Values: public.',
                optional: false,
              },
              path_pattern: {
                type: 'string',
                description:
                  'The request path pattern to match. Wildcards (`*`) are supported, but each path segment may have at most one wildcard. Unlike the `uri` in public destinations, override path patterns do not implicitly cover subpaths; to do that, use a wildcard.',
                optional: false,
              },
            },
          },
          optional: true,
        },
        type: {
          type: 'string',
          description:
            'type Values: public, private, via_mcp_server_portal, worker, preview_worker, all_workers, all_preview_workers.',
          optional: true,
        },
        uri: {
          type: 'string',
          description:
            "The URI of the destination. Public destinations' URIs can include a domain and path with [wildcards](https://developers.cloudflare.com/cloudflare-one/policies/access/app-paths/).",
          optional: true,
        },
        cidr: {
          type: 'string',
          description: 'The CIDR range of the destination. Single IPs will be computed as /32.',
          optional: true,
        },
        hostname: {
          type: 'string',
          description:
            'The hostname of the destination. Matches a valid SNI served by an HTTPS origin.',
          optional: true,
        },
        l4_protocol: {
          type: 'string',
          description:
            'The L4 protocol of the destination. When omitted, both UDP and TCP traffic will match. Values: tcp, udp.',
          optional: true,
        },
        port_range: {
          type: 'string',
          description:
            'The port range of the destination. Can be a single port or a range of ports. When omitted, all ports will match.',
          optional: true,
        },
        vnet_id: {
          type: 'string',
          description: 'The VNET ID to match the destination. When omitted, all VNETs will match.',
          optional: true,
        },
        mcp_server_id: {
          type: 'string',
          description: 'The MCP server id configured in ai-controls.',
          optional: true,
        },
        worker_id: {
          type: 'string',
          description:
            'The ID of the Cloudflare Worker whose preview deployments to protect with Access.',
          optional: true,
        },
      },
    },
  },
  domain: {
    type: 'string',
    description:
      'The primary hostname and path secured by Access. This domain will be displayed if the app is visible in the App Launcher.',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'The name of the application.',
    nullable: true,
  },
  oauth_configuration: {
    type: 'json',
    description:
      '**Beta:** Optional configuration for managing an OAuth authorization flow controlled by Access.',
    properties: {
      dynamic_client_registration: {
        type: 'json',
        description: 'Settings for OAuth dynamic client registration.',
        properties: {
          allow_any_on_localhost: {
            type: 'boolean',
            description: 'Allows any client with redirect URIs on localhost.',
            optional: true,
          },
          allow_any_on_loopback: {
            type: 'boolean',
            description: 'Allows any client with redirect URIs on 127.0.0.1.',
            optional: true,
          },
          allowed_uris: {
            type: 'array',
            description:
              'The URIs that are allowed as redirect URIs for dynamically registered clients. HTTP and HTTPS paths may end in `/*` to match all sub-paths. Custom-scheme URIs must be explicitly configured and match exactly.',
            items: {
              type: 'string',
              description: 'allowed uris item',
            },
            optional: true,
          },
          enabled: {
            type: 'boolean',
            description: 'Whether dynamic client registration is enabled.',
            optional: true,
          },
        },
        optional: true,
      },
      enabled: {
        type: 'boolean',
        description:
          'Whether the OAuth configuration is enabled for this application. When set to `false`, Access will not handle OAuth for this application. Defaults to `true` if omitted. Values: True.',
        optional: true,
      },
      grant: {
        type: 'json',
        description: 'Settings for OAuth grant behavior.',
        properties: {
          access_token_lifetime: {
            type: 'string',
            description:
              'The lifetime of the access token. Must be in the format `300ms` or `2h45m`. Valid time units are ns, us (or \u00b5s), ms, s, m, h.',
            optional: true,
          },
          session_duration: {
            type: 'string',
            description:
              'The duration of the OAuth session. Must be in the format `300ms` or `2h45m`. Valid time units are ns, us (or \u00b5s), ms, s, m, h.',
            optional: true,
          },
        },
        optional: true,
      },
    },
    nullable: true,
  },
  self_hosted_domains: {
    type: 'array',
    description:
      'List of public domains that Access will secure. This field is deprecated in favor of `destinations` and will be supported until **November 21, 2025.** If `destinations` are provided, then `self_hosted_domains` will be ignored.',
    items: {
      type: 'string',
      description: 'A domain that Access will secure.',
    },
  },
  type: {
    type: 'string',
    description:
      'The application type. Values: end_user, self_hosted, saas, ssh, vnc, app_launcher, warp, biso, bookmark, dash_sso, infrastructure, rdp, mcp, mcp_portal, proxy_endpoint.',
    nullable: true,
  },
  user_populations: {
    type: 'array',
    description: 'The single user population associated with this application.',
    items: {
      type: 'string',
      description: 'UUID.',
    },
  },
  allow_authenticate_via_warp: {
    type: 'boolean',
    description:
      'When set to true, users can authenticate to this application using their WARP session. When set to false this application will always require direct IdP authentication. This setting always overrides the organization setting for WARP authentication.',
    nullable: true,
  },
  allow_iframe: {
    type: 'boolean',
    description: 'Enables loading application content in an iFrame.',
    nullable: true,
  },
  app_launcher_visible: {
    type: 'boolean',
    description: 'Displays the application in the App Launcher.',
    nullable: true,
  },
  auto_redirect_to_identity: {
    type: 'boolean',
    description:
      'When set to `true`, users skip the identity provider selection step during login. You must specify only one identity provider in allowed_idps.',
    nullable: true,
  },
  cors_headers: {
    type: 'json',
    description: 'cors headers',
    properties: {
      allow_all_headers: {
        type: 'boolean',
        description: 'Allows all HTTP request headers.',
        optional: true,
      },
      allow_all_methods: {
        type: 'boolean',
        description: 'Allows all HTTP request methods.',
        optional: true,
      },
      allow_all_origins: {
        type: 'boolean',
        description: 'Allows all origins.',
        optional: true,
      },
      allow_credentials: {
        type: 'boolean',
        description:
          'When set to `true`, includes credentials (cookies, authorization headers, or TLS client certificates) with requests.',
        optional: true,
      },
      allowed_headers: {
        type: 'array',
        description: 'Allowed HTTP request headers.',
        items: {
          type: 'string',
          description: 'allowed headers item',
        },
        optional: true,
      },
      allowed_methods: {
        type: 'array',
        description: 'Allowed HTTP request methods.',
        items: {
          type: 'string',
          description:
            'allowed methods item Values: GET, POST, HEAD, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH.',
        },
        optional: true,
      },
      allowed_origins: {
        type: 'array',
        description: 'Allowed origins.',
        items: {
          type: 'string',
          description: 'allowed origins item',
        },
        optional: true,
      },
      max_age: {
        type: 'number',
        description:
          'The maximum number of seconds the results of a preflight request can be cached.',
        optional: true,
      },
    },
    nullable: true,
  },
  custom_deny_message: {
    type: 'string',
    description:
      'The custom error message shown to a user when they are denied access to the application.',
    nullable: true,
  },
  custom_deny_url: {
    type: 'string',
    description:
      'The custom URL a user is redirected to when they are denied access to the application when failing identity-based rules.',
    nullable: true,
  },
  custom_non_identity_deny_url: {
    type: 'string',
    description:
      'The custom URL a user is redirected to when they are denied access to the application when failing non-identity rules.',
    nullable: true,
  },
  custom_pages: {
    type: 'array',
    description: 'The custom pages that will be displayed when applicable for this application',
    items: {
      type: 'string',
      description: 'The custom pages selected for application.',
    },
  },
  eager_redirect_cookie_setting: {
    type: 'boolean',
    description:
      'Preemptively sets the Access session cookie on every hostname in a multi-hostname self-hosted application during the initial redirect chain, rather than setting it lazily on first visit. Defaults to true. Set to false to disable the eager redirect cookie behavior.',
    nullable: true,
  },
  enable_binding_cookie: {
    type: 'boolean',
    description:
      'Enables the binding cookie, which increases security against compromised authorization tokens and CSRF attacks.',
    nullable: true,
  },
  http_only_cookie_attribute: {
    type: 'boolean',
    description:
      'Enables the HttpOnly cookie attribute, which increases security against XSS attacks.',
    nullable: true,
  },
  logo_url: {
    type: 'string',
    description: 'The image URL for the logo shown in the App Launcher dashboard.',
    nullable: true,
  },
  mfa_config: {
    type: 'json',
    description: 'Configures multi-factor authentication (MFA) settings.',
    properties: {
      allowed_authenticators: {
        type: 'array',
        description: 'Lists the MFA methods that users can authenticate with.',
        items: {
          type: 'string',
          description: 'allowed authenticators item Values: totp, biometrics, security_key.',
        },
        optional: true,
      },
      mfa_disabled: {
        type: 'boolean',
        description:
          'Indicates whether to disable MFA for this resource. This option is available at the application and policy level.',
        optional: true,
      },
      session_duration: {
        type: 'string',
        description:
          'Defines the duration of an MFA session. Must be in minutes (m) or hours (h). Minimum: 0m. Maximum: 720h (30 days). Examples:`5m` or `24h`.',
        optional: true,
      },
    },
    nullable: true,
  },
  options_preflight_bypass: {
    type: 'boolean',
    description:
      'Allows options preflight requests to bypass Access authentication and go directly to the origin. Cannot turn on if cors_headers is set.',
    nullable: true,
  },
  path_cookie_attribute: {
    type: 'boolean',
    description:
      "Enables cookie paths to scope an application's JWT to the application path. If disabled, the JWT will scope to the hostname by default",
    nullable: true,
  },
  read_service_tokens_from_header: {
    type: 'string',
    description:
      'Allows matching Access Service Tokens passed HTTP in a single header with this name.',
    nullable: true,
  },
  same_site_cookie_attribute: {
    type: 'string',
    description:
      'Sets the SameSite cookie setting, which provides increased security against CSRF attacks.',
    nullable: true,
  },
  scim_config: {
    type: 'json',
    description:
      'Configuration for provisioning to this application via SCIM. This is currently in closed beta.',
    properties: {
      authentication: {
        type: 'json',
        description: 'Multiple authentication schemes',
        properties: {
          password: {
            type: 'string',
            description: 'Password used to authenticate with the remote SCIM service.',
            optional: true,
          },
          scheme: {
            type: 'string',
            description:
              'The authentication scheme to use when making SCIM requests to this application. Values: httpbasic, oauthbearertoken, oauth2, access_service_token.',
            optional: true,
          },
          user: {
            type: 'string',
            description: 'User name used to authenticate with the remote SCIM service.',
            optional: true,
          },
          token: {
            type: 'string',
            description: 'Token used to authenticate with the remote SCIM service.',
            optional: true,
          },
          authorization_url: {
            type: 'string',
            description: 'URL used to generate the auth code used during token generation.',
            optional: true,
          },
          client_id: {
            type: 'string',
            description:
              'Client ID of the Access service token used to authenticate with the remote service.',
            optional: true,
          },
          client_secret: {
            type: 'string',
            description:
              'Client secret of the Access service token used to authenticate with the remote service.',
            optional: true,
          },
          scopes: {
            type: 'array',
            description:
              'The authorization scopes to request when generating the token used to authenticate with the remove SCIM service.',
            items: {
              type: 'string',
              description: 'scopes item',
            },
            optional: true,
          },
          token_url: {
            type: 'string',
            description:
              'URL used to generate the token used to authenticate with the remote SCIM service.',
            optional: true,
          },
        },
        optional: true,
      },
      deactivate_on_delete: {
        type: 'boolean',
        description:
          "If false, propagates DELETE requests to the target application for SCIM resources. If true, sets 'active' to false on the SCIM resource. Note: Some targets do not support DELETE operations.",
        optional: true,
      },
      enabled: {
        type: 'boolean',
        description: 'Whether SCIM provisioning is turned on for this application.',
        optional: true,
      },
      idp_uid: {
        type: 'string',
        description:
          'The UID of the IdP to use as the source for SCIM resources to provision to this application.',
        optional: false,
      },
      mappings: {
        type: 'array',
        description:
          'A list of mappings to apply to SCIM resources before provisioning them in this application. These can transform or filter the resources to be provisioned.',
        items: {
          type: 'json',
          description:
            'Transformations and filters applied to resources before they are provisioned in the remote SCIM service.',
          properties: {
            enabled: {
              type: 'boolean',
              description: 'Whether or not this mapping is enabled.',
              optional: true,
            },
            filter: {
              type: 'string',
              description:
                'A [SCIM filter expression](https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.2) that matches resources that should be provisioned to this application.',
              optional: true,
            },
            operations: {
              type: 'json',
              description: 'Whether or not this mapping applies to creates, updates, or deletes.',
              properties: {
                create: {
                  type: 'boolean',
                  description: 'Whether or not this mapping applies to create (POST) operations.',
                  optional: true,
                },
                delete: {
                  type: 'boolean',
                  description: 'Whether or not this mapping applies to DELETE operations.',
                  optional: true,
                },
                update: {
                  type: 'boolean',
                  description:
                    'Whether or not this mapping applies to update (PATCH/PUT) operations.',
                  optional: true,
                },
              },
              optional: true,
            },
            schema: {
              type: 'string',
              description: 'Which SCIM resource type this mapping applies to.',
              optional: false,
            },
            strictness: {
              type: 'string',
              description:
                'The level of adherence to outbound resource schemas when provisioning to this mapping. \u2018Strict\u2019 removes unknown values, while \u2018passthrough\u2019 passes unknown values to the target. Values: strict, passthrough.',
              optional: true,
            },
            transform_jsonata: {
              type: 'string',
              description:
                'A [JSONata](https://jsonata.org/) expression that transforms the resource before provisioning it in the application.',
              optional: true,
            },
          },
        },
        optional: true,
      },
      remote_uri: {
        type: 'string',
        description: "The base URI for the application's SCIM-compatible API.",
        optional: false,
      },
    },
    nullable: true,
  },
  service_auth_401_redirect: {
    type: 'boolean',
    description: 'Returns a 401 status code when the request is blocked by a Service Auth policy.',
    nullable: true,
  },
  session_duration: {
    type: 'string',
    description:
      'The amount of time that tokens issued for this application will be valid. Must be in the format `300ms` or `2h45m`. Valid time units are: ns, us (or \u00b5s), ms, s, m, h.',
    nullable: true,
  },
  skip_interstitial: {
    type: 'boolean',
    description: 'Enables automatic authentication through cloudflared.',
    nullable: true,
  },
  tags: {
    type: 'array',
    description:
      'The tags you want assigned to an application. Tags are used to filter applications in the App Launcher dashboard.',
    items: {
      type: 'string',
      description: 'The tag associated with an application.',
    },
  },
  use_clientless_isolation_app_launcher_url: {
    type: 'boolean',
    description:
      'Determines if users can access this application via a clientless browser isolation URL. This allows users to access private domains without connecting to Gateway. The option requires Clientless Browser Isolation to be set up with policies that allow users of this application.',
    nullable: true,
  },
  policies: {
    type: 'array',
    description: 'policies',
    items: {
      type: 'json',
      description: 'policies item',
      properties: {
        approval_groups: {
          type: 'array',
          description: 'Administrators who can approve a temporary authentication request.',
          items: {
            type: 'json',
            description:
              'A group of email addresses that can approve a temporary authentication request.',
            properties: {
              approvals_needed: {
                type: 'number',
                description: 'The number of approvals needed to obtain access.',
                optional: false,
              },
              email_addresses: {
                type: 'array',
                description: 'A list of emails that can approve the access request.',
                items: {
                  type: 'string',
                  description: 'email addresses item',
                },
                optional: true,
              },
              email_list_uuid: {
                type: 'string',
                description: 'The UUID of an re-usable email list.',
                optional: true,
              },
            },
          },
          optional: true,
        },
        approval_required: {
          type: 'boolean',
          description:
            'Requires the user to request access from an administrator at the start of each session.',
          optional: true,
        },
        connection_rules: {
          type: 'json',
          description:
            'The rules that define how users may connect to targets secured by your application.',
          properties: {
            rdp: {
              type: 'json',
              description:
                'The RDP-specific rules that define clipboard behavior for RDP connections.',
              properties: {
                allowed_clipboard_local_to_remote_formats: {
                  type: 'array',
                  description:
                    'Clipboard formats allowed when copying from local machine to remote RDP session.',
                  items: {
                    type: 'string',
                    description: 'Clipboard format for RDP connections. Values: text, file.',
                  },
                  optional: true,
                },
                allowed_clipboard_remote_to_local_formats: {
                  type: 'array',
                  description:
                    'Clipboard formats allowed when copying from remote RDP session to local machine.',
                  items: {
                    type: 'string',
                    description: 'Clipboard format for RDP connections. Values: text, file.',
                  },
                  optional: true,
                },
              },
              optional: true,
            },
          },
          optional: true,
        },
        isolation_required: {
          type: 'boolean',
          description:
            "Require this application to be served in an isolated browser for users matching this policy. 'Client Web Isolation' must be on for the account in order to use this feature.",
          optional: true,
        },
        mfa_config: {
          type: 'json',
          description: 'Configures multi-factor authentication (MFA) settings.',
          properties: {
            allowed_authenticators: {
              type: 'array',
              description: 'Lists the MFA methods that users can authenticate with.',
              items: {
                type: 'string',
                description: 'allowed authenticators item Values: totp, biometrics, security_key.',
              },
              optional: true,
            },
            mfa_disabled: {
              type: 'boolean',
              description:
                'Indicates whether to disable MFA for this resource. This option is available at the application and policy level.',
              optional: true,
            },
            session_duration: {
              type: 'string',
              description:
                'Defines the duration of an MFA session. Must be in minutes (m) or hours (h). Minimum: 0m. Maximum: 720h (30 days). Examples:`5m` or `24h`.',
              optional: true,
            },
          },
          optional: true,
        },
        purpose_justification_prompt: {
          type: 'string',
          description: 'A custom message that will appear on the purpose justification screen.',
          optional: true,
        },
        purpose_justification_required: {
          type: 'boolean',
          description:
            'Require users to enter a justification when they log in to the application.',
          optional: true,
        },
        session_duration: {
          type: 'string',
          description:
            'The amount of time that tokens issued for the application will be valid. Must be in the format `300ms` or `2h45m`. Valid time units are: ns, us (or \u00b5s), ms, s, m, h.',
          optional: true,
        },
        created_at: {
          type: 'string',
          description: 'created at',
          optional: true,
        },
        decision: {
          type: 'string',
          description:
            'The action Access will take if a user matches this policy. Infrastructure application policies can only use the Allow action. Values: allow, deny, non_identity, bypass.',
          optional: true,
        },
        exclude: {
          type: 'array',
          description:
            'Rules evaluated with a NOT logical operator. To match the policy, a user cannot meet any of the Exclude rules.',
          items: ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_FIELDS,
          optional: true,
        },
        id: {
          type: 'string',
          description: 'The UUID of the policy',
          optional: true,
        },
        include: {
          type: 'array',
          description:
            'Rules evaluated with an OR logical operator. A user needs to meet only one of the Include rules.',
          items: ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_FIELDS,
          optional: true,
        },
        name: {
          type: 'string',
          description: 'The name of the Access policy.',
          optional: true,
        },
        require: {
          type: 'array',
          description:
            'Rules evaluated with an AND logical operator. To match the policy, a user must meet all of the Require rules.',
          items: ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_FIELDS,
          optional: true,
        },
        updated_at: {
          type: 'string',
          description: 'updated at',
          optional: true,
        },
        account_id: {
          type: 'string',
          description: 'Identifier.',
          optional: true,
        },
        precedence: {
          type: 'number',
          description:
            'The order of execution for this policy. Must be unique for each policy within an app.',
          optional: true,
        },
      },
    },
  },
  saas_app: {
    type: 'json',
    description: 'saas app',
    properties: {
      auth_type: {
        type: 'string',
        description:
          'Identifier of the authentication protocol used for the saas app. Required for OIDC. Values: saml, oidc.',
        optional: true,
      },
      consumer_service_url: {
        type: 'string',
        description:
          "The service provider's endpoint that is responsible for receiving and parsing a SAML assertion.",
        optional: true,
      },
      created_at: {
        type: 'string',
        description: 'created at',
        optional: true,
      },
      custom_attributes: {
        type: 'array',
        description: 'custom attributes',
        items: {
          type: 'json',
          description: 'custom attributes item',
          properties: {
            friendly_name: {
              type: 'string',
              description: 'The SAML FriendlyName of the attribute.',
              optional: true,
            },
            name: {
              type: 'string',
              description: 'The name of the attribute.',
              optional: true,
            },
            name_format: {
              type: 'string',
              description:
                'A globally unique name for an identity or service provider. Values: urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified, urn:oasis:names:tc:SAML:2.0:attrname-format:basic, urn:oasis:names:tc:SAML:2.0:attrname-format:uri.',
              optional: true,
            },
            required: {
              type: 'boolean',
              description: 'If the attribute is required when building a SAML assertion.',
              optional: true,
            },
            source: {
              type: 'json',
              description: 'source',
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the IdP attribute.',
                  optional: true,
                },
                name_by_idp: {
                  type: 'array',
                  description: 'A mapping from IdP ID to attribute name.',
                  items: {
                    type: 'json',
                    description: 'name by idp item',
                    properties: {
                      idp_id: {
                        type: 'string',
                        description: 'The UID of the IdP.',
                        optional: true,
                      },
                      source_name: {
                        type: 'string',
                        description: 'The name of the IdP provided attribute.',
                        optional: true,
                      },
                    },
                  },
                  optional: true,
                },
              },
              optional: true,
            },
          },
        },
        optional: true,
      },
      default_relay_state: {
        type: 'string',
        description:
          'The URL that the user will be redirected to after a successful login for IDP initiated logins.',
        optional: true,
      },
      idp_entity_id: {
        type: 'string',
        description: 'The unique identifier for your SaaS application.',
        optional: true,
      },
      name_id_format: {
        type: 'string',
        description:
          'The format of the name identifier sent to the SaaS application. Values: id, email.',
        optional: true,
      },
      name_id_transform_jsonata: {
        type: 'string',
        description:
          "A [JSONata](https://jsonata.org/) expression that transforms an application's user identities into a NameID value for its SAML assertion. This expression should evaluate to a singular string. The output of this expression can override the `name_id_format` setting.",
        optional: true,
      },
      public_key: {
        type: 'string',
        description: 'The Access public certificate that will be used to verify your identity.',
        optional: true,
      },
      saml_attribute_transform_jsonata: {
        type: 'string',
        description:
          "A [JSONata] (https://jsonata.org/) expression that transforms an application's user identities into attribute assertions in the SAML response.",
        optional: true,
      },
      sp_entity_id: {
        type: 'string',
        description: 'A globally unique name for an identity or service provider.',
        optional: true,
      },
      sso_endpoint: {
        type: 'string',
        description: 'The endpoint where your SaaS application will send login requests.',
        optional: true,
      },
      updated_at: {
        type: 'string',
        description: 'updated at',
        optional: true,
      },
      access_token_lifetime: {
        type: 'string',
        description:
          'The lifetime of the OIDC Access Token after creation. Valid units are m,h. Must be greater than or equal to 1m and less than or equal to 24h.',
        optional: true,
      },
      allow_pkce_without_client_secret: {
        type: 'boolean',
        description:
          'If client secret should be required on the token endpoint when authorization_code_with_pkce grant is used.',
        optional: true,
      },
      app_launcher_url: {
        type: 'string',
        description: 'The URL where this applications tile redirects users',
        optional: true,
      },
      client_id: {
        type: 'string',
        description: 'The application client id',
        optional: true,
      },
      client_secret: {
        type: 'string',
        description: 'The application client secret, only returned on POST request.',
        optional: true,
      },
      custom_claims: {
        type: 'array',
        description: 'custom claims',
        items: {
          type: 'json',
          description: 'custom claims item',
          properties: {
            name: {
              type: 'string',
              description: 'The name of the claim.',
              optional: true,
            },
            required: {
              type: 'boolean',
              description: 'If the claim is required when building an OIDC token.',
              optional: true,
            },
            scope: {
              type: 'string',
              description: 'The scope of the claim. Values: groups, profile, email, openid.',
              optional: true,
            },
            source: {
              type: 'json',
              description: 'source',
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the IdP claim.',
                  optional: true,
                },
                name_by_idp: {
                  type: 'json',
                  description: 'A mapping from IdP ID to claim name.',
                  optional: true,
                },
              },
              optional: true,
            },
          },
        },
        optional: true,
      },
      grant_types: {
        type: 'array',
        description: 'The OIDC flows supported by this application',
        items: {
          type: 'string',
          description:
            'grant types item Values: authorization_code, authorization_code_with_pkce, refresh_tokens, hybrid, implicit.',
        },
        optional: true,
      },
      group_filter_regex: {
        type: 'string',
        description:
          'A regex to filter Cloudflare groups returned in ID token and userinfo endpoint',
        optional: true,
      },
      hybrid_and_implicit_options: {
        type: 'json',
        description: 'hybrid and implicit options',
        properties: {
          return_access_token_from_authorization_endpoint: {
            type: 'boolean',
            description:
              'If an Access Token should be returned from the OIDC Authorization endpoint',
            optional: true,
          },
          return_id_token_from_authorization_endpoint: {
            type: 'boolean',
            description: 'If an ID Token should be returned from the OIDC Authorization endpoint',
            optional: true,
          },
        },
        optional: true,
      },
      redirect_uris: {
        type: 'array',
        description:
          "The permitted URL's for Cloudflare to return Authorization codes and Access/ID tokens",
        items: {
          type: 'string',
          description: 'redirect uris item',
        },
        optional: true,
      },
      refresh_token_options: {
        type: 'json',
        description: 'refresh token options',
        properties: {
          lifetime: {
            type: 'string',
            description:
              'How long a refresh token will be valid for after creation. Valid units are m,h,d. Must be longer than 1m.',
            optional: true,
          },
        },
        optional: true,
      },
      scopes: {
        type: 'array',
        description:
          'Define the user information shared with access, "offline_access" scope will be automatically enabled if refresh tokens are enabled',
        items: {
          type: 'string',
          description: 'scopes item Values: openid, groups, email, profile.',
        },
        optional: true,
      },
    },
    nullable: true,
  },
  app_launcher_logo_url: {
    type: 'string',
    description: 'The image URL of the logo shown in the App Launcher header.',
    nullable: true,
  },
  bg_color: {
    type: 'string',
    description: 'The background color of the App Launcher page.',
    nullable: true,
  },
  footer_links: {
    type: 'array',
    description: 'The links in the App Launcher footer.',
    items: {
      type: 'json',
      description: 'footer links item',
      properties: {
        name: {
          type: 'string',
          description: 'The hypertext in the footer link.',
          optional: false,
        },
        url: {
          type: 'string',
          description: 'the hyperlink in the footer link.',
          optional: false,
        },
      },
    },
  },
  header_bg_color: {
    type: 'string',
    description: 'The background color of the App Launcher header.',
    nullable: true,
  },
  landing_page_design: {
    type: 'json',
    description: 'The design of the App Launcher landing page shown to users when they log in.',
    properties: {
      button_color: {
        type: 'string',
        description: 'The background color of the log in button on the landing page.',
        optional: true,
      },
      button_text_color: {
        type: 'string',
        description: 'The color of the text in the log in button on the landing page.',
        optional: true,
      },
      image_url: {
        type: 'string',
        description: 'The URL of the image shown on the landing page.',
        optional: true,
      },
      message: {
        type: 'string',
        description: 'The message shown on the landing page.',
        optional: true,
      },
      title: {
        type: 'string',
        description: 'The title shown on the landing page.',
        optional: true,
      },
    },
    nullable: true,
  },
  skip_app_launcher_login_page: {
    type: 'boolean',
    description: 'Determines when to skip the App Launcher landing page.',
    nullable: true,
  },
  target_criteria: {
    type: 'array',
    description: 'target criteria',
    items: {
      type: 'json',
      description:
        'Defines targets covered by the application. Use either the legacy top-level target_attributes format or the rule format, but not both. The rule format requires include; require and exclude are optional.',
      properties: {
        exclude: {
          type: 'json',
          description:
            'Selectors within an include, require, or exclude rule. At least one of target_attributes or tags must be non-empty.',
          properties: {
            tags: {
              type: 'json',
              description: "Map of target tag keys to values. Values within a key are OR'd.",
              optional: true,
            },
            target_attributes: {
              type: 'json',
              description:
                'Hostname selector map for include, require, or exclude rules. This is distinct from the deprecated top-level target_attributes field and only supports the hostname key.',
              properties: {
                hostname: {
                  type: 'array',
                  description: 'hostname',
                  items: {
                    type: 'string',
                    description: 'hostname item',
                  },
                  optional: true,
                },
              },
              optional: true,
            },
          },
          optional: true,
        },
        include: {
          type: 'json',
          description:
            'Selectors within an include, require, or exclude rule. At least one of target_attributes or tags must be non-empty.',
          properties: {
            tags: {
              type: 'json',
              description: "Map of target tag keys to values. Values within a key are OR'd.",
              optional: true,
            },
            target_attributes: {
              type: 'json',
              description:
                'Hostname selector map for include, require, or exclude rules. This is distinct from the deprecated top-level target_attributes field and only supports the hostname key.',
              properties: {
                hostname: {
                  type: 'array',
                  description: 'hostname',
                  items: {
                    type: 'string',
                    description: 'hostname item',
                  },
                  optional: true,
                },
              },
              optional: true,
            },
          },
          optional: true,
        },
        port: {
          type: 'number',
          description:
            'The port that the targets use for the chosen communication protocol. A port cannot be assigned to multiple protocols.',
          optional: false,
        },
        require: {
          type: 'json',
          description:
            'Selectors within an include, require, or exclude rule. At least one of target_attributes or tags must be non-empty.',
          properties: {
            tags: {
              type: 'json',
              description: "Map of target tag keys to values. Values within a key are OR'd.",
              optional: true,
            },
            target_attributes: {
              type: 'json',
              description:
                'Hostname selector map for include, require, or exclude rules. This is distinct from the deprecated top-level target_attributes field and only supports the hostname key.',
              properties: {
                hostname: {
                  type: 'array',
                  description: 'hostname',
                  items: {
                    type: 'string',
                    description: 'hostname item',
                  },
                  optional: true,
                },
              },
              optional: true,
            },
          },
          optional: true,
        },
        target_attributes: {
          type: 'json',
          description: 'Contains a map of target attribute keys to target attribute values.',
          optional: true,
        },
        protocol: {
          type: 'string',
          description: 'The communication protocol your application secures. Values: RDP.',
          optional: false,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const ACCESS_GROUP_OUTPUTS = {
  created_at: {
    type: 'string',
    description: 'created at',
    nullable: true,
  },
  exclude: {
    type: 'array',
    description:
      'Rules evaluated with a NOT logical operator. To match a policy, a user cannot meet any of the Exclude rules.',
    items: ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_FIELDS,
  },
  id: {
    type: 'string',
    description: 'UUID.',
    nullable: true,
  },
  include: ACCESS_GROUP_OUTPUTS_INCLUDE_FIELDS,
  is_default: ACCESS_GROUP_OUTPUTS_IS_DEFAULT_FIELDS,
  name: {
    type: 'string',
    description: 'The name of the Access group.',
    nullable: true,
  },
  require: ACCESS_GROUP_OUTPUTS_IS_DEFAULT_FIELDS,
  updated_at: {
    type: 'string',
    description: 'updated at',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const ACCESS_POLICY_OUTPUTS = {
  approval_groups: {
    type: 'array',
    description: 'Administrators who can approve a temporary authentication request.',
    items: {
      type: 'json',
      description:
        'A group of email addresses that can approve a temporary authentication request.',
      properties: {
        approvals_needed: {
          type: 'number',
          description: 'The number of approvals needed to obtain access.',
          optional: false,
        },
        email_addresses: {
          type: 'array',
          description: 'A list of emails that can approve the access request.',
          items: {
            type: 'string',
            description: 'email addresses item',
          },
          optional: true,
        },
        email_list_uuid: {
          type: 'string',
          description: 'The UUID of an re-usable email list.',
          optional: true,
        },
      },
    },
  },
  approval_required: {
    type: 'boolean',
    description:
      'Requires the user to request access from an administrator at the start of each session.',
    nullable: true,
  },
  connection_rules: {
    type: 'json',
    description:
      'The rules that define how users may connect to the targets secured by your application.',
    properties: {
      rdp: {
        type: 'json',
        description: 'The RDP-specific rules that define clipboard behavior for RDP connections.',
        properties: {
          allowed_clipboard_local_to_remote_formats: {
            type: 'array',
            description:
              'Clipboard formats allowed when copying from local machine to remote RDP session.',
            items: {
              type: 'string',
              description: 'Clipboard format for RDP connections. Values: text, file.',
            },
            optional: true,
          },
          allowed_clipboard_remote_to_local_formats: {
            type: 'array',
            description:
              'Clipboard formats allowed when copying from remote RDP session to local machine.',
            items: {
              type: 'string',
              description: 'Clipboard format for RDP connections. Values: text, file.',
            },
            optional: true,
          },
        },
        optional: true,
      },
      ssh: {
        type: 'json',
        description:
          'The SSH-specific rules that define how users may connect to the targets secured by your application.',
        properties: {
          allow_email_alias: {
            type: 'boolean',
            description: 'Enables using Identity Provider email alias as SSH username.',
            optional: true,
          },
          usernames: {
            type: 'array',
            description: 'Contains the Unix usernames that may be used when connecting over SSH.',
            items: {
              type: 'string',
              description: 'usernames item',
            },
            optional: false,
          },
        },
        optional: true,
      },
    },
    nullable: true,
  },
  isolation_required: {
    type: 'boolean',
    description:
      "Require this application to be served in an isolated browser for users matching this policy. 'Client Web Isolation' must be on for the account in order to use this feature.",
    nullable: true,
  },
  mfa_config: {
    type: 'json',
    description:
      'Configures multi-factor authentication (MFA) settings for infrastructure applications.',
    properties: {
      allowed_authenticators: {
        type: 'array',
        description:
          'Lists the MFA methods that users can authenticate with. For infrastructure applications, supported values are `piv_key` and `ssh_fido2_key`.',
        items: {
          type: 'string',
          description: 'allowed authenticators item Values: piv_key, ssh_fido2_key.',
        },
        optional: true,
      },
      mfa_disabled: {
        type: 'boolean',
        description:
          'Indicates whether to disable MFA for this resource. This option is available at the application and policy level.',
        optional: true,
      },
      session_duration: {
        type: 'string',
        description:
          'Defines the duration of an MFA session. Must be in minutes (m) or hours (h). Minimum: 0m. Maximum: 720h (30 days). Examples: `5m` or `24h`.',
        optional: true,
      },
    },
    nullable: true,
  },
  purpose_justification_prompt: {
    type: 'string',
    description: 'A custom message that will appear on the purpose justification screen.',
    nullable: true,
  },
  purpose_justification_required: {
    type: 'boolean',
    description: 'Require users to enter a justification when they log in to the application.',
    nullable: true,
  },
  session_duration: {
    type: 'string',
    description:
      'The amount of time that tokens issued for the application will be valid. Must be in the format `300ms` or `2h45m`. Valid time units are: ns, us (or \u00b5s), ms, s, m, h.',
    nullable: true,
  },
  created_at: {
    type: 'string',
    description: 'created at',
    nullable: true,
  },
  decision: {
    type: 'string',
    description:
      'The action Access will take if a user matches this policy. Infrastructure application policies can only use the Allow action. Values: allow, deny, non_identity, bypass.',
    nullable: true,
  },
  exclude: {
    type: 'array',
    description:
      'Rules evaluated with a NOT logical operator. To match the policy, a user cannot meet any of the Exclude rules.',
    items: ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_FIELDS,
  },
  id: {
    type: 'string',
    description: 'The UUID of the policy',
    nullable: true,
  },
  include: ACCESS_GROUP_OUTPUTS_INCLUDE_FIELDS,
  name: {
    type: 'string',
    description: 'The name of the Access policy.',
    nullable: true,
  },
  require: {
    type: 'array',
    description:
      'Rules evaluated with an AND logical operator. To match the policy, a user must meet all of the Require rules.',
    items: ACCESS_APPLICATION_OUTPUTS_POLICIES_ITEMS_PROPERTIES_EXCLUDE_ITEMS_FIELDS,
  },
  updated_at: {
    type: 'string',
    description: 'updated at',
    nullable: true,
  },
  account_id: {
    type: 'string',
    description: 'Identifier.',
    nullable: true,
  },
  precedence: {
    type: 'number',
    description:
      'The order of execution for this policy. Must be unique for each policy within an app.',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CERTIFICATE_OUTPUTS = {
  certificate_authority: {
    type: 'string',
    description:
      'Certificate Authority selected for the order. For information on any certificate authority specific details or restrictions [see this page for more details](https://developers.cloudflare.com/ssl/reference/certificate-authorities). Values: google, lets_encrypt, ssl_com.',
    nullable: true,
  },
  certificates: {
    type: 'array',
    description: 'Array of certificates in this pack.',
    items: {
      type: 'json',
      description: 'An individual certificate within a certificate pack.',
      properties: {
        bundle_method: {
          type: 'string',
          description: 'Certificate bundle method.',
          optional: true,
        },
        expires_on: {
          type: 'string',
          description: 'When the certificate from the authority expires.',
          optional: true,
        },
        geo_restrictions: {
          type: 'json',
          description: 'Specify the region where your private key can be held locally.',
          properties: {
            label: {
              type: 'string',
              description: 'label Values: us, eu, highest_security.',
              optional: true,
            },
          },
          optional: true,
        },
        hosts: {
          type: 'array',
          description: 'Hostnames covered by this certificate.',
          items: {
            type: 'string',
            description: 'hosts item',
          },
          optional: false,
        },
        id: {
          type: 'string',
          description: 'Certificate identifier.',
          optional: false,
        },
        issuer: {
          type: 'string',
          description: 'The certificate authority that issued the certificate.',
          optional: true,
        },
        modified_on: {
          type: 'string',
          description: 'When the certificate was last modified.',
          optional: true,
        },
        priority: {
          type: 'number',
          description: 'The order/priority in which the certificate will be used.',
          optional: true,
        },
        signature: {
          type: 'string',
          description: 'The type of hash used for the certificate.',
          optional: true,
        },
        status: {
          type: 'string',
          description: 'Certificate status.',
          optional: false,
        },
        uploaded_on: {
          type: 'string',
          description: 'When the certificate was uploaded to Cloudflare.',
          optional: true,
        },
        zone_id: {
          type: 'string',
          description: 'Identifier.',
          optional: true,
        },
      },
    },
  },
  cloudflare_branding: {
    type: 'boolean',
    description:
      'Whether or not to add Cloudflare Branding for the order. This will add a subdomain of sni.cloudflaressl.com as the Common Name if set to true.',
    nullable: true,
  },
  dcv_delegation_records: {
    type: 'array',
    description: 'DCV Delegation records for domain validation.',
    items: CERTIFICATE_OUTPUTS_DCV_DELEGATION_RECORDS_ITEMS_FIELDS,
  },
  hosts: {
    type: 'array',
    description:
      'Comma separated list of valid host names for the certificate packs. Must contain the zone apex, may not contain more than 50 hosts, and may not be empty.',
    items: {
      type: 'string',
      description: 'hosts item',
    },
  },
  id: {
    type: 'string',
    description: 'The unique identifier for a certificate_pack.',
    nullable: true,
  },
  primary_certificate: {
    type: 'string',
    description: 'Identifier of the primary certificate in a pack.',
    nullable: true,
  },
  status: {
    type: 'string',
    description: 'Status of certificate pack.',
    nullable: true,
  },
  type: {
    type: 'string',
    description:
      'Type of certificate pack. Values: mh_custom, managed_hostname, sni_custom, universal, advanced, total_tls, keyless, legacy_custom.',
    nullable: true,
  },
  validation_errors: {
    type: 'array',
    description:
      'Domain validation errors that have been received by the certificate authority (CA).',
    items: {
      type: 'json',
      description: 'validation errors item',
      properties: {
        message: {
          type: 'string',
          description: 'A domain validation error.',
          optional: true,
        },
      },
    },
  },
  validation_method: {
    type: 'string',
    description: 'Validation Method selected for the order. Values: txt, http, email.',
    nullable: true,
  },
  validation_records: {
    type: 'array',
    description: "Certificates' validation records.",
    items: CERTIFICATE_OUTPUTS_DCV_DELEGATION_RECORDS_ITEMS_FIELDS,
  },
  validity_days: {
    type: 'number',
    description: 'Validity Days selected for the order. Values: 14, 30, 90, 365.',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const DNS_RECORD_OUTPUTS = {
  comment: {
    type: 'string',
    description:
      'Comments or notes about the DNS record. This field has no effect on DNS responses.',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'Complete DNS record name, including the zone name, in Punycode.',
    nullable: true,
  },
  proxied: {
    type: 'boolean',
    description:
      'Whether the record is receiving the performance and security benefits of Cloudflare.',
    nullable: true,
  },
  settings: {
    type: 'json',
    description: 'Settings for the DNS record.',
    properties: {
      ipv4_only: {
        type: 'boolean',
        description:
          'When enabled, only A records will be generated, and AAAA records will not be created. This setting is intended for exceptional cases. Note that this option only applies to proxied records and it has no effect on whether Cloudflare communicates with the origin using IPv4 or IPv6.',
        optional: true,
      },
      ipv6_only: {
        type: 'boolean',
        description:
          'When enabled, only AAAA records will be generated, and A records will not be created. This setting is intended for exceptional cases. Note that this option only applies to proxied records and it has no effect on whether Cloudflare communicates with the origin using IPv4 or IPv6.',
        optional: true,
      },
      flatten_cname: {
        type: 'boolean',
        description:
          'If enabled, causes the CNAME record to be resolved externally and the resulting address records (e.g., A and AAAA) to be returned instead of the CNAME record itself. This setting is unavailable for proxied records, since they are always flattened.',
        optional: true,
      },
    },
    nullable: true,
  },
  tags: {
    type: 'array',
    description: 'Custom tags for the DNS record. This field has no effect on DNS responses.',
    items: {
      type: 'string',
      description:
        'Individual tag of the form name:value (the name must consist of only letters, numbers, underscores and hyphens)',
    },
  },
  ttl: {
    type: 'number',
    description:
      "Time To Live (TTL) of the DNS record in seconds. Setting to 1 means 'automatic'. Value must be between 60 and 86400, with the minimum reduced to 30 for Enterprise zones. Values: 1.",
    nullable: true,
  },
  content: {
    type: 'string',
    description: "Formatted URI content. See 'data' to set URI properties.",
    nullable: true,
  },
  private_routing: {
    type: 'boolean',
    description: 'Enables private network routing to the origin.',
    nullable: true,
  },
  type: {
    type: 'string',
    description:
      'Record type. Values: A, AAAA, CNAME, MX, NS, OPENPGPKEY, PTR, TXT, CAA, CERT, DNSKEY, DS, HTTPS, LOC, NAPTR, SMIMEA, SRV, SSHFP, SVCB, TLSA, URI.',
    nullable: true,
  },
  priority: {
    type: 'number',
    description:
      'Required for MX and URI records; ignored for other record types (but may still be returned by the API). Records with lower priorities are preferred. This field is to be deprecated in favor of the priority field within the data map.',
    nullable: true,
  },
  data: {
    type: 'json',
    description: 'Structured record data. The available fields depend on the DNS record type.',
    properties: {
      flags: {
        type: 'json',
        description: 'Flags.',
        optional: true,
      },
      tag: {
        type: 'string',
        description:
          'Name of the property controlled by this record (e.g.: issue, issuewild, iodef).',
        optional: true,
      },
      value: {
        type: 'string',
        description: 'Value.',
        optional: true,
      },
      algorithm: {
        type: 'number',
        description: 'Algorithm.',
        optional: true,
      },
      certificate: {
        type: 'string',
        description: 'Certificate.',
        optional: true,
      },
      key_tag: {
        type: 'number',
        description: 'Key Tag.',
        optional: true,
      },
      type: {
        type: 'number',
        description: 'Type.',
        optional: true,
      },
      protocol: {
        type: 'number',
        description: 'Protocol.',
        optional: true,
      },
      public_key: {
        type: 'string',
        description: 'Public Key.',
        optional: true,
      },
      digest: {
        type: 'string',
        description: 'Digest.',
        optional: true,
      },
      digest_type: {
        type: 'number',
        description: 'Digest Type.',
        optional: true,
      },
      priority: {
        type: 'number',
        description: 'Priority.',
        optional: true,
      },
      target: {
        type: 'string',
        description: 'The record content.',
        optional: true,
      },
      altitude: {
        type: 'number',
        description: 'Altitude of location in meters.',
        optional: true,
      },
      lat_degrees: {
        type: 'number',
        description: 'Degrees of latitude.',
        optional: true,
      },
      lat_direction: {
        type: 'string',
        description: 'Latitude direction. Values: N, S.',
        optional: true,
      },
      lat_minutes: {
        type: 'number',
        description: 'Minutes of latitude.',
        optional: true,
      },
      lat_seconds: {
        type: 'number',
        description: 'Seconds of latitude.',
        optional: true,
      },
      long_degrees: {
        type: 'number',
        description: 'Degrees of longitude.',
        optional: true,
      },
      long_direction: {
        type: 'string',
        description: 'Longitude direction. Values: E, W.',
        optional: true,
      },
      long_minutes: {
        type: 'number',
        description: 'Minutes of longitude.',
        optional: true,
      },
      long_seconds: {
        type: 'number',
        description: 'Seconds of longitude.',
        optional: true,
      },
      precision_horz: {
        type: 'number',
        description: 'Horizontal precision of location.',
        optional: true,
      },
      precision_vert: {
        type: 'number',
        description: 'Vertical precision of location.',
        optional: true,
      },
      size: {
        type: 'number',
        description: 'Size of location in meters.',
        optional: true,
      },
      order: {
        type: 'number',
        description: 'Order.',
        optional: true,
      },
      preference: {
        type: 'number',
        description: 'Preference.',
        optional: true,
      },
      regex: {
        type: 'string',
        description: 'Regex.',
        optional: true,
      },
      replacement: {
        type: 'string',
        description: 'Replacement.',
        optional: true,
      },
      service: {
        type: 'string',
        description: 'Service.',
        optional: true,
      },
      matching_type: {
        type: 'number',
        description: 'Matching Type.',
        optional: true,
      },
      selector: {
        type: 'number',
        description: 'Selector.',
        optional: true,
      },
      usage: {
        type: 'number',
        description: 'Usage.',
        optional: true,
      },
      port: {
        type: 'number',
        description: 'The port of the service.',
        optional: true,
      },
      weight: {
        type: 'number',
        description: 'The record weight.',
        optional: true,
      },
      fingerprint: {
        type: 'string',
        description: 'Fingerprint.',
        optional: true,
      },
    },
    nullable: true,
  },
  comment_modified_on: {
    type: 'string',
    description: 'When the record comment was last modified. Omitted if there is no comment.',
    nullable: true,
  },
  created_on: {
    type: 'string',
    description: 'When the record was created.',
    nullable: true,
  },
  id: {
    type: 'string',
    description: 'Identifier.',
    nullable: true,
  },
  meta: {
    type: 'json',
    description: 'Extra Cloudflare-specific metadata about the record.',
    properties: {
      dead_glue: {
        type: 'boolean',
        description:
          'Whether this glue record is not served because a shallower NS delegation takes precedence over the deeper delegation that needs it.',
        optional: true,
      },
      is_glue: {
        type: 'boolean',
        description:
          'Whether this A or AAAA record is glue for a subdomain NS delegation. See [Glue records](https://developers.cloudflare.com/dns/manage-dns-records/reference/shadowed-records#glue-records).',
        optional: true,
      },
      shadowed_by: {
        type: 'array',
        description:
          'IDs of the NS records that shadow this record. See [Shadowed records](https://developers.cloudflare.com/dns/manage-dns-records/reference/shadowed-records).',
        items: {
          type: 'string',
          description: 'shadowed by item',
        },
        optional: true,
      },
      shadowed_records_count: {
        type: 'number',
        description:
          'Number of records shadowed by this NS delegation. See [Shadowed records](https://developers.cloudflare.com/dns/manage-dns-records/reference/shadowed-records).',
        optional: true,
      },
    },
    nullable: true,
  },
  modified_on: {
    type: 'string',
    description: 'When the record was last modified.',
    nullable: true,
  },
  proxiable: {
    type: 'boolean',
    description: 'Whether the record can be proxied by Cloudflare or not.',
    nullable: true,
  },
  tags_modified_on: {
    type: 'string',
    description: 'When the record tags were last modified. Omitted if there are no tags.',
    nullable: true,
  },
  zone_id: {
    type: 'string',
    description: 'Legacy DNS response zone ID when returned by Cloudflare',
    nullable: true,
  },
  zone_name: {
    type: 'string',
    description: 'Legacy DNS response zone name when returned by Cloudflare',
    nullable: true,
  },
  locked: {
    type: 'boolean',
    description: 'Legacy DNS response lock flag when returned by Cloudflare',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const IDENTITY_PROVIDER_OUTPUTS = {
  config: {
    type: 'json',
    description:
      'The configuration parameters for the identity provider. To view the required parameters for a specific provider, refer to our [developer documentation](https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/).',
    properties: {
      client_id: {
        type: 'string',
        description: 'Your OAuth Client ID',
        optional: true,
      },
      client_secret: {
        type: 'string',
        description: 'Your OAuth Client Secret',
        optional: true,
      },
      claims: {
        type: 'array',
        description: 'Custom claims',
        items: {
          type: 'string',
          description: 'claims item',
        },
        optional: true,
      },
      email_claim_name: {
        type: 'string',
        description: 'The claim name for email in the id_token response.',
        optional: true,
      },
      conditional_access_enabled: {
        type: 'boolean',
        description: 'Should Cloudflare try to load authentication contexts from your account',
        optional: true,
      },
      directory_id: {
        type: 'string',
        description: 'Your Azure directory uuid',
        optional: true,
      },
      prompt: {
        type: 'string',
        description:
          'Configures the prompt behavior for Google authentication. Values: login, select_account, none, consent.',
        optional: true,
      },
      support_groups: {
        type: 'boolean',
        description: 'Should Cloudflare try to load groups from your account',
        optional: true,
      },
      centrify_account: {
        type: 'string',
        description: 'Your centrify account url',
        optional: true,
      },
      centrify_app_id: {
        type: 'string',
        description: 'Your centrify app id',
        optional: true,
      },
      apps_domain: {
        type: 'string',
        description: 'Your companies TLD',
        optional: true,
      },
      use_login_hint: {
        type: 'boolean',
        description:
          'Whether to use a previously authenticated Access email as a Google login hint when exactly one email matches the Workspace domain.',
        optional: true,
      },
      auth_url: {
        type: 'string',
        description: 'The authorization_endpoint URL of your IdP',
        optional: true,
      },
      certs_url: {
        type: 'string',
        description: 'The jwks_uri endpoint of your IdP to allow the IdP keys to sign the tokens',
        optional: true,
      },
      pkce_enabled: {
        type: 'boolean',
        description: 'Enable Proof Key for Code Exchange (PKCE)',
        optional: true,
      },
      scopes: {
        type: 'array',
        description: 'OAuth scopes',
        items: {
          type: 'string',
          description: 'scopes item',
        },
        optional: true,
      },
      token_url: {
        type: 'string',
        description: 'The token_endpoint URL of your IdP',
        optional: true,
      },
      issuer_url: {
        type: 'string',
        description: 'IdP Entity ID or Issuer URL',
        optional: true,
      },
      authorization_server_id: {
        type: 'string',
        description: 'Your okta authorization server id',
        optional: true,
      },
      okta_account: {
        type: 'string',
        description: 'Your okta account url',
        optional: true,
      },
      onelogin_account: {
        type: 'string',
        description: 'Your OneLogin account url',
        optional: true,
      },
      ping_env_id: {
        type: 'string',
        description: 'Your PingOne environment identifier',
        optional: true,
      },
      attributes: {
        type: 'array',
        description:
          'A list of SAML attribute names that will be added to your signed JWT token and can be used in SAML policy rules.',
        items: {
          type: 'string',
          description: 'attributes item',
        },
        optional: true,
      },
      email_attribute_name: {
        type: 'string',
        description: 'The attribute name for email in the SAML response.',
        optional: true,
      },
      enable_encryption: {
        type: 'boolean',
        description: 'Enable SAML assertion encryption.',
        optional: true,
      },
      force_authn: {
        type: 'boolean',
        description:
          'Asks the IdP to reauthenticate the user for each SAML authentication request.',
        optional: true,
      },
      header_attributes: {
        type: 'array',
        description:
          'Add a list of attribute names that will be returned in the response header from the Access callback.',
        items: {
          type: 'json',
          description: 'header attributes item',
          properties: {
            attribute_name: {
              type: 'string',
              description: 'attribute name from the IDP',
              optional: true,
            },
            header_name: {
              type: 'string',
              description: 'header that will be added on the request to the origin',
              optional: true,
            },
          },
        },
        optional: true,
      },
      idp_public_certs: {
        type: 'array',
        description: 'X509 certificate to verify the signature in the SAML authentication response',
        items: {
          type: 'string',
          description: 'idp public certs item',
        },
        optional: true,
      },
      max_sso_url_length: {
        type: 'number',
        description:
          'The maximum URL length the IdP accepts for the SSO redirect URL. When the constructed SSO URL would exceed this length, the RelayState is stored server-side and a short nonce is passed to the IdP instead. Set this if your IdP enforces a URL length limit.',
        optional: true,
      },
      sign_request: {
        type: 'boolean',
        description:
          'Sign the SAML authentication request with Access credentials. To verify the signature, use the public key from the Access certs endpoints.',
        optional: true,
      },
      sso_target_url: {
        type: 'string',
        description: 'URL to send the SAML authentication requests to',
        optional: true,
      },
      redirect_url: {
        type: 'string',
        description: 'redirect url',
        optional: true,
      },
      restrict_to_account_members: {
        type: 'boolean',
        description:
          'When enabled, only users who are members of your Cloudflare account can authenticate through this identity provider. When disabled, any user with a Cloudflare account can authenticate, subject to your Access policies.',
        optional: true,
      },
      login_page_auto_prompt: {
        type: 'boolean',
        description:
          'When enabled, the Access login page automatically prompts the user to authenticate with a passkey.',
        optional: true,
      },
    },
    nullable: true,
  },
  id: {
    type: 'string',
    description: 'UUID.',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'The name of the identity provider, shown to users on the login page.',
    nullable: true,
  },
  read_only: {
    type: 'boolean',
    description:
      'Indicates that the identity provider is immutable and cannot be updated or deleted via the API.',
    nullable: true,
  },
  saml_certificate_set: {
    type: 'json',
    description:
      'A SAML encryption certificate set containing current and optionally previous certificates for encryption key rotation.',
    properties: {
      created_at: {
        type: 'string',
        description: 'Timestamp when the certificate set was created',
        optional: false,
      },
      current_certificate: {
        type: 'json',
        description: 'A single SAML encryption certificate with metadata',
        properties: {
          is_current: {
            type: 'boolean',
            description: 'Indicates whether this is the currently active certificate',
            optional: false,
          },
          not_after: {
            type: 'string',
            description:
              'Certificate expiration date. Certificates are automatically rotated 30 days before expiration.',
            optional: false,
          },
          public_certificate: {
            type: 'string',
            description:
              'PEM-encoded X.509 certificate containing the public key. Configure this certificate in your external SAML Identity Provider to enable encryption.',
            optional: false,
          },
          uid: {
            type: 'string',
            description: 'Unique identifier for the certificate',
            optional: false,
          },
        },
        optional: true,
      },
      previous_certificate: {
        type: 'json',
        description:
          'The previous certificate, maintained during rotation to ensure continuity. Null if no rotation has occurred. Mirrors the structure of `saml_certificate`.',
        optional: true,
      },
      uid: {
        type: 'string',
        description: 'Unique identifier for the certificate set',
        optional: false,
      },
      updated_at: {
        type: 'string',
        description: 'Timestamp when the certificate set was last updated (e.g., during rotation)',
        optional: false,
      },
    },
    nullable: true,
  },
  saml_certificate_set_id: {
    type: 'string',
    description:
      'The UID of the SAML encryption certificate set assigned to this Identity Provider. Only present for SAML identity providers with encryption configured. Create a certificate set via POST to `/identity_providers/{id}/saml_certificate`.',
    nullable: true,
  },
  scim_config: {
    type: 'json',
    description:
      'The configuration settings for enabling a System for Cross-Domain Identity Management (SCIM) with the identity provider.',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'A flag to enable or disable SCIM for the identity provider.',
        optional: true,
      },
      identity_update_behavior: {
        type: 'string',
        description:
          'Indicates how a SCIM event updates a user identity used for policy evaluation.',
        optional: true,
      },
      scim_base_url: {
        type: 'string',
        description: "The base URL of Cloudflare's SCIM V2.0 API endpoint.",
        optional: true,
      },
      seat_deprovision: {
        type: 'boolean',
        description:
          "A flag to remove a user's seat in Zero Trust when they have been deprovisioned in the Identity Provider. This cannot be enabled unless user_deprovision is also enabled.",
        optional: true,
      },
      secret: {
        type: 'string',
        description:
          'A read-only token generated when the SCIM integration is enabled for the first time. It is redacted on subsequent requests. If you lose this you will need to refresh it at /access/identity_providers/:idpID/refresh_scim_secret.',
        optional: true,
      },
      user_deprovision: {
        type: 'boolean',
        description:
          "A flag to enable revoking a user's session in Access and Gateway when they have been deprovisioned in the Identity Provider.",
        optional: true,
      },
    },
    nullable: true,
  },
  type: {
    type: 'string',
    description: 'The type of identity provider.',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const LIST_RULESETS_OUTPUTS = {
  description: {
    type: 'string',
    description: 'An informative description of the ruleset.',
    nullable: true,
  },
  id: {
    type: 'string',
    description: 'The unique ID of the ruleset.',
    nullable: true,
  },
  last_updated: {
    type: 'string',
    description: 'The timestamp of when the ruleset was last modified.',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'The human-readable name of the ruleset.',
    nullable: true,
  },
  version: {
    type: 'string',
    description: 'The version of the ruleset.',
    nullable: true,
  },
  kind: {
    type: 'string',
    description: 'The kind of the ruleset. Values: managed, custom, root, zone.',
    nullable: true,
  },
  phase: {
    type: 'string',
    description: 'The phase of the ruleset.',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const R2_BUCKET_OUTPUTS = {
  creation_date: {
    type: 'string',
    description: 'Creation timestamp.',
    nullable: true,
  },
  jurisdiction: {
    type: 'string',
    description:
      'Jurisdiction where objects in this bucket are guaranteed to be stored. Values: default, eu, us, fedramp, fedramp-high.',
    nullable: true,
  },
  location: {
    type: 'string',
    description: 'Location of the bucket. Values: apac, eeur, enam, weur, wnam, oc.',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'Name of the bucket.',
    nullable: true,
  },
  storage_class: {
    type: 'string',
    description:
      'Storage class for newly uploaded objects, unless specified otherwise. Values: Standard, InfrequentAccess.',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const R2_CORS_OUTPUTS = {
  rules: {
    type: 'array',
    description: 'rules',
    items: {
      type: 'json',
      description: 'rules item',
      properties: {
        allowed: {
          type: 'json',
          description: 'Object specifying allowed origins, methods and headers for this CORS rule.',
          properties: {
            headers: {
              type: 'array',
              description:
                'Specifies the value for the Access-Control-Allow-Headers header R2 sets when requesting objects in this bucket from a browser. Cross-origin requests that include custom headers (e.g. x-user-id) should specify these headers as AllowedHeaders.',
              items: {
                type: 'string',
                description: 'headers item',
              },
              optional: true,
            },
            methods: {
              type: 'array',
              description:
                'Specifies the value for the Access-Control-Allow-Methods header R2 sets when requesting objects in a bucket from a browser.',
              items: {
                type: 'string',
                description: 'methods item Values: GET, PUT, POST, DELETE, HEAD.',
              },
              optional: false,
            },
            origins: {
              type: 'array',
              description:
                'Specifies the value for the Access-Control-Allow-Origin header R2 sets when requesting objects in a bucket from a browser.',
              items: {
                type: 'string',
                description: 'origins item',
              },
              optional: false,
            },
          },
          optional: false,
        },
        exposeHeaders: {
          type: 'array',
          description:
            'Specifies the headers that can be exposed back, and accessed by, the JavaScript making the cross-origin request. If you need to access headers beyond the safelisted response headers, such as Content-Encoding or cf-cache-status, you must specify it here.',
          items: {
            type: 'string',
            description: 'exposeHeaders item',
          },
          optional: true,
        },
        id: {
          type: 'string',
          description: 'Identifier for this rule.',
          optional: true,
        },
        maxAgeSeconds: {
          type: 'number',
          description:
            'Specifies the amount of time (in seconds) browsers are allowed to cache CORS preflight responses. Browsers may limit this to 2 hours or less, even if the maximum value (86400) is specified.',
          optional: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const R2_LIFECYCLE_OUTPUTS = {
  rules: {
    type: 'array',
    description: 'rules',
    items: {
      type: 'json',
      description: 'rules item',
      properties: {
        abortMultipartUploadsTransition: {
          type: 'json',
          description: 'Transition to abort ongoing multipart uploads.',
          properties: {
            condition: {
              type: 'json',
              description:
                'Condition for lifecycle transitions to apply after an object reaches an age in seconds.',
              properties: {
                maxAge: {
                  type: 'number',
                  description: 'maxAge',
                  optional: false,
                },
                type: {
                  type: 'string',
                  description: 'type Values: Age.',
                  optional: false,
                },
              },
              optional: true,
            },
          },
          optional: true,
        },
        conditions: {
          type: 'json',
          description: 'Conditions that apply to all transitions of this rule.',
          properties: {
            prefix: {
              type: 'string',
              description:
                'Transitions will only apply to objects/uploads in the bucket that start with the given prefix, an empty prefix can be provided to scope rule to all objects/uploads.',
              optional: false,
            },
          },
          optional: false,
        },
        deleteObjectsTransition: {
          type: 'json',
          description: 'Transition to delete objects.',
          properties: {
            condition: {
              type: 'json',
              description: 'Condition for lifecycle transitions to apply on a specific date.',
              properties: {
                maxAge: {
                  type: 'number',
                  description: 'maxAge',
                  optional: true,
                },
                type: {
                  type: 'string',
                  description: 'type Values: Age, Date.',
                  optional: false,
                },
                date: {
                  type: 'string',
                  description: 'date',
                  optional: true,
                },
              },
              optional: true,
            },
          },
          optional: true,
        },
        enabled: {
          type: 'boolean',
          description: 'Whether or not this rule is in effect.',
          optional: false,
        },
        id: {
          type: 'string',
          description: 'Unique identifier for this rule.',
          optional: false,
        },
        storageClassTransitions: {
          type: 'array',
          description: 'Transitions to change the storage class of objects.',
          items: {
            type: 'json',
            description: 'storageClassTransitions item',
            properties: {
              condition: {
                type: 'json',
                description: 'Condition for lifecycle transitions to apply on a specific date.',
                properties: {
                  maxAge: {
                    type: 'number',
                    description: 'maxAge',
                    optional: true,
                  },
                  type: {
                    type: 'string',
                    description: 'type Values: Age, Date.',
                    optional: false,
                  },
                  date: {
                    type: 'string',
                    description: 'date',
                    optional: true,
                  },
                },
                optional: false,
              },
              storageClass: {
                type: 'string',
                description: 'storageClass Values: InfrequentAccess.',
                optional: false,
              },
            },
          },
          optional: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const RESULT_INFO_OUTPUTS = {
  page: {
    type: 'number',
    description: 'Current page',
    optional: true,
  },
  per_page: {
    type: 'number',
    description: 'Page size',
    optional: true,
  },
  count: {
    type: 'number',
    description: 'Count on the current page',
    optional: true,
  },
  total_count: {
    type: 'number',
    description: 'Total matching resources',
    optional: true,
  },
  total_pages: {
    type: 'number',
    description: 'Total pages',
    optional: true,
  },
  cursor: {
    type: 'string',
    description: 'Pagination cursor',
    optional: true,
  },
  cursors: {
    type: 'json',
    description: 'Directional pagination cursors',
    optional: true,
    properties: {
      before: {
        type: 'string',
        optional: true,
      },
      after: {
        type: 'string',
        optional: true,
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const RULESET_OUTPUTS = {
  description: {
    type: 'string',
    description: 'An informative description of the ruleset.',
    nullable: true,
  },
  id: {
    type: 'string',
    description: 'The unique ID of the ruleset.',
    nullable: true,
  },
  last_updated: {
    type: 'string',
    description: 'The timestamp of when the ruleset was last modified.',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'The human-readable name of the ruleset.',
    nullable: true,
  },
  version: {
    type: 'string',
    description: 'The version of the ruleset.',
    nullable: true,
  },
  kind: {
    type: 'string',
    description: 'The kind of the ruleset. Values: managed, custom, root, zone.',
    nullable: true,
  },
  phase: {
    type: 'string',
    description: 'The phase of the ruleset.',
    nullable: true,
  },
  rules: {
    type: 'array',
    description: 'The list of rules in the ruleset.',
    items: {
      type: 'json',
      description: 'rules item',
      properties: {
        action: {
          type: 'string',
          description: 'The action to perform when the rule matches.',
        },
        action_parameters: {
          type: 'json',
          description: "The parameters configuring the rule's action.",
          properties: {
            response: {
              type: 'json',
              description: 'The response to show when the block is applied.',
              properties: {
                content: {
                  type: 'string',
                  description: 'The content to return.',
                  optional: false,
                },
                content_type: {
                  type: 'string',
                  description: 'The type of the content to return.',
                  optional: false,
                },
                status_code: {
                  type: 'number',
                  description: 'The status code to return.',
                  optional: false,
                },
              },
              optional: true,
            },
            algorithms: {
              type: 'array',
              description: 'Custom order for compression algorithms.',
              items: {
                type: 'json',
                description: 'Compression algorithm to enable.',
                properties: {
                  name: {
                    type: 'string',
                    description:
                      'Name of the compression algorithm to enable. Values: none, auto, default, gzip, brotli, zstd.',
                    optional: true,
                  },
                },
              },
              optional: true,
            },
            id: {
              type: 'string',
              description: 'The ID of the ruleset to execute.',
              optional: true,
            },
            matched_data: {
              type: 'json',
              description: 'The configuration to use for matched data logging.',
              properties: {
                public_key: {
                  type: 'string',
                  description: 'The public key to encrypt matched data logs with.',
                  optional: false,
                },
              },
              optional: true,
            },
            overrides: {
              type: 'json',
              description: 'A set of overrides to apply to the target ruleset.',
              properties: {
                action: {
                  type: 'string',
                  description:
                    'An action to override all rules with. This option has lower precedence than rule and category overrides.',
                  optional: true,
                },
                categories: {
                  type: 'array',
                  description:
                    'A list of category-level overrides. This option has the second-highest precedence after rule-level overrides.',
                  items: {
                    type: 'json',
                    description: 'A category-level override.',
                    properties: {
                      action: {
                        type: 'string',
                        description: 'The action to override rules in the category with.',
                        optional: true,
                      },
                      category: {
                        type: 'string',
                        description: 'The name of the category to override.',
                        optional: false,
                      },
                      enabled: {
                        type: 'boolean',
                        description: 'Whether to enable execution of rules in the category.',
                        optional: true,
                      },
                      sensitivity_level: {
                        type: 'string',
                        description:
                          'The sensitivity level to use for rules in the category. This option is only applicable for DDoS phases. Values: default, medium, low, eoff.',
                        optional: true,
                      },
                    },
                  },
                  optional: true,
                },
                enabled: {
                  type: 'boolean',
                  description:
                    'Whether to enable execution of all rules. This option has lower precedence than rule and category overrides.',
                  optional: true,
                },
                rules: {
                  type: 'array',
                  description:
                    'A list of rule-level overrides. This option has the highest precedence.',
                  items: {
                    type: 'json',
                    description: 'A rule-level override.',
                    properties: {
                      action: {
                        type: 'string',
                        description: 'The action to override the rule with.',
                        optional: true,
                      },
                      enabled: {
                        type: 'boolean',
                        description: 'Whether to enable execution of the rule.',
                        optional: true,
                      },
                      id: {
                        type: 'string',
                        description: 'The ID of the rule to override.',
                        optional: false,
                      },
                      score_threshold: {
                        type: 'number',
                        description: 'The score threshold to use for the rule.',
                        optional: true,
                      },
                      sensitivity_level: {
                        type: 'string',
                        description:
                          'The sensitivity level to use for the rule. This option is only applicable for DDoS phases. Values: default, medium, low, eoff.',
                        optional: true,
                      },
                    },
                  },
                  optional: true,
                },
                sensitivity_level: {
                  type: 'string',
                  description:
                    'A sensitivity level to set for all rules. This option has lower precedence than rule and category overrides and is only applicable for DDoS phases. Values: default, medium, low, eoff.',
                  optional: true,
                },
              },
              optional: true,
            },
            cookie_fields: {
              type: 'array',
              description: 'The cookie fields to log.',
              items: {
                type: 'json',
                description: 'The cookie field to log.',
                properties: {
                  name: {
                    type: 'string',
                    description: 'The name of the cookie.',
                    optional: false,
                  },
                },
              },
              optional: true,
            },
            raw_response_fields: {
              type: 'array',
              description: 'The raw response fields to log.',
              items: {
                type: 'json',
                description: 'The raw response field to log.',
                properties: {
                  name: {
                    type: 'string',
                    description: 'The name of the response header.',
                    optional: false,
                  },
                  preserve_duplicates: {
                    type: 'boolean',
                    description: 'Whether to log duplicate values of the same header.',
                    optional: true,
                  },
                },
              },
              optional: true,
            },
            request_fields: {
              type: 'array',
              description: 'The raw request fields to log.',
              items: {
                type: 'json',
                description: 'The raw request field to log.',
                properties: {
                  name: {
                    type: 'string',
                    description: 'The name of the header.',
                    optional: false,
                  },
                },
              },
              optional: true,
            },
            response_fields: {
              type: 'array',
              description: 'The transformed response fields to log.',
              items: {
                type: 'json',
                description: 'The transformed response field to log.',
                properties: {
                  name: {
                    type: 'string',
                    description: 'The name of the response header.',
                    optional: false,
                  },
                  preserve_duplicates: {
                    type: 'boolean',
                    description: 'Whether to log duplicate values of the same header.',
                    optional: true,
                  },
                },
              },
              optional: true,
            },
            transformed_request_fields: {
              type: 'array',
              description: 'The transformed request fields to log.',
              items: {
                type: 'json',
                description: 'The transformed request field to log.',
                properties: {
                  name: {
                    type: 'string',
                    description: 'The name of the header.',
                    optional: false,
                  },
                },
              },
              optional: true,
            },
            from_list: {
              type: 'json',
              description: 'A redirect based on a bulk list lookup.',
              properties: {
                key: {
                  type: 'string',
                  description: 'An expression that evaluates to the list lookup key.',
                  optional: false,
                },
                name: {
                  type: 'string',
                  description: 'The name of the list to match against.',
                  optional: false,
                },
              },
              optional: true,
            },
            from_value: {
              type: 'json',
              description: 'A redirect based on the request properties.',
              properties: {
                preserve_query_string: {
                  type: 'boolean',
                  description: 'Whether to keep the query string of the original request.',
                  optional: true,
                },
                status_code: {
                  type: 'number',
                  description:
                    'The status code to use for the redirect. Values: 301, 302, 303, 307, 308.',
                  optional: true,
                },
                target_url: {
                  type: 'json',
                  description: 'A URL to redirect the request to.',
                  properties: {
                    expression: {
                      type: 'string',
                      description:
                        'An expression that evaluates to a URL to redirect the request to.',
                      optional: true,
                    },
                    value: {
                      type: 'string',
                      description: 'A URL to redirect the request to.',
                      optional: true,
                    },
                  },
                  optional: false,
                },
              },
              optional: true,
            },
            headers: {
              type: 'json',
              description: 'A map of headers to rewrite.',
              optional: true,
            },
            uri: {
              type: 'json',
              description: 'A URI query rewrite.',
              properties: {
                path: {
                  type: 'json',
                  description: 'A URI path rewrite.',
                  properties: {
                    expression: {
                      type: 'string',
                      description:
                        'An expression that evaluates to a value to rewrite the URI path to.',
                      optional: true,
                    },
                    value: {
                      type: 'string',
                      description: 'A value to rewrite the URI path to.',
                      optional: true,
                    },
                  },
                  optional: true,
                },
                query: {
                  type: 'json',
                  description: 'A URI query rewrite.',
                  properties: {
                    expression: {
                      type: 'string',
                      description:
                        'An expression that evaluates to a value to rewrite the URI query to.',
                      optional: true,
                    },
                    value: {
                      type: 'string',
                      description: 'A value to rewrite the URI query to.',
                      optional: true,
                    },
                  },
                  optional: true,
                },
                origin: {
                  type: 'boolean',
                  description: 'Whether to propagate the rewritten URI to origin.',
                  optional: true,
                },
              },
              optional: true,
            },
            host_header: {
              type: 'string',
              description: 'A value to rewrite the HTTP host header to.',
              optional: true,
            },
            origin: {
              type: 'json',
              description: 'An origin to route to.',
              properties: {
                host: {
                  type: 'string',
                  description: 'A resolved host to route to.',
                  optional: true,
                },
                port: {
                  type: 'number',
                  description: 'A destination port to route to.',
                  optional: true,
                },
              },
              optional: true,
            },
            sni: {
              type: 'json',
              description: 'A Server Name Indication (SNI) override.',
              properties: {
                value: {
                  type: 'string',
                  description: 'A value to override the SNI to.',
                  optional: false,
                },
              },
              optional: true,
            },
            increment: {
              type: 'number',
              description:
                'A delta to change the score by, which can be either positive or negative.',
              optional: true,
            },
            content_type: {
              type: 'string',
              description:
                'The content type header to set with the error response. Values: application/json, text/html, text/plain, text/xml.',
              optional: true,
            },
            status_code: {
              type: 'number',
              description: 'The status code to use for the error.',
              optional: true,
            },
            content: {
              type: 'string',
              description: 'The response content.',
              optional: true,
            },
            asset_name: {
              type: 'string',
              description: 'The name of a custom asset to serve as the error response.',
              optional: true,
            },
            immutable: {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
              },
              optional: true,
            },
            'max-age': {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
                value: {
                  type: 'number',
                  description: 'The duration value in seconds for the directive.',
                  optional: true,
                },
              },
              optional: true,
            },
            'must-revalidate': {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
              },
              optional: true,
            },
            'must-understand': {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
              },
              optional: true,
            },
            'no-cache': {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
                qualifiers: {
                  type: 'array',
                  description:
                    'Optional list of header names to qualify the directive (e.g., for "private" or "no-cache" directives).',
                  items: {
                    type: 'string',
                    description: 'A header name to qualify the directive.',
                  },
                  optional: true,
                },
              },
              optional: true,
            },
            'no-store': {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
              },
              optional: true,
            },
            'no-transform': {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
              },
              optional: true,
            },
            private: {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
                qualifiers: {
                  type: 'array',
                  description:
                    'Optional list of header names to qualify the directive (e.g., for "private" or "no-cache" directives).',
                  items: {
                    type: 'string',
                    description: 'A header name to qualify the directive.',
                  },
                  optional: true,
                },
              },
              optional: true,
            },
            'proxy-revalidate': {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
              },
              optional: true,
            },
            public: {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
              },
              optional: true,
            },
            's-maxage': {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
                value: {
                  type: 'number',
                  description: 'The duration value in seconds for the directive.',
                  optional: true,
                },
              },
              optional: true,
            },
            'stale-if-error': {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
                value: {
                  type: 'number',
                  description: 'The duration value in seconds for the directive.',
                  optional: true,
                },
              },
              optional: true,
            },
            'stale-while-revalidate': {
              type: 'json',
              description: 'Remove the directive.',
              properties: {
                cloudflare_only: {
                  type: 'boolean',
                  description:
                    'Whether the directive should only be applied to the Cloudflare CDN cache.',
                  optional: true,
                },
                operation: {
                  type: 'string',
                  description:
                    'The operation to perform on the cache-control directive. Values: set, remove.',
                  optional: false,
                },
                value: {
                  type: 'number',
                  description: 'The duration value in seconds for the directive.',
                  optional: true,
                },
              },
              optional: true,
            },
            additional_cacheable_ports: {
              type: 'array',
              description: 'A list of additional ports that caching should be enabled on.',
              items: {
                type: 'number',
                description: 'A port to enable caching on.',
              },
              optional: true,
            },
            browser_ttl: {
              type: 'json',
              description:
                'How long client browsers should cache the response. Cloudflare cache purge will not purge content cached on client browsers, so high browser TTLs may lead to stale content.',
              properties: {
                default: {
                  type: 'number',
                  description:
                    'The browser TTL (in seconds) if you choose the "override_origin" mode.',
                  optional: true,
                },
                mode: {
                  type: 'string',
                  description:
                    'The browser TTL mode. Values: respect_origin, bypass_by_default, override_origin, bypass.',
                  optional: false,
                },
              },
              optional: true,
            },
            cache: {
              type: 'boolean',
              description:
                "Whether the request's response from the origin is eligible for caching. Caching itself will still depend on the cache control header and your other caching configurations.",
              optional: true,
            },
            cache_key: {
              type: 'json',
              description:
                'Which components of the request are included in or excluded from the cache key Cloudflare uses to store the response in cache.',
              properties: {
                cache_by_device_type: {
                  type: 'boolean',
                  description:
                    "Whether to separate cached content based on the visitor's device type.",
                  optional: true,
                },
                cache_deception_armor: {
                  type: 'boolean',
                  description:
                    'Whether to protect from web cache deception attacks, while allowing static assets to be cached.',
                  optional: true,
                },
                custom_key: {
                  type: 'json',
                  description:
                    'Which components of the request are included or excluded from the cache key.',
                  properties: {
                    cookie: {
                      type: 'json',
                      description: 'Which cookies to include in the cache key.',
                      properties: {
                        check_presence: {
                          type: 'array',
                          description:
                            'A list of cookies to check for the presence of. The presence of these cookies is included in the cache key.',
                          items: {
                            type: 'string',
                            description: 'The name of the cookie to check for the presence of.',
                          },
                          optional: true,
                        },
                        include: {
                          type: 'array',
                          description: 'A list of cookies to include in the cache key.',
                          items: {
                            type: 'string',
                            description: 'The name of the cookie to include.',
                          },
                          optional: true,
                        },
                      },
                      optional: true,
                    },
                    header: {
                      type: 'json',
                      description: 'Which headers to include in the cache key.',
                      properties: {
                        check_presence: {
                          type: 'array',
                          description:
                            'A list of headers to check for the presence of. The presence of these headers is included in the cache key.',
                          items: {
                            type: 'string',
                            description: 'The name of the header to check for the presence of.',
                          },
                          optional: true,
                        },
                        contains: {
                          type: 'json',
                          description:
                            'A mapping of header names to a list of values. If a header is present in the request and contains any of the values provided, its value is included in the cache key.',
                          optional: true,
                        },
                        exclude_origin: {
                          type: 'boolean',
                          description: 'Whether to exclude the origin header in the cache key.',
                          optional: true,
                        },
                        include: {
                          type: 'array',
                          description: 'A list of headers to include in the cache key.',
                          items: {
                            type: 'string',
                            description: 'The name of the header to include.',
                          },
                          optional: true,
                        },
                      },
                      optional: true,
                    },
                    host: {
                      type: 'json',
                      description: 'How to use the host in the cache key.',
                      properties: {
                        resolved: {
                          type: 'boolean',
                          description: 'Whether to use the resolved host in the cache key.',
                          optional: true,
                        },
                      },
                      optional: true,
                    },
                    query_string: {
                      type: 'json',
                      description:
                        'Which query string parameters to include in or exclude from the cache key.',
                      properties: {
                        exclude: {
                          type: 'json',
                          description:
                            'Which query string parameters to exclude from the cache key.',
                          properties: {
                            all: {
                              type: 'boolean',
                              description:
                                'Whether to exclude all query string parameters from the cache key. Values: True.',
                              optional: true,
                            },
                            list: {
                              type: 'array',
                              description:
                                'A list of query string parameters to exclude from the cache key.',
                              items: {
                                type: 'string',
                                description: 'The name of the query string parameter to exclude.',
                              },
                              optional: true,
                            },
                          },
                          optional: true,
                        },
                        include: {
                          type: 'json',
                          description: 'Which query string parameters to include in the cache key.',
                          properties: {
                            all: {
                              type: 'boolean',
                              description:
                                'Whether to include all query string parameters in the cache key. Values: True.',
                              optional: true,
                            },
                            list: {
                              type: 'array',
                              description:
                                'A list of query string parameters to include in the cache key.',
                              items: {
                                type: 'string',
                                description: 'The name of the query string parameter to include.',
                              },
                              optional: true,
                            },
                          },
                          optional: true,
                        },
                      },
                      optional: true,
                    },
                    user: {
                      type: 'json',
                      description:
                        'How to use characteristics of the request user agent in the cache key.',
                      properties: {
                        device_type: {
                          type: 'boolean',
                          description:
                            "Whether to use the user agent's device type in the cache key.",
                          optional: true,
                        },
                        geo: {
                          type: 'boolean',
                          description: "Whether to use the user agents's country in the cache key.",
                          optional: true,
                        },
                        lang: {
                          type: 'boolean',
                          description: "Whether to use the user agent's language in the cache key.",
                          optional: true,
                        },
                      },
                      optional: true,
                    },
                  },
                  optional: true,
                },
                ignore_query_strings_order: {
                  type: 'boolean',
                  description:
                    'Whether to treat requests with the same query parameters the same, regardless of the order those query parameters are in.',
                  optional: true,
                },
              },
              optional: true,
            },
            cache_reserve: {
              type: 'json',
              description:
                "Settings to determine whether the request's response from origin is eligible for Cache Reserve (requires a Cache Reserve add-on plan).",
              properties: {
                eligible: {
                  type: 'boolean',
                  description:
                    'Whether Cache Reserve is enabled. If this is true and a request meets eligibility criteria, Cloudflare will write the resource to Cache Reserve.',
                  optional: false,
                },
                minimum_file_size: {
                  type: 'number',
                  description: 'The minimum file size eligible for storage in Cache Reserve.',
                  optional: true,
                },
              },
              optional: true,
            },
            edge_ttl: {
              type: 'json',
              description: 'How long the Cloudflare edge network should cache the response.',
              properties: {
                default: {
                  type: 'number',
                  description:
                    'The edge TTL (in seconds) if you choose the "override_origin" mode.',
                  optional: true,
                },
                mode: {
                  type: 'string',
                  description:
                    'The edge TTL mode. Values: respect_origin, bypass_by_default, override_origin.',
                  optional: false,
                },
                status_code_ttl: {
                  type: 'array',
                  description:
                    'A list of TTLs to apply to specific status codes or status code ranges.',
                  items: {
                    type: 'json',
                    description: 'status code ttl item',
                    properties: {
                      status_code: {
                        type: 'number',
                        description: 'A single status code to apply the TTL to.',
                        optional: true,
                      },
                      status_code_range: {
                        type: 'json',
                        description: 'A range of status codes to apply the TTL to.',
                        properties: {
                          from: {
                            type: 'number',
                            description: 'The lower bound of the range.',
                            optional: true,
                          },
                          to: {
                            type: 'number',
                            description: 'The upper bound of the range.',
                            optional: true,
                          },
                        },
                        optional: true,
                      },
                      value: {
                        type: 'number',
                        description:
                          'The time to cache the response for (in seconds). A value of 0 is equivalent to setting the cache control header with the value "no-cache". A value of -1 is equivalent to setting the cache control header with the value of "no-store".',
                        optional: false,
                      },
                    },
                  },
                  optional: true,
                },
              },
              optional: true,
            },
            origin_cache_control: {
              type: 'boolean',
              description: 'Whether Cloudflare will aim to strictly adhere to RFC 7234.',
              optional: true,
            },
            origin_error_page_passthru: {
              type: 'boolean',
              description:
                'Whether to generate Cloudflare error pages for issues from the origin server.',
              optional: true,
            },
            origin_range_requests: {
              type: 'json',
              description:
                'Controls whether Cloudflare fetches a large asset from the origin as a series of range requests instead of one whole-body request.',
              properties: {
                mode: {
                  type: 'string',
                  description:
                    'Whether to use range requests. `default` is the behaviour the zone gets without this rule. Values: on, off, default.',
                  optional: false,
                },
              },
              optional: true,
            },
            read_timeout: {
              type: 'number',
              description:
                'A timeout value between two successive read operations to use for your origin server. Historically, the timeout value between two read options from Cloudflare to an origin server is 100 seconds. If you are attempting to reduce HTTP 524 errors because of timeouts from an origin server, try increasing this timeout value.',
              optional: true,
            },
            respect_strong_etags: {
              type: 'boolean',
              description:
                'Whether Cloudflare should respect strong ETag (entity tag) headers. If false, Cloudflare converts strong ETag headers to weak ETag headers.',
              optional: true,
            },
            serve_stale: {
              type: 'json',
              description: 'When to serve stale content from cache.',
              properties: {
                disable_stale_while_updating: {
                  type: 'boolean',
                  description:
                    'Whether Cloudflare should disable serving stale content while getting the latest content from the origin.',
                  optional: true,
                },
              },
              optional: true,
            },
            shared_dictionary: {
              type: 'json',
              description:
                'Configuration for shared dictionary compression. When set, Cloudflare injects Use-As-Dictionary headers on matching cacheable responses.',
              properties: {
                match_pattern: {
                  type: 'string',
                  description:
                    'URL pattern for the Use-As-Dictionary match field. This pattern specifies which URLs can use this response as a dictionary.',
                  optional: false,
                },
              },
              optional: true,
            },
            strip_etags: {
              type: 'boolean',
              description: 'Whether to strip ETag headers from the origin response before caching.',
              optional: true,
            },
            strip_last_modified: {
              type: 'boolean',
              description:
                'Whether to strip Last-Modified headers from the origin response before caching.',
              optional: true,
            },
            strip_set_cookie: {
              type: 'boolean',
              description:
                'Whether to strip Set-Cookie headers from the origin response before caching.',
              optional: true,
            },
            vary: {
              type: 'json',
              description:
                'Controls how cached responses vary based on request headers. `default` is required by the API and applies to any Vary response header that does not have a per-header override.',
              properties: {
                default: {
                  type: 'json',
                  description:
                    'Controls how response Vary headers without a per-header override contribute to the cache key.',
                  properties: {
                    action: {
                      type: 'string',
                      description:
                        'How the header value is treated when building the cache key. Values: bypass, passthrough, normalize.',
                      optional: false,
                    },
                  },
                  optional: true,
                },
                headers: {
                  type: 'json',
                  description:
                    'A mapping of lowercase request header names to their vary configuration.',
                  optional: true,
                },
              },
              optional: true,
            },
            operation: {
              type: 'string',
              description: 'The operation to perform on the cache tags. Values: add, remove, set.',
              optional: true,
            },
            values: {
              type: 'array',
              description: 'A list of cache tag values.',
              items: {
                type: 'string',
                description: 'A cache tag value.',
              },
              optional: true,
            },
            expression: {
              type: 'string',
              description: 'An expression that evaluates to an array of cache tag values.',
              optional: true,
            },
            automatic_https_rewrites: {
              type: 'boolean',
              description: 'Whether to enable Automatic HTTPS Rewrites.',
              optional: true,
            },
            autominify: {
              type: 'json',
              description: 'Which file extensions to minify automatically.',
              properties: {
                css: {
                  type: 'boolean',
                  description: 'Whether to minify CSS files.',
                  optional: true,
                },
                html: {
                  type: 'boolean',
                  description: 'Whether to minify HTML files.',
                  optional: true,
                },
                js: {
                  type: 'boolean',
                  description: 'Whether to minify JavaScript files.',
                  optional: true,
                },
              },
              optional: true,
            },
            bic: {
              type: 'boolean',
              description: 'Whether to enable Browser Integrity Check (BIC).',
              optional: true,
            },
            content_converter: {
              type: 'boolean',
              description: 'Whether to enable content conversion (e.g., HTML to Markdown).',
              optional: true,
            },
            disable_apps: {
              type: 'boolean',
              description: 'Whether to disable Cloudflare Apps. Values: True.',
              optional: true,
            },
            disable_pay_per_crawl: {
              type: 'boolean',
              description: 'Whether to disable Pay Per Crawl. Values: True.',
              optional: true,
            },
            disable_rum: {
              type: 'boolean',
              description: 'Whether to disable Real User Monitoring (RUM). Values: True.',
              optional: true,
            },
            disable_zaraz: {
              type: 'boolean',
              description: 'Whether to disable Zaraz. Values: True.',
              optional: true,
            },
            email_obfuscation: {
              type: 'boolean',
              description: 'Whether to enable Email Obfuscation.',
              optional: true,
            },
            fonts: {
              type: 'boolean',
              description: 'Whether to enable Cloudflare Fonts.',
              optional: true,
            },
            hotlink_protection: {
              type: 'boolean',
              description: 'Whether to enable Hotlink Protection.',
              optional: true,
            },
            mirage: {
              type: 'boolean',
              description: 'Whether to enable Mirage.',
              optional: true,
            },
            opportunistic_encryption: {
              type: 'boolean',
              description: 'Whether to enable Opportunistic Encryption.',
              optional: true,
            },
            polish: {
              type: 'string',
              description: 'The Polish level to configure. Values: off, lossless, lossy, webp.',
              optional: true,
            },
            redirects_for_ai_training: {
              type: 'boolean',
              description:
                'Whether to redirect verified AI training crawlers to canonical URLs found in the HTML response.',
              optional: true,
            },
            request_body_buffering: {
              type: 'string',
              description: 'The request body buffering mode. Values: none, standard, full.',
              optional: true,
            },
            response_body_buffering: {
              type: 'string',
              description: 'The response body buffering mode. Values: none, standard.',
              optional: true,
            },
            rocket_loader: {
              type: 'boolean',
              description: 'Whether to enable Rocket Loader.',
              optional: true,
            },
            security_level: {
              type: 'string',
              description:
                'The Security Level to configure. Values: off, essentially_off, low, medium, high, under_attack.',
              optional: true,
            },
            server_side_excludes: {
              type: 'boolean',
              description: 'Whether to enable Server-Side Excludes.',
              optional: true,
            },
            ssl: {
              type: 'string',
              description:
                'The SSL level to configure. Values: off, flexible, full, strict, origin_pull.',
              optional: true,
            },
            sxg: {
              type: 'boolean',
              description: 'Whether to enable Signed Exchanges (SXG).',
              optional: true,
            },
            webmcp_enabled: {
              type: 'boolean',
              description:
                "Whether to serve the WebMCP bridge script, which exposes the page's tools to browser AI agents.",
              optional: true,
            },
            webmcp_packs: {
              type: 'array',
              description:
                'Bundled WebMCP tool packs to activate for matching requests. An empty array disables all packs. Omitting this parameter leaves the pack selection unchanged. Does not enable the WebMCP bridge itself.',
              items: {
                type: 'string',
                description: 'A tool-pack identifier understood by the WebMCP interceptor.',
              },
              optional: true,
            },
            phase: {
              type: 'string',
              description:
                'A phase to skip the execution of. This option is only compatible with the products option. Values: current.',
              optional: true,
            },
            phases: {
              type: 'array',
              description:
                'A list of phases to skip the execution of. This option is incompatible with the rulesets option.',
              items: {
                type: 'string',
                description: 'The phase to skip the execution of.',
              },
              optional: true,
            },
            products: {
              type: 'array',
              description: 'A list of legacy security products to skip the execution of.',
              items: {
                type: 'string',
                description:
                  'The name of a legacy security product to skip the execution of. Values: bic, hot, rateLimit, securityLevel, uaBlock, waf, zoneLockdown.',
              },
              optional: true,
            },
            rules: {
              type: 'json',
              description:
                'A mapping of ruleset IDs to a list of rule IDs in that ruleset to skip the execution of. This option is incompatible with the ruleset option.',
              optional: true,
            },
            ruleset: {
              type: 'string',
              description:
                'A ruleset to skip the execution of. This option is incompatible with the rulesets option. Values: current.',
              optional: true,
            },
            rulesets: {
              type: 'array',
              description:
                'A list of ruleset IDs to skip the execution of. This option is incompatible with the ruleset and phases options.',
              items: {
                type: 'string',
                description: 'The ID of a ruleset to skip the execution of.',
              },
              optional: true,
            },
            link_maze: {
              type: 'json',
              description: 'Enables the link maze transformation on the response.',
              optional: true,
            },
          },
          nullable: true,
        },
        categories: {
          type: 'array',
          description: 'The categories of the rule.',
          items: {
            type: 'string',
            description: 'The category of a rule.',
          },
        },
        description: {
          type: 'string',
          description: 'An informative description of the rule.',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether the rule should be executed.',
        },
        exposed_credential_check: {
          type: 'json',
          description: 'Configuration for exposed credential checking.',
          properties: {
            password_expression: {
              type: 'string',
              description: 'An expression that selects the password used in the credentials check.',
              optional: false,
            },
            username_expression: {
              type: 'string',
              description: 'An expression that selects the user ID used in the credentials check.',
              optional: false,
            },
          },
          nullable: true,
        },
        expression: {
          type: 'string',
          description: 'The expression defining which traffic will match the rule.',
        },
        id: {
          type: 'string',
          description: 'The unique ID of the rule.',
        },
        last_updated: {
          type: 'string',
          description: 'The timestamp of when the rule was last modified.',
          nullable: true,
        },
        logging: {
          type: 'json',
          description: "An object configuring the rule's logging behavior.",
          properties: {
            enabled: {
              type: 'boolean',
              description: 'Whether to generate a log when the rule matches.',
              optional: false,
            },
          },
          nullable: true,
        },
        ratelimit: {
          type: 'json',
          description: "An object configuring the rule's rate limit behavior.",
          properties: {
            characteristics: {
              type: 'array',
              description:
                'Characteristics of the request on which the rate limit counter will be incremented.',
              items: {
                type: 'string',
                description: 'The characteristic of the request.',
              },
              optional: false,
            },
            counting_expression: {
              type: 'string',
              description:
                "An expression that defines when the rate limit counter should be incremented. It defaults to the same as the rule's expression.",
              optional: true,
            },
            mitigation_timeout: {
              type: 'number',
              description:
                'Period of time in seconds after which the action will be disabled following its first execution.',
              optional: true,
            },
            period: {
              type: 'number',
              description: 'Period in seconds over which the counter is being incremented.',
              optional: false,
            },
            requests_per_period: {
              type: 'number',
              description:
                'The threshold of requests per period after which the action will be executed for the first time.',
              optional: true,
            },
            requests_to_origin: {
              type: 'boolean',
              description: 'Whether counting is only performed when an origin is reached.',
              optional: true,
            },
            score_per_period: {
              type: 'number',
              description:
                'The score threshold per period for which the action will be executed the first time.',
              optional: true,
            },
            score_response_header_name: {
              type: 'string',
              description:
                'A response header name provided by the origin, which contains the score to increment rate limit counter with.',
              optional: true,
            },
          },
          nullable: true,
        },
        ref: {
          type: 'string',
          description: "The reference of the rule (the rule's ID by default).",
          nullable: true,
        },
        version: {
          type: 'string',
          description: 'The version of the rule.',
          nullable: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const SERVICE_TOKEN_OUTPUTS = {
  client_id: {
    type: 'string',
    description:
      'The Client ID for the service token. Access will check for this value in the `CF-Access-Client-ID` request header.',
    nullable: true,
  },
  created_at: {
    type: 'string',
    description: 'created at',
    nullable: true,
  },
  duration: {
    type: 'string',
    description:
      'The duration for how long the service token will be valid. Must be in the format `300ms` or `2h45m`, or the special value `forever` for non-expiring tokens. Valid time units are: ns, us (or \u00b5s), ms, s, m, h. The default is 1 year in hours (8760h).',
    nullable: true,
  },
  enabled: {
    type: 'boolean',
    description: 'Whether the service token is enabled.',
    nullable: true,
  },
  expires_at: {
    type: 'string',
    description: 'expires at',
    nullable: true,
  },
  id: {
    type: 'string',
    description: 'UUID.',
    nullable: true,
  },
  last_seen_at: {
    type: 'string',
    description: 'last seen at',
    nullable: true,
  },
  leak_report_url: {
    type: 'string',
    description:
      'Where the leaked `client_secret` was found, if provided by the reporter. Omitted if the token has not been reported as leaked.',
    nullable: true,
  },
  leak_reported_at: {
    type: 'string',
    description:
      "When a secret scanning partner reported this service token's `client_secret` as leaked. A leaked service token is disabled and must be rotated before it can be re-enabled. Cleared once the secret is rotated. Omitted if the token has not been reported as leaked.",
    nullable: true,
  },
  leak_reporter: {
    type: 'string',
    description:
      'The secret scanning partner that reported the leak. Omitted if the token has not been reported as leaked.',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'The name of the service token.',
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'updated at',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const SERVICE_TOKEN_SECRET_OUTPUTS = {
  client_id: {
    type: 'string',
    description:
      'The Client ID for the service token. Access will check for this value in the `CF-Access-Client-ID` request header.',
    nullable: true,
  },
  client_secret: {
    type: 'string',
    description:
      'The Client Secret for the service token. Access will check for this value in the `CF-Access-Client-Secret` request header.',
    nullable: true,
  },
  created_at: {
    type: 'string',
    description: 'created at',
    nullable: true,
  },
  duration: {
    type: 'string',
    description:
      'The duration for how long the service token will be valid. Must be in the format `300ms` or `2h45m`, or the special value `forever` for non-expiring tokens. Valid time units are: ns, us (or \u00b5s), ms, s, m, h. The default is 1 year in hours (8760h).',
    nullable: true,
  },
  enabled: {
    type: 'boolean',
    description: 'Whether the service token is enabled.',
    nullable: true,
  },
  id: {
    type: 'string',
    description: 'The ID of the service token.',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'The name of the service token.',
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'updated at',
    nullable: true,
  },
  expires_at: {
    type: 'string',
    description:
      'Service token expires at when returned by Cloudflare; retained for existing workflows',
    nullable: true,
  },
  last_seen_at: {
    type: 'string',
    description:
      'Service token last seen at when returned by Cloudflare; retained for existing workflows',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TUNNEL_CONFIGURATION_OUTPUTS = {
  account_id: {
    type: 'string',
    description: 'Identifier.',
    nullable: true,
  },
  config: {
    type: 'json',
    description: 'The tunnel configuration and ingress rules.',
    properties: {
      ingress: {
        type: 'array',
        description:
          'List of public hostname definitions. At least one ingress rule needs to be defined for the tunnel.',
        items: {
          type: 'json',
          description: 'Public hostname',
          properties: {
            hostname: {
              type: 'string',
              description: 'Public hostname for this service.',
              optional: false,
            },
            originRequest:
              TUNNEL_CONFIGURATION_OUTPUTS_CONFIG_PROPERTIES_INGRESS_ITEMS_PROPERTIES_ORIGINREQUEST_FIELDS,
            path: {
              type: 'string',
              description: 'Requests with this path route to this public hostname.',
              optional: true,
            },
            service: {
              type: 'string',
              description:
                "Protocol and address of destination server. Supported protocols: http://, https://, unix://, tcp://, ssh://, rdp://, unix+tls://, smb://. Alternatively can return a HTTP status code http_status:[code] e.g. 'http_status:404'.",
              optional: false,
            },
          },
        },
        optional: true,
      },
      originRequest:
        TUNNEL_CONFIGURATION_OUTPUTS_CONFIG_PROPERTIES_INGRESS_ITEMS_PROPERTIES_ORIGINREQUEST_FIELDS,
      'warp-routing': {
        type: 'json',
        description:
          'Enable private network access from WARP users to private network routes. This is enabled if the tunnel has an assigned route.',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'enabled',
            optional: true,
          },
        },
        optional: true,
      },
    },
    nullable: true,
  },
  created_at: {
    type: 'string',
    description: 'created at',
    nullable: true,
  },
  source: {
    type: 'string',
    description:
      "Indicates if this is a locally or remotely configured tunnel. If `local`, manage the tunnel using a YAML file on the origin machine. If `cloudflare`, manage the tunnel's configuration on the Zero Trust dashboard. Values: local, cloudflare.",
    nullable: true,
  },
  tunnel_id: {
    type: 'string',
    description: 'UUID of the tunnel.',
    nullable: true,
  },
  version: {
    type: 'number',
    description: 'The version of the Tunnel Configuration.',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TUNNEL_OUTPUTS = {
  account_tag: {
    type: 'string',
    description: 'Cloudflare account ID',
    nullable: true,
  },
  config_src: {
    type: 'string',
    description:
      'Indicates if this is a locally or remotely configured tunnel. If `local`, manage the tunnel using a YAML file on the origin machine. If `cloudflare`, manage the tunnel on the Zero Trust dashboard. Values: local, cloudflare.',
    nullable: true,
  },
  connections: {
    type: 'array',
    description: "The Cloudflare Tunnel connections between your origin and Cloudflare's edge.",
    items: {
      type: 'json',
      description: 'connections item',
      properties: {
        client_id: {
          type: 'string',
          description: 'UUID of the Cloudflare Tunnel connector.',
          optional: true,
        },
        client_version: {
          type: 'string',
          description: 'The cloudflared version used to establish this connection.',
          optional: true,
        },
        colo_name: {
          type: 'string',
          description: 'The Cloudflare data center used for this connection.',
          optional: true,
        },
        id: {
          type: 'string',
          description: 'UUID of the Cloudflare Tunnel connection.',
          optional: true,
        },
        is_pending_reconnect: {
          type: 'boolean',
          description:
            'Cloudflare continues to track connections for several minutes after they disconnect. This is an optimization to improve latency and reliability of reconnecting. If `true`, the connection has disconnected but is still being tracked. If `false`, the connection is actively serving traffic.',
          optional: true,
        },
        opened_at: {
          type: 'string',
          description: 'Timestamp of when the connection was established.',
          optional: true,
        },
        origin_ip: {
          type: 'string',
          description: 'The public IP address of the host running cloudflared.',
          optional: true,
        },
        uuid: {
          type: 'string',
          description: 'UUID of the Cloudflare Tunnel connection.',
          optional: true,
        },
      },
    },
  },
  conns_active_at: {
    type: 'string',
    description:
      "Timestamp of when the tunnel established at least one connection to Cloudflare's edge. If `null`, the tunnel is inactive.",
    nullable: true,
  },
  conns_inactive_at: {
    type: 'string',
    description:
      "Timestamp of when the tunnel became inactive (no connections to Cloudflare's edge). If `null`, the tunnel is active.",
    nullable: true,
  },
  created_at: {
    type: 'string',
    description: 'Timestamp of when the resource was created.',
    nullable: true,
  },
  deleted_at: {
    type: 'string',
    description:
      'Timestamp of when the resource was deleted. If `null`, the resource has not been deleted.',
    nullable: true,
  },
  id: {
    type: 'string',
    description: 'UUID of the tunnel.',
    nullable: true,
  },
  metadata: {
    type: 'json',
    description: 'Metadata associated with the tunnel.',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'A user-friendly name for a tunnel.',
    nullable: true,
  },
  remote_config: {
    type: 'boolean',
    description:
      'If `true`, the tunnel can be configured remotely from the Zero Trust dashboard. If `false`, the tunnel must be configured locally on the origin machine.',
    nullable: true,
  },
  status: {
    type: 'string',
    description: 'The status of the tunnel.',
    nullable: true,
  },
  tun_type: {
    type: 'string',
    description:
      'The type of tunnel. Values: cfd_tunnel, warp_connector, warp, magic, ip_sec, gre, cni.',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WORKER_ROUTE_OUTPUTS = {
  id: {
    type: 'string',
    description: 'Identifier.',
    nullable: true,
  },
  pattern: {
    type: 'string',
    description:
      'Pattern to match incoming requests against. [Learn more](https://developers.cloudflare.com/workers/configuration/routing/routes/#matching-behavior).',
    nullable: true,
  },
  script: {
    type: 'string',
    description: 'Name of the script to run if the route matches.',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WORKER_SCRIPT_OUTPUTS = {
  cache_options: {
    type: 'json',
    description:
      'Global CacheW configuration for the Worker. When caching is on, the platform provisions a `cloudflare.app` zone for the Worker. A `type: worker` entry in the `exports` map can override this value for a single entrypoint.',
    properties: {
      cross_version_cache: {
        type: 'boolean',
        description:
          'Whether cached responses are shared across Worker version uploads. This is independent of `enabled`. It can stay true while caching is off, so the preference survives turning caching off and back on.',
        optional: true,
      },
      enabled: {
        type: 'boolean',
        description: 'Whether caching is enabled for this Worker.',
        optional: false,
      },
    },
    nullable: true,
  },
  compatibility_date: {
    type: 'string',
    description:
      'Date indicating targeted support in the Workers runtime. Backwards incompatible fixes to the runtime following this date will not affect this Worker.',
    nullable: true,
  },
  compatibility_flags: {
    type: 'array',
    description:
      'Flags that enable or disable certain features in the Workers runtime. Used to enable upcoming features or opt in or out of specific changes not included in a `compatibility_date`.',
    items: {
      type: 'string',
      description: 'Flag that enables or disables a specific feature in the Workers runtime.',
    },
  },
  created_on: {
    type: 'string',
    description: 'When the script was created.',
    nullable: true,
  },
  etag: {
    type: 'string',
    description: 'Hashed script content, can be used in a If-None-Match header when updating.',
    nullable: true,
  },
  exports: {
    type: 'json',
    description:
      'Declarative exports for the Worker, keyed by export name. Worker entrypoint entries (`type: worker`) carry cache configuration for that entrypoint. Durable Object entries (`type: durable-object`) are also configured here and drive namespace reconciliation. At most 100 entries; class names are at most 128 characters.',
    nullable: true,
  },
  handlers: {
    type: 'array',
    description: 'The names of handlers exported as part of the default export.',
    items: {
      type: 'string',
      description: 'handlers item',
    },
  },
  has_assets: {
    type: 'boolean',
    description: 'Whether a Worker contains assets.',
    nullable: true,
  },
  has_modules: {
    type: 'boolean',
    description: 'Whether a Worker contains modules.',
    nullable: true,
  },
  id: {
    type: 'string',
    description: 'The name used to identify the script.',
    nullable: true,
  },
  last_deployed_from: {
    type: 'string',
    description: 'The client most recently used to deploy this Worker.',
    nullable: true,
  },
  logpush: {
    type: 'boolean',
    description: 'Whether Logpush is turned on for the Worker.',
    nullable: true,
  },
  migration_tag: {
    type: 'string',
    description:
      'The tag of the Durable Object migration that was most recently applied for this Worker.',
    nullable: true,
  },
  modified_on: {
    type: 'string',
    description: 'When the script was last modified.',
    nullable: true,
  },
  named_handlers: {
    type: 'array',
    description:
      'Named exports, such as Durable Object class implementations and named entrypoints.',
    items: {
      type: 'json',
      description: 'named handlers item',
      properties: {
        handlers: {
          type: 'array',
          description: 'The names of handlers exported as part of the named export.',
          items: {
            type: 'string',
            description: 'handlers item',
          },
          optional: true,
        },
        name: {
          type: 'string',
          description: 'The name of the export.',
          optional: true,
        },
      },
    },
  },
  observability: WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_FIELDS,
  placement: {
    type: 'json',
    description:
      "Configuration for [Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement). Specify mode='smart' for Smart Placement, or one of region/hostname/host.",
    properties: {
      mode: {
        type: 'string',
        description: 'Targeted placement mode. Values: smart, targeted.',
        optional: true,
      },
      region: {
        type: 'string',
        description: "Cloud region for targeted placement in format 'provider:region'.",
        optional: true,
      },
      hostname: {
        type: 'string',
        description: 'HTTP hostname for targeted placement.',
        optional: true,
      },
      host: {
        type: 'string',
        description: 'TCP host and port for targeted placement.',
        optional: true,
      },
      target: {
        type: 'array',
        description: 'Array of placement targets (currently limited to single target).',
        items: {
          type: 'json',
          description: 'A target to run your Worker near.',
          properties: {
            region: {
              type: 'string',
              description: "Cloud region in format 'provider:region'.",
              optional: true,
            },
            hostname: {
              type: 'string',
              description: 'HTTP hostname for targeted placement.',
              optional: true,
            },
            host: {
              type: 'string',
              description: 'TCP host:port for targeted placement.',
              optional: true,
            },
          },
        },
        optional: true,
      },
      last_analyzed_at: {
        type: 'string',
        description:
          'The last time the script was analyzed for [Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement).',
        optional: true,
      },
      status: {
        type: 'string',
        description:
          'Status of [Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement). Values: SUCCESS, UNSUPPORTED_APPLICATION, INSUFFICIENT_INVOCATIONS.',
        optional: true,
      },
    },
    nullable: true,
  },
  placement_mode: {
    type: 'string',
    description:
      "Configuration for [Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement). Specify mode='smart' for Smart Placement, or one of region/hostname/host. Values: smart, targeted.",
    nullable: true,
  },
  placement_status: {
    type: 'string',
    description:
      'Status of [Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement). Values: SUCCESS, UNSUPPORTED_APPLICATION, INSUFFICIENT_INVOCATIONS.',
    nullable: true,
  },
  tag: {
    type: 'string',
    description: 'The immutable ID of the script.',
    nullable: true,
  },
  tags: {
    type: 'array',
    description: 'Tags associated with the Worker.',
    items: {
      type: 'string',
      description: 'tags item',
    },
  },
  tail_consumers: {
    type: 'array',
    description: 'List of Workers that will consume logs from the attached Worker.',
    items: {
      type: 'json',
      description: 'A reference to a script that will consume logs from the attached Worker.',
      properties: {
        environment: {
          type: 'string',
          description: 'Optional environment if the Worker utilizes one.',
          optional: true,
        },
        namespace: {
          type: 'string',
          description: 'Optional dispatch namespace the script belongs to.',
          optional: true,
        },
        service: {
          type: 'string',
          description: 'Name of Worker that is to be the consumer.',
          optional: false,
        },
      },
    },
  },
  usage_model: {
    type: 'string',
    description: 'Usage model for the Worker invocations. Values: standard, bundled, unbound.',
    nullable: true,
  },
  routes: {
    type: 'array',
    description: 'Routes associated with the Worker.',
    items: {
      type: 'json',
      description: 'routes item',
      properties: {
        id: {
          type: 'string',
          description: 'Identifier.',
          optional: false,
        },
        pattern: {
          type: 'string',
          description:
            'Pattern to match incoming requests against. [Learn more](https://developers.cloudflare.com/workers/configuration/routing/routes/#matching-behavior).',
          optional: false,
        },
        script: {
          type: 'string',
          description: 'Name of the script to run if the route matches.',
          optional: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const WORKER_SETTINGS_OUTPUTS = {
  annotations: {
    type: 'json',
    description:
      'Annotations for the Worker version. Annotations are not inherited across settings updates; omitting this field means the new version will have no annotations.',
    properties: {
      'workers/message': {
        type: 'string',
        description: 'Human-readable message about the version. Truncated to 1000 bytes if longer.',
        optional: true,
      },
      'workers/tag': {
        type: 'string',
        description: 'User-provided identifier for the version. Maximum 100 bytes.',
        optional: true,
      },
      'workers/triggered_by': {
        type: 'string',
        description:
          'Operation that triggered the creation of the version. This is read-only and set by the server.',
        optional: true,
      },
    },
    nullable: true,
  },
  bindings: {
    type: 'array',
    description:
      'List of bindings attached to a Worker. You can find more about bindings on our docs: https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/#bindings.',
    items: {
      type: 'json',
      description: 'A K2 stream binding. Available only to accounts enabled for K2.',
      properties: {
        name: {
          type: 'string',
          description: 'A JavaScript variable name for the binding.',
          optional: false,
        },
        type: {
          type: 'string',
          description: 'The kind of resource that the binding provides.',
          optional: false,
        },
        instance_name: {
          type: 'string',
          description:
            'The user-chosen instance name. Must exist at deploy time. The worker can search, chat, update, and manage items/jobs on this instance.',
          optional: true,
        },
        namespace: {
          type: 'string',
          description: 'The name of the dispatch namespace.',
          optional: true,
        },
        dataset: {
          type: 'string',
          description: 'The name of the dataset to bind to.',
          optional: true,
        },
        database_id: {
          type: 'string',
          description: 'Identifier of the D1 database to bind to.',
          optional: true,
        },
        id: {
          type: 'string',
          description: 'Identifier of the Hyperdrive connection to bind to.',
          optional: true,
        },
        part: {
          type: 'string',
          description:
            'The name of the file containing the WebAssembly module content. Only accepted for `service worker syntax` Workers.',
          optional: true,
        },
        outbound: {
          type: 'json',
          description: 'Outbound worker.',
          properties: {
            params: {
              type: 'array',
              description:
                'Pass information from the Dispatch Worker to the Outbound Worker through the parameters.',
              items: {
                type: 'json',
                description: 'params item',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Name of the parameter.',
                    optional: false,
                  },
                },
              },
              optional: true,
            },
            worker: {
              type: 'json',
              description: 'Outbound worker.',
              properties: {
                entrypoint: {
                  type: 'string',
                  description: 'Entrypoint to invoke on the outbound worker.',
                  optional: true,
                },
                environment: {
                  type: 'string',
                  description: 'Environment of the outbound worker.',
                  optional: true,
                },
                service: {
                  type: 'string',
                  description: 'Name of the outbound worker.',
                  optional: true,
                },
              },
              optional: true,
            },
          },
          optional: true,
        },
        class_name: {
          type: 'string',
          description:
            'Class name of the Workflow. Should only be provided if the Workflow belongs to this script.',
          optional: true,
        },
        dispatch_namespace: {
          type: 'string',
          description: 'The dispatch namespace the Durable Object script belongs to.',
          optional: true,
        },
        environment: {
          type: 'string',
          description: 'Optional environment if the Worker utilizes one.',
          optional: true,
        },
        namespace_id: {
          type: 'string',
          description: 'Identifier of the rate limit namespace to bind to.',
          optional: true,
        },
        script_name: {
          type: 'string',
          description:
            'Script name that contains the Workflow. If not provided, defaults to this script name.',
          optional: true,
        },
        old_name: {
          type: 'string',
          description:
            'The old name of the inherited binding. If set, the binding will be renamed from `old_name` to `name` in the new version. If not set, the binding will keep the same name between versions.',
          optional: true,
        },
        version_id: {
          type: 'string',
          description: 'Identifier for the version to inherit the binding from.',
          optional: true,
        },
        json: {
          type: 'json',
          description: 'JSON data to use.',
          optional: true,
        },
        certificate_id: {
          type: 'string',
          description: 'Identifier of the certificate to bind to.',
          optional: true,
        },
        text: {
          type: 'string',
          description: 'The secret value to use.',
          optional: true,
        },
        pipeline: {
          type: 'string',
          description: 'Name of the Pipeline to bind to.',
          optional: true,
        },
        stream: {
          type: 'string',
          description: 'ID of a K2 stream owned by the account deploying the Worker.',
          optional: true,
        },
        queue_name: {
          type: 'string',
          description: 'Name of the Queue to bind to.',
          optional: true,
        },
        simple: {
          type: 'json',
          description: 'The rate limit configuration.',
          properties: {
            limit: {
              type: 'number',
              description: 'The limit (requests per period).',
              optional: false,
            },
            mitigation_timeout: {
              type: 'number',
              description:
                'Duration in seconds to apply the mitigation action after the rate limit is exceeded. Valid values are 0 (disabled), 10, or multiples of 60 up to 86400. Must be greater than or equal to the period when non-zero.',
              optional: true,
            },
            period: {
              type: 'number',
              description: 'The period in seconds.',
              optional: false,
            },
          },
          optional: true,
        },
        bucket_name: {
          type: 'string',
          description: 'R2 bucket to bind to.',
          optional: true,
        },
        jurisdiction: {
          type: 'string',
          description:
            'The [jurisdiction](https://developers.cloudflare.com/r2/reference/data-location/#jurisdictional-restrictions) of the R2 bucket. Values: eu, fedramp, fedramp-high, us.',
          optional: true,
        },
        allowed_destination_addresses: {
          type: 'array',
          description: 'List of allowed destination addresses.',
          items: {
            type: 'string',
            description: 'allowed destination addresses item',
          },
          optional: true,
        },
        allowed_sender_addresses: {
          type: 'array',
          description: 'List of allowed sender addresses.',
          items: {
            type: 'string',
            description: 'allowed sender addresses item',
          },
          optional: true,
        },
        destination_address: {
          type: 'string',
          description: 'Destination address for the email.',
          optional: true,
        },
        entrypoint: {
          type: 'string',
          description: 'Entrypoint to invoke on the target Worker.',
          optional: true,
        },
        service: {
          type: 'string',
          description: 'Name of Worker to bind to.',
          optional: true,
        },
        index_name: {
          type: 'string',
          description: 'Name of the Vectorize index to bind to.',
          optional: true,
        },
        secret_name: {
          type: 'string',
          description: 'Name of the secret in the store.',
          optional: true,
        },
        store_id: {
          type: 'string',
          description: 'ID of the store containing the secret.',
          optional: true,
        },
        app_id: {
          type: 'string',
          description: 'ID of the Flagship app to bind to for feature flag evaluation.',
          optional: true,
        },
        algorithm: {
          type: 'json',
          description:
            'Algorithm-specific key parameters. [Learn more](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey#algorithm).',
          optional: true,
        },
        format: {
          type: 'string',
          description:
            'Data format of the key. [Learn more](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey#format). Values: raw, pkcs8, spki, jwk.',
          optional: true,
        },
        key_base64: {
          type: 'string',
          description:
            'Base64-encoded key data. Required if `format` is "raw", "pkcs8", or "spki".',
          optional: true,
        },
        key_jwk: {
          type: 'json',
          description:
            'Key data in [JSON Web Key](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey#json_web_key) format. Required if `format` is "jwk".',
          optional: true,
        },
        usages: {
          type: 'array',
          description:
            'Allowed operations with the key. [Learn more](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey#keyUsages).',
          items: {
            type: 'string',
            description:
              'usages item Values: encrypt, decrypt, sign, verify, deriveKey, deriveBits, wrapKey, unwrapKey.',
          },
          optional: true,
        },
        workflow_name: {
          type: 'string',
          description: 'Name of the Workflow to bind to.',
          optional: true,
        },
        service_id: {
          type: 'string',
          description: 'Identifier of the VPC service to bind to.',
          optional: true,
        },
        identity: {
          type: 'string',
          description:
            'Enables Gateway identity for the binding. Requires network_id to be "cf1:network" and cannot be combined with tunnel_id. Values: runtime-email-alpha.',
          optional: true,
        },
        network_id: {
          type: 'string',
          description:
            'Identifier of the network to bind to. Only "cf1:network" is currently supported. Mutually exclusive with tunnel_id.',
          optional: true,
        },
        tunnel_id: {
          type: 'string',
          description:
            'UUID of the Cloudflare Tunnel to bind to. Mutually exclusive with network_id.',
          optional: true,
        },
      },
    },
  },
  cache_options: {
    type: 'json',
    description:
      'Global CacheW configuration for the Worker. When caching is on, the platform provisions a `cloudflare.app` zone for the Worker. A `type: worker` entry in the `exports` map can override this value for a single entrypoint.',
    properties: {
      cross_version_cache: {
        type: 'boolean',
        description:
          'Whether cached responses are shared across Worker version uploads. This is independent of `enabled`. It can stay true while caching is off, so the preference survives turning caching off and back on.',
        optional: true,
      },
      enabled: {
        type: 'boolean',
        description: 'Whether caching is enabled for this Worker.',
        optional: false,
      },
    },
    nullable: true,
  },
  compatibility_date: {
    type: 'string',
    description:
      'Date indicating targeted support in the Workers runtime. Backwards incompatible fixes to the runtime following this date will not affect this Worker.',
    nullable: true,
  },
  compatibility_flags: {
    type: 'array',
    description:
      'Flags that enable or disable certain features in the Workers runtime. Used to enable upcoming features or opt in or out of specific changes not included in a `compatibility_date`.',
    items: {
      type: 'string',
      description: 'compatibility flags item',
    },
  },
  exports: {
    type: 'json',
    description:
      'Declarative exports for the Worker, keyed by export name. Worker entrypoint entries (`type: worker`) carry cache configuration for that entrypoint. Durable Object entries (`type: durable-object`) are also configured here and drive namespace reconciliation. At most 100 entries; class names are at most 128 characters.',
    nullable: true,
  },
  exports_reconciliation: {
    type: 'json',
    description: 'Summary of what the declarative exports reconciliation did on this upload.',
    properties: {
      created: {
        type: 'array',
        description: 'Class names for which a new namespace was provisioned.',
        items: {
          type: 'string',
          description: 'created item',
        },
        optional: false,
      },
      deleted: {
        type: 'array',
        description: 'Class names whose namespace was deleted by a `deleted` tombstone.',
        items: {
          type: 'string',
          description: 'deleted item',
        },
        optional: false,
      },
      info: {
        type: 'array',
        description:
          'Non-blocking info entries (stale tombstones, tombstone applied with class still in code). See `exports_reconciliation_info`.',
        items: {
          type: 'json',
          description:
            'A non-blocking reconciliation info entry. Emitted for stale tombstones (a no-op on this deploy) and for tombstones applied with the source class still in code (the supported zero-downtime rollout pattern).',
          properties: {
            class: {
              type: 'string',
              description: 'The class name the info entry is about.',
              optional: false,
            },
            message: {
              type: 'string',
              description: 'Human-readable explanation.',
              optional: false,
            },
            namespace_id: {
              type: 'string',
              description: 'The provisioned namespace the entry relates to, when applicable.',
              optional: true,
            },
            referencing_scripts: {
              type: 'array',
              description:
                'Other Workers in the account that still bind to the affected class. Advisory: while non-empty the tombstone is not yet safe to remove \u2014 redeploy these Workers with bindings re-pointed first.',
              items: {
                type: 'string',
                description: 'referencing scripts item',
              },
              optional: true,
            },
            scenario: {
              type: 'string',
              description:
                'Stable, machine-readable tag identifying which reconciliation scenario produced an error, warning, or info entry.',
              optional: false,
            },
          },
        },
        optional: false,
      },
      removable_entries: {
        type: 'array',
        description:
          'Source class names whose tombstone entry is now stale and safe to delete from `exports` (no remaining referencing scripts).',
        items: {
          type: 'string',
          description: 'removable entries item',
        },
        optional: false,
      },
      renamed: {
        type: 'array',
        description: 'Applied `renamed` tombstones.',
        items: {
          type: 'json',
          description: 'A single applied `renamed` tombstone.',
          properties: {
            from: {
              type: 'string',
              description: 'The original (source) class name.',
              optional: false,
            },
            to: {
              type: 'string',
              description: 'The new class name (`renamed_to`).',
              optional: false,
            },
          },
        },
        optional: false,
      },
      transfer_pending: {
        type: 'array',
        description: 'Phase-1 transfer hints recorded on the target side.',
        items: {
          type: 'json',
          description:
            'A single phase-1 transfer hint recorded on the target side (a live `expecting-transfer` entry).',
          properties: {
            class: {
              type: 'string',
              description: 'The target-side class name awaiting transfer.',
              optional: false,
            },
            from: {
              type: 'string',
              description: 'The source script the namespace will be transferred from.',
              optional: false,
            },
          },
        },
        optional: false,
      },
      transferred: {
        type: 'array',
        description: 'Committed `transferred` tombstones (phase-2).',
        items: {
          type: 'json',
          description: 'A single committed `transferred` tombstone (phase-2 commit).',
          properties: {
            class: {
              type: 'string',
              description: 'The source class name that was transferred.',
              optional: false,
            },
            phase: {
              type: 'string',
              description: 'The transfer phase. Currently always `committed`. Values: committed.',
              optional: false,
            },
            to: {
              type: 'string',
              description: 'The destination script that now owns the namespace.',
              optional: false,
            },
          },
        },
        optional: false,
      },
      updated: {
        type: 'array',
        description: 'Class names whose provisioned namespace was mutated in place.',
        items: {
          type: 'string',
          description: 'updated item',
        },
        optional: false,
      },
      warnings: {
        type: 'array',
        description: 'Non-blocking warnings. See `exports_reconciliation_warning`.',
        items: {
          type: 'json',
          description:
            'A non-blocking reconciliation warning. Reserved: no scenario populates this array today (`code_class_not_in_exports` is surfaced as info and `provisioned_class_missing_from_config` is a hard error). Clients should still surface any entries that appear.',
          properties: {
            class: {
              type: 'string',
              description: 'The class name the warning is about.',
              optional: false,
            },
            message: {
              type: 'string',
              description: 'Human-readable explanation of the warning.',
              optional: false,
            },
            namespace_id: {
              type: 'string',
              description: 'The provisioned namespace the warning relates to, when applicable.',
              optional: true,
            },
            scenario: {
              type: 'string',
              description:
                'Stable, machine-readable tag identifying which reconciliation scenario produced an error, warning, or info entry.',
              optional: false,
            },
          },
        },
        optional: false,
      },
    },
    nullable: true,
  },
  limits: {
    type: 'json',
    description: 'Limits to apply for this Worker.',
    properties: {
      cpu_ms: {
        type: 'number',
        description: 'The amount of CPU time this Worker can use in milliseconds.',
        optional: true,
      },
      subrequests: {
        type: 'number',
        description: 'The number of subrequests this Worker can make per request.',
        optional: true,
      },
    },
    nullable: true,
  },
  logpush: {
    type: 'boolean',
    description: 'Whether Logpush is turned on for the Worker.',
    nullable: true,
  },
  migrations: {
    type: 'json',
    description: 'A single set of migrations to apply.',
    properties: {
      new_tag: {
        type: 'string',
        description: 'Tag to set as the latest migration tag.',
        optional: true,
      },
      old_tag: {
        type: 'string',
        description:
          "Tag used to verify against the latest migration tag for this Worker. If they don't match, the upload is rejected.",
        optional: true,
      },
      deleted_classes: {
        type: 'array',
        description: 'A list of classes to delete Durable Object namespaces from.',
        items: {
          type: 'string',
          description: 'deleted classes item',
        },
        optional: true,
      },
      new_classes: {
        type: 'array',
        description: 'A list of classes to create Durable Object namespaces from.',
        items: {
          type: 'string',
          description: 'new classes item',
        },
        optional: true,
      },
      new_sqlite_classes: {
        type: 'array',
        description: 'A list of classes to create Durable Object namespaces with SQLite from.',
        items: {
          type: 'string',
          description: 'new sqlite classes item',
        },
        optional: true,
      },
      renamed_classes: {
        type: 'array',
        description: 'A list of classes with Durable Object namespaces that were renamed.',
        items: {
          type: 'json',
          description: 'renamed classes item',
          properties: {
            from: {
              type: 'string',
              description: 'from',
              optional: true,
            },
            to: {
              type: 'string',
              description: 'to',
              optional: true,
            },
          },
        },
        optional: true,
      },
      transferred_classes: {
        type: 'array',
        description:
          'A list of transfers for Durable Object namespaces from a different Worker and class to a class defined in this Worker.',
        items: {
          type: 'json',
          description: 'transferred classes item',
          properties: {
            from: {
              type: 'string',
              description: 'from',
              optional: true,
            },
            from_script: {
              type: 'string',
              description: 'from script',
              optional: true,
            },
            to: {
              type: 'string',
              description: 'to',
              optional: true,
            },
          },
        },
        optional: true,
      },
      steps: {
        type: 'array',
        description: 'Migrations to apply in order.',
        items: {
          type: 'json',
          description: 'steps item',
          properties: {
            deleted_classes: {
              type: 'array',
              description: 'A list of classes to delete Durable Object namespaces from.',
              items: {
                type: 'string',
                description: 'deleted classes item',
              },
              optional: true,
            },
            new_classes: {
              type: 'array',
              description: 'A list of classes to create Durable Object namespaces from.',
              items: {
                type: 'string',
                description: 'new classes item',
              },
              optional: true,
            },
            new_sqlite_classes: {
              type: 'array',
              description:
                'A list of classes to create Durable Object namespaces with SQLite from.',
              items: {
                type: 'string',
                description: 'new sqlite classes item',
              },
              optional: true,
            },
            renamed_classes: {
              type: 'array',
              description: 'A list of classes with Durable Object namespaces that were renamed.',
              items: {
                type: 'json',
                description: 'renamed classes item',
                properties: {
                  from: {
                    type: 'string',
                    description: 'from',
                    optional: true,
                  },
                  to: {
                    type: 'string',
                    description: 'to',
                    optional: true,
                  },
                },
              },
              optional: true,
            },
            transferred_classes: {
              type: 'array',
              description:
                'A list of transfers for Durable Object namespaces from a different Worker and class to a class defined in this Worker.',
              items: {
                type: 'json',
                description: 'transferred classes item',
                properties: {
                  from: {
                    type: 'string',
                    description: 'from',
                    optional: true,
                  },
                  from_script: {
                    type: 'string',
                    description: 'from script',
                    optional: true,
                  },
                  to: {
                    type: 'string',
                    description: 'to',
                    optional: true,
                  },
                },
              },
              optional: true,
            },
          },
        },
        optional: true,
      },
    },
    nullable: true,
  },
  observability: WORKER_SCRIPT_OUTPUTS_OBSERVABILITY_FIELDS,
  placement: {
    type: 'json',
    description:
      "Configuration for [Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement). Specify mode='smart' for Smart Placement, or one of region/hostname/host.",
    properties: {
      mode: {
        type: 'string',
        description: 'Targeted placement mode. Values: smart, targeted.',
        optional: true,
      },
      region: {
        type: 'string',
        description: "Cloud region for targeted placement in format 'provider:region'.",
        optional: true,
      },
      hostname: {
        type: 'string',
        description: 'HTTP hostname for targeted placement.',
        optional: true,
      },
      host: {
        type: 'string',
        description: 'TCP host and port for targeted placement.',
        optional: true,
      },
      target: {
        type: 'array',
        description: 'Array of placement targets (currently limited to single target).',
        items: {
          type: 'json',
          description: 'A target to run your Worker near.',
          properties: {
            region: {
              type: 'string',
              description: "Cloud region in format 'provider:region'.",
              optional: true,
            },
            hostname: {
              type: 'string',
              description: 'HTTP hostname for targeted placement.',
              optional: true,
            },
            host: {
              type: 'string',
              description: 'TCP host:port for targeted placement.',
              optional: true,
            },
          },
        },
        optional: true,
      },
    },
    nullable: true,
  },
  tags: {
    type: 'array',
    description: 'Tags associated with the Worker.',
    items: {
      type: 'string',
      description: 'tags item',
    },
  },
  tail_consumers: {
    type: 'array',
    description: 'List of Workers that will consume logs from the attached Worker.',
    items: {
      type: 'json',
      description: 'A reference to a script that will consume logs from the attached Worker.',
      properties: {
        environment: {
          type: 'string',
          description: 'Optional environment if the Worker utilizes one.',
          optional: true,
        },
        namespace: {
          type: 'string',
          description: 'Optional dispatch namespace the script belongs to.',
          optional: true,
        },
        service: {
          type: 'string',
          description: 'Name of Worker that is to be the consumer.',
          optional: false,
        },
      },
    },
  },
  usage_model: {
    type: 'string',
    description: 'Usage model for the Worker invocations. Values: standard, bundled, unbound.',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const ZONE_OUTPUTS = {
  account: {
    type: 'json',
    description: 'The account the zone belongs to.',
    properties: {
      id: {
        type: 'string',
        description: 'Identifier',
        optional: true,
      },
      name: {
        type: 'string',
        description: 'The name of the account.',
        optional: true,
      },
    },
    nullable: true,
  },
  activated_on: {
    type: 'string',
    description: 'The last time proof of ownership was detected and the zone was made active.',
    nullable: true,
  },
  cname_suffix: {
    type: 'string',
    description: 'Allows the customer to use a custom apex. *Tenants Only Configuration*.',
    nullable: true,
  },
  created_on: {
    type: 'string',
    description: 'When the zone was created.',
    nullable: true,
  },
  development_mode: {
    type: 'number',
    description:
      'The interval (in seconds) from when development mode expires (positive integer) or last expired (negative integer) for the domain. If development mode has never been enabled, this value is 0.',
    nullable: true,
  },
  id: {
    type: 'string',
    description: 'Identifier',
    nullable: true,
  },
  meta: {
    type: 'json',
    description: 'Metadata about the zone.',
    properties: {
      cdn_only: {
        type: 'boolean',
        description: 'The zone is only configured for CDN.',
        optional: true,
      },
      custom_certificate_quota: {
        type: 'number',
        description: 'Number of Custom Certificates the zone can have.',
        optional: true,
      },
      dns_only: {
        type: 'boolean',
        description: 'The zone is only configured for DNS.',
        optional: true,
      },
      foundation_dns: {
        type: 'boolean',
        description: 'The zone is setup with Foundation DNS.',
        optional: true,
      },
      page_rule_quota: {
        type: 'number',
        description: 'Number of Page Rules a zone can have.',
        optional: true,
      },
      phishing_detected: {
        type: 'boolean',
        description: 'The zone has been flagged for phishing.',
        optional: true,
      },
      step: {
        type: 'number',
        description: 'step',
        optional: true,
      },
    },
    nullable: true,
  },
  modified_on: {
    type: 'string',
    description: 'When the zone was last modified.',
    nullable: true,
  },
  name: {
    type: 'string',
    description:
      'The domain name. Per [RFC 1035](https://datatracker.ietf.org/doc/html/rfc1035#section-2.3.4) the overall zone name can be up to 253 characters, with each segment ("label") not exceeding 63 characters.',
    nullable: true,
  },
  name_servers: {
    type: 'array',
    description: 'The name servers Cloudflare assigns to a zone.',
    items: {
      type: 'string',
      description: 'name servers item',
    },
  },
  original_dnshost: {
    type: 'string',
    description: 'DNS host at the time of switching to Cloudflare.',
    nullable: true,
  },
  original_name_servers: {
    type: 'array',
    description: 'Original name servers before moving to Cloudflare.',
    items: {
      type: 'string',
      description: 'original name servers item',
    },
  },
  original_registrar: {
    type: 'string',
    description: 'Registrar for the domain at the time of switching to Cloudflare.',
    nullable: true,
  },
  owner: {
    type: 'json',
    description: 'The owner of the zone.',
    properties: {
      id: {
        type: 'string',
        description: 'Identifier',
        optional: true,
      },
      name: {
        type: 'string',
        description: 'Name of the owner.',
        optional: true,
      },
      type: {
        type: 'string',
        description: 'The type of owner.',
        optional: true,
      },
    },
    nullable: true,
  },
  paused: {
    type: 'boolean',
    description:
      'Indicates whether the zone is only using Cloudflare DNS services. A true value means the zone will not receive security or performance benefits.',
    nullable: true,
  },
  permissions: {
    type: 'array',
    description: 'Legacy permissions based on legacy user membership information.',
    items: {
      type: 'string',
      description: 'permissions item',
    },
  },
  plan: {
    type: 'json',
    description: 'A Zones subscription information.',
    properties: {
      can_subscribe: {
        type: 'boolean',
        description: 'States if the subscription can be activated.',
        optional: true,
      },
      currency: {
        type: 'string',
        description: 'The denomination of the customer.',
        optional: true,
      },
      externally_managed: {
        type: 'boolean',
        description: 'If this Zone is managed by another company.',
        optional: true,
      },
      frequency: {
        type: 'string',
        description: 'How often the customer is billed.',
        optional: true,
      },
      id: {
        type: 'string',
        description: 'Identifier',
        optional: true,
      },
      is_subscribed: {
        type: 'boolean',
        description: 'States if the subscription active.',
        optional: true,
      },
      legacy_discount: {
        type: 'boolean',
        description: 'If the legacy discount applies to this Zone.',
        optional: true,
      },
      legacy_id: {
        type: 'string',
        description: 'The legacy name of the plan.',
        optional: true,
      },
      name: {
        type: 'string',
        description: 'Name of the owner.',
        optional: true,
      },
      price: {
        type: 'number',
        description: 'How much the customer is paying.',
        optional: true,
      },
    },
    nullable: true,
  },
  status: {
    type: 'string',
    description: 'The zone status on Cloudflare. Values: initializing, pending, active, moved.',
    nullable: true,
  },
  tenant: {
    type: 'json',
    description:
      'The root organizational unit that this zone belongs to (such as a tenant or organization).',
    properties: {
      id: {
        type: 'string',
        description: 'Identifier',
        optional: true,
      },
      name: {
        type: 'string',
        description: 'The name of the Tenant account.',
        optional: true,
      },
    },
    nullable: true,
  },
  tenant_unit: {
    type: 'json',
    description:
      'The immediate parent organizational unit that this zone belongs to (such as under a tenant or sub-organization).',
    properties: {
      id: {
        type: 'string',
        description: 'Identifier',
        optional: true,
      },
    },
    nullable: true,
  },
  type: {
    type: 'string',
    description:
      'A full zone implies that DNS is hosted with Cloudflare. A partial zone is typically a partner-hosted zone or a CNAME setup. Values: full, partial, secondary, internal.',
    nullable: true,
  },
  vanity_name_servers: {
    type: 'array',
    description:
      'An array of domains used for custom name servers. This is only available for Business and Enterprise plans.',
    items: {
      type: 'string',
      description: 'vanity name servers item',
    },
  },
  verification_key: {
    type: 'string',
    description: 'Verification key for partial zone setup.',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>
