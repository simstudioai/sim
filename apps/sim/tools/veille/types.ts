import type { OutputProperty, ToolResponse } from '@/tools/types'

/** MxRecord read from a Veille API response. */
export interface VeilleMxRecord {
  hostname: string | null
  priority: number | null
}

/** Dns read from a Veille API response. */
export interface VeilleDns {
  mx: boolean | null
  spf: string | null
  spfValid: boolean | null
  dmarc: string | null
  dmarcValid: boolean | null
  mxRecords: VeilleMxRecord[]
}

/** Asn read from a Veille API response. */
export interface VeilleAsn {
  asn: number | null
  org: string | null
  type: string | null
  route: string | null
  domain: string | null
  country: string | null
  abuse: string | null
  active: boolean | null
}

/** IpLocation read from a Veille API response. */
export interface VeilleIpLocation {
  city: string | null
  state: string | null
  country: string | null
  countryCode: string | null
  continent: string | null
  zip: string | null
  latitude: number | null
  longitude: number | null
  timezone: string | null
  isEuMember: boolean | null
  currencyCode: string | null
}

/** Whois read from a Veille API response. */
export interface VeilleWhois {
  registrar: string | null
  creationDate: string | null
  updatedDate: string | null
  expirationDate: string | null
}

const VEILLE_MX_RECORD_OUTPUT_PROPERTIES = {
  hostname: {
    type: 'string',
    description: 'Mail server hostname',
    optional: true,
  },
  priority: {
    type: 'number',
    description: 'MX priority, lower is preferred',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const VEILLE_DNS_OUTPUT_PROPERTIES = {
  mx: {
    type: 'boolean',
    description: 'Whether the domain has MX records',
    optional: true,
  },
  spf: {
    type: 'string',
    description: 'SPF record of the domain',
    optional: true,
  },
  spfValid: {
    type: 'boolean',
    description: 'Whether the SPF record is valid',
    optional: true,
  },
  dmarc: {
    type: 'string',
    description: 'DMARC record of the domain',
    optional: true,
  },
  dmarcValid: {
    type: 'boolean',
    description: 'Whether the DMARC record is valid',
    optional: true,
  },
  mxRecords: {
    type: 'array',
    description: 'MX records of the domain',
    optional: true,
    items: { type: 'object', properties: VEILLE_MX_RECORD_OUTPUT_PROPERTIES },
  },
} as const satisfies Record<string, OutputProperty>

export const VEILLE_ASN_OUTPUT_PROPERTIES = {
  asn: {
    type: 'number',
    description: 'Autonomous system number',
    optional: true,
  },
  org: {
    type: 'string',
    description: 'Organization that owns the network',
    optional: true,
  },
  type: {
    type: 'string',
    description: 'Network type, such as hosting, isp or business',
    optional: true,
  },
  route: {
    type: 'string',
    description: 'IP range announced for the network',
    optional: true,
  },
  domain: {
    type: 'string',
    description: 'Domain of the network owner',
    optional: true,
  },
  country: {
    type: 'string',
    description: 'Country code of the network owner',
    optional: true,
  },
  abuse: {
    type: 'string',
    description: 'Abuse contact email of the network',
    optional: true,
  },
  active: {
    type: 'boolean',
    description: 'Whether the network is active',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const VEILLE_IP_LOCATION_OUTPUT_PROPERTIES = {
  city: {
    type: 'string',
    description: 'City',
    optional: true,
  },
  state: {
    type: 'string',
    description: 'State or region',
    optional: true,
  },
  country: {
    type: 'string',
    description: 'Country name',
    optional: true,
  },
  countryCode: {
    type: 'string',
    description: 'ISO 3166-1 alpha-2 country code',
    optional: true,
  },
  continent: {
    type: 'string',
    description: 'Continent code',
    optional: true,
  },
  zip: {
    type: 'string',
    description: 'Postal code',
    optional: true,
  },
  latitude: {
    type: 'number',
    description: 'Latitude',
    optional: true,
  },
  longitude: {
    type: 'number',
    description: 'Longitude',
    optional: true,
  },
  timezone: {
    type: 'string',
    description: 'IANA time zone',
    optional: true,
  },
  isEuMember: {
    type: 'boolean',
    description: 'Whether the country is a member of the European Union',
    optional: true,
  },
  currencyCode: {
    type: 'string',
    description: 'ISO 4217 code of the local currency',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const VEILLE_WHOIS_OUTPUT_PROPERTIES = {
  registrar: {
    type: 'string',
    description: 'Registrar of the domain',
    optional: true,
  },
  creationDate: {
    type: 'string',
    description: 'Date the domain was registered',
    optional: true,
  },
  updatedDate: {
    type: 'string',
    description: 'Date the registration was last updated',
    optional: true,
  },
  expirationDate: {
    type: 'string',
    description: 'Date the registration expires',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface VeilleVerifyEmailParams {
  apiKey: string
  email: string
}

export interface VeilleVerifyEmailResponse extends ToolResponse {
  output: {
    qualification: string | null
    smtpValid: boolean | null
    email: string | null
    normalizedEmail: string | null
    domain: string | null
    riskScore: number | null
    disposable: boolean | null
    roleAccount: boolean | null
    roleType: string | null
    publicDomain: boolean | null
    relayDomain: boolean | null
    isAlias: boolean | null
    education: boolean | null
    hasGravatar: boolean | null
    dns: VeilleDns | null
  }
}

export interface VeilleCheckEmailParams {
  apiKey: string
  email: string
}

export interface VeilleCheckEmailResponse extends ToolResponse {
  output: {
    email: string | null
    normalizedEmail: string | null
    domain: string | null
    riskScore: number | null
    disposable: boolean | null
    roleAccount: boolean | null
    roleType: string | null
    publicDomain: boolean | null
    relayDomain: boolean | null
    isAlias: boolean | null
    education: boolean | null
    hasGravatar: boolean | null
    dns: VeilleDns | null
  }
}

export interface VeilleValidatePhoneParams {
  apiKey: string
  phone: string
}

export interface VeilleValidatePhoneResponse extends ToolResponse {
  output: {
    isValid: boolean | null
    e164Format: string | null
    internationalFormat: string | null
    nationalFormat: string | null
    lineType: string | null
    carrier: string | null
    carrierType: string | null
    country: string | null
    countryName: string | null
    callingCode: string | null
    region: string | null
    timezones: string[]
    isVirtual: boolean | null
    isDisposable: boolean | null
    isSpam: boolean | null
    isThreat: boolean | null
    riskScore: number | null
  }
}

export interface VeilleCheckIpParams {
  apiKey: string
  ip: string
}

export interface VeilleCheckIpResponse extends ToolResponse {
  output: {
    ip: string | null
    threatScore: number | null
    isVpn: boolean | null
    isProxy: boolean | null
    isTor: boolean | null
    isDatacenter: boolean | null
    isAbuser: boolean | null
    isCrawler: boolean | null
    isMobile: boolean | null
    isBogon: boolean | null
    asn: VeilleAsn | null
    location: VeilleIpLocation | null
  }
}

export interface VeilleCheckDomainParams {
  apiKey: string
  domain: string
}

export interface VeilleCheckDomainResponse extends ToolResponse {
  output: {
    domain: string | null
    disposable: boolean | null
    publicDomain: boolean | null
    relayDomain: boolean | null
    education: boolean | null
    isSubdomain: boolean | null
    domainAgeDays: number | null
    tags: string[]
    sources: string[]
    firstSeen: string | null
    lastSeen: string | null
    whois: VeilleWhois | null
    dns: VeilleDns | null
  }
}

export interface VeilleVerifyVatParams {
  apiKey: string
  vatNumber: string
}

export interface VeilleVerifyVatResponse extends ToolResponse {
  output: {
    valid: boolean | null
    vatNumber: string | null
    countryCode: string | null
    companyName: string | null
    companyAddress: string | null
  }
}

export interface VeilleValidateIbanParams {
  apiKey: string
  iban: string
}

export interface VeilleValidateIbanResponse extends ToolResponse {
  output: {
    valid: boolean | null
    iban: string | null
    bic: string | null
    bankName: string | null
    bankCode: string | null
    branchCode: string | null
    accountNumber: string | null
    bban: string | null
    checksumDigits: string | null
    countryCode: string | null
    countryName: string | null
    inSepaZone: boolean | null
  }
}

export interface VeilleGetExchangeRatesParams {
  apiKey: string
  base?: string
  symbols?: string
}

export interface VeilleGetExchangeRatesResponse extends ToolResponse {
  output: {
    base: string | null
    date: string | null
    rates: Record<string, unknown> | null
  }
}
