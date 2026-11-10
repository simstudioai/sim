import { VeilleIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const VeilleBlock: BlockConfig = {
  type: 'veille',
  name: 'Veille',
  description: 'Validate emails, phones, IPs, domains, VAT numbers and IBANs',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Check signups and forms for fraud with Veille: verify email deliverability, flag disposable, role and webmail addresses, validate phone numbers, score IP addresses for VPN, proxy and Tor traffic, inspect domains, verify EU VAT numbers and IBANs, and read the European Central Bank's daily exchange rates.",
  docsLink: 'https://docs.sim.ai/integrations/veille',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#FFFFFF',
  icon: VeilleIcon,
  canvasPresentation: {
    defaultTitle: 'Veille',
    sentences: {
      byOperation: {
        verify_email: [{ text: 'Verify that', field: 'email', core: true }, 'can receive mail'],
        check_email: [
          { text: 'Check', field: 'email', core: true },
          'for disposable, role and webmail use',
        ],
        validate_phone: [{ text: 'Validate', field: 'phone', core: true }],
        check_ip: [{ text: 'Check the reputation of', field: 'ip', core: true }],
        check_domain: [{ text: 'Check the domain', field: 'domain', core: true }],
        verify_vat: [{ text: 'Verify the VAT number', field: 'vatNumber', core: true }],
        validate_iban: [{ text: 'Validate', field: 'iban', core: true }],
        get_exchange_rates: [
          "Get today's exchange rates",
          { text: 'from', field: 'base' },
          { text: 'into', field: 'symbols' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Verify Email', id: 'verify_email' },
        { label: 'Check Email', id: 'check_email' },
        { label: 'Validate Phone', id: 'validate_phone' },
        { label: 'Check IP', id: 'check_ip' },
        { label: 'Check Domain', id: 'check_domain' },
        { label: 'Verify VAT Number', id: 'verify_vat' },
        { label: 'Validate IBAN', id: 'validate_iban' },
        { label: 'Get Exchange Rates', id: 'get_exchange_rates' },
      ],
      value: () => 'verify_email',
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Enter an email address',
      condition: { field: 'operation', value: ['verify_email', 'check_email'] },
      required: { field: 'operation', value: ['verify_email', 'check_email'] },
    },
    {
      id: 'phone',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+33142928100',
      condition: { field: 'operation', value: 'validate_phone' },
      required: { field: 'operation', value: 'validate_phone' },
    },
    {
      id: 'ip',
      title: 'IP Address',
      type: 'short-input',
      placeholder: 'Enter an IPv4 or IPv6 address',
      condition: { field: 'operation', value: 'check_ip' },
      required: { field: 'operation', value: 'check_ip' },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Enter a domain, URL or email address',
      condition: { field: 'operation', value: 'check_domain' },
      required: { field: 'operation', value: 'check_domain' },
    },
    {
      id: 'vatNumber',
      title: 'VAT Number',
      type: 'short-input',
      placeholder: 'FR40303265045',
      condition: { field: 'operation', value: 'verify_vat' },
      required: { field: 'operation', value: 'verify_vat' },
    },
    {
      id: 'iban',
      title: 'IBAN',
      type: 'short-input',
      placeholder: 'FR7630006000011234567890189',
      condition: { field: 'operation', value: 'validate_iban' },
      required: { field: 'operation', value: 'validate_iban' },
    },
    {
      id: 'base',
      title: 'Base Currency',
      type: 'short-input',
      placeholder: 'Defaults to EUR',
      condition: { field: 'operation', value: 'get_exchange_rates' },
    },
    {
      id: 'symbols',
      title: 'Target Currencies',
      type: 'short-input',
      placeholder: 'EUR,GBP',
      condition: { field: 'operation', value: 'get_exchange_rates' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Veille API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'veille_verify_email',
      'veille_check_email',
      'veille_validate_phone',
      'veille_check_ip',
      'veille_check_domain',
      'veille_verify_vat',
      'veille_validate_iban',
      'veille_get_exchange_rates',
    ],
    config: {
      tool: (params) => `veille_${params.operation}`,
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    email: { type: 'string', description: 'The email address to check (e.g., "jane@company.com")' },
    phone: {
      type: 'string',
      description: 'The phone number in E.164 format, starting with + (e.g., "+33142928100")',
    },
    ip: { type: 'string', description: 'The IPv4 or IPv6 address (e.g., "8.8.8.8")' },
    domain: {
      type: 'string',
      description:
        'A domain, URL or email address; the domain is extracted (e.g., "mailinator.com")',
    },
    vatNumber: {
      type: 'string',
      description: 'The VAT number with its country prefix (e.g., "FR40303265045")',
    },
    iban: {
      type: 'string',
      description: 'The IBAN, with or without spaces (e.g., "FR7630006000011234567890189")',
    },
    base: {
      type: 'string',
      description: 'ISO 4217 code of the base currency; defaults to EUR (e.g., "USD")',
    },
    symbols: {
      type: 'string',
      description: 'Comma-separated ISO 4217 codes to keep (e.g., "EUR,GBP")',
    },
    apiKey: { type: 'string', description: 'Veille API key' },
  },
  outputs: {
    qualification: {
      type: 'string',
      description: 'Verdict: valid, invalid, risky, disposable or unknown',
    },
    smtpValid: { type: 'boolean', description: 'Whether the inbox accepted mail in the SMTP test' },
    email: { type: 'string', description: 'The email address that was checked' },
    normalizedEmail: { type: 'string', description: 'The address in lowercase, as checked' },
    domain: {
      type: 'string',
      description: 'Domain of the email address, or the domain that was checked',
    },
    riskScore: { type: 'number', description: 'Risk score from 0 (safe) to 100 (risky)' },
    disposable: {
      type: 'boolean',
      description: 'Whether the address or domain uses disposable inboxes',
    },
    roleAccount: {
      type: 'boolean',
      description: 'Whether the address is a role account, such as contact@ or support@',
    },
    roleType: { type: 'string', description: 'Role of a role account, such as contact or support' },
    publicDomain: {
      type: 'boolean',
      description: 'Whether the domain is a public webmail provider',
    },
    relayDomain: {
      type: 'boolean',
      description: 'Whether the domain is an email relay or forwarding service',
    },
    isAlias: {
      type: 'boolean',
      description: 'Whether the address is an alias, such as a plus address',
    },
    education: {
      type: 'boolean',
      description: 'Whether the domain belongs to an education institution',
    },
    hasGravatar: { type: 'boolean', description: 'Whether the address has a Gravatar profile' },
    dns: { type: 'json', description: 'DNS health of the domain: MX, SPF and DMARC records' },
    isValid: { type: 'boolean', description: 'Whether the number is valid' },
    e164Format: { type: 'string', description: 'The number in E.164 format' },
    internationalFormat: { type: 'string', description: 'The number in international format' },
    nationalFormat: { type: 'string', description: 'The number in national format' },
    lineType: { type: 'string', description: 'Line type, such as mobile, fixed_line or voip' },
    carrier: { type: 'string', description: 'Carrier of the number' },
    carrierType: { type: 'string', description: 'Carrier type' },
    country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code of the number' },
    countryName: { type: 'string', description: 'Country of the number' },
    callingCode: { type: 'string', description: 'International calling code, without +' },
    region: { type: 'string', description: 'City or region the number is registered to' },
    timezones: { type: 'json', description: 'Time zones of the number' },
    isVirtual: { type: 'boolean', description: 'Whether the number is virtual' },
    isDisposable: { type: 'boolean', description: 'Whether the number is a disposable number' },
    isSpam: { type: 'boolean', description: 'Whether the number is reported for spam' },
    isThreat: { type: 'boolean', description: 'Whether the number is reported as a threat' },
    ip: { type: 'string', description: 'The IP address that was checked' },
    threatScore: { type: 'number', description: 'Threat score from 0 (safe) to 100 (risky)' },
    isVpn: { type: 'boolean', description: 'Whether the address belongs to a VPN' },
    isProxy: { type: 'boolean', description: 'Whether the address is a proxy' },
    isTor: { type: 'boolean', description: 'Whether the address is a Tor exit node' },
    isDatacenter: {
      type: 'boolean',
      description: 'Whether the address belongs to a datacenter or hosting provider',
    },
    isAbuser: { type: 'boolean', description: 'Whether the address is reported for abuse' },
    isCrawler: { type: 'boolean', description: 'Whether the address belongs to a known crawler' },
    isMobile: { type: 'boolean', description: 'Whether the address belongs to a mobile network' },
    isBogon: {
      type: 'boolean',
      description: 'Whether the address is a bogon (reserved or unassigned) address',
    },
    asn: { type: 'json', description: 'Network that owns the address' },
    location: { type: 'json', description: 'Geolocation of the address' },
    isSubdomain: { type: 'boolean', description: 'Whether the domain is a subdomain' },
    domainAgeDays: { type: 'number', description: 'Age of the domain in days' },
    tags: { type: 'json', description: 'Labels for the domain, such as disposable' },
    sources: { type: 'json', description: 'Lists that report the domain' },
    firstSeen: { type: 'string', description: 'When Veille first saw the domain' },
    lastSeen: { type: 'string', description: 'When Veille last saw the domain' },
    whois: { type: 'json', description: 'Registration dates and registrar' },
    valid: { type: 'boolean', description: 'Whether the VAT number or IBAN is valid' },
    vatNumber: { type: 'string', description: 'The VAT number without its country prefix' },
    countryCode: { type: 'string', description: 'Country code of the VAT number or IBAN' },
    companyName: {
      type: 'string',
      description: 'Registered company name, when the member state shares it',
    },
    companyAddress: {
      type: 'string',
      description: 'Registered company address, when the member state shares it',
    },
    iban: { type: 'string', description: 'The IBAN without spaces' },
    bic: { type: 'string', description: 'BIC of the bank' },
    bankName: { type: 'string', description: 'Name of the bank' },
    bankCode: { type: 'string', description: 'Bank code' },
    branchCode: { type: 'string', description: 'Branch code' },
    accountNumber: { type: 'string', description: 'Account number' },
    bban: { type: 'string', description: 'Basic bank account number' },
    checksumDigits: { type: 'string', description: 'Checksum digits' },
    inSepaZone: { type: 'boolean', description: 'Whether the country is in the SEPA zone' },
    base: { type: 'string', description: 'Base currency of the rates' },
    date: { type: 'string', description: 'Date of the rates (YYYY-MM-DD)' },
    rates: {
      type: 'json',
      description: 'Rates keyed by ISO 4217 currency code, for one unit of the base currency',
    },
  },
}

export const VeilleBlockMeta = {
  tags: ['identity', 'enrichment', 'automation'],
  url: 'https://www.veille.io',
  templates: [
    {
      icon: VeilleIcon,
      title: 'Veille signup screener',
      prompt:
        'Build a workflow that runs on each new signup, checks the email with Veille for disposable or role addresses and the IP for VPN, proxy and Tor traffic, and flags risky accounts in Slack before they are activated.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['security', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: VeilleIcon,
      title: 'Veille list cleaner',
      prompt:
        'Create a workflow that reads a table of email leads, verifies each address with Veille, writes the verdict and risk score back to the table, and removes invalid and disposable addresses before a campaign.',
      modules: ['tables', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: VeilleIcon,
      title: 'Veille VAT checker',
      prompt:
        'Build a workflow that verifies the EU VAT number of each new B2B customer with Veille, records the registered company name, and alerts finance in Slack when a number is invalid.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: VeilleIcon,
      title: 'Veille IBAN validator',
      prompt:
        'Create a workflow that validates supplier IBANs with Veille before payment runs, stores the bank name and BIC in a table, and holds payments to IBANs that fail the check.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: VeilleIcon,
      title: 'Veille daily FX rates',
      prompt:
        "Build a scheduled workflow that fetches the European Central Bank's daily exchange rates with Veille for USD, GBP and CHF, appends them to a table, and posts the day's moves to Slack.",
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: VeilleIcon,
      title: 'Veille checkout risk review',
      prompt:
        'Create a workflow that runs on each order, checks the buyer email, phone number and IP address with Veille, and has an agent summarize the combined risk for manual review when any score is high.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['security', 'analysis'],
    },
    {
      icon: VeilleIcon,
      title: 'Veille form spam filter',
      prompt:
        'Build a workflow for contact form submissions that checks the email domain with Veille, drops submissions from disposable or relay domains, and routes the rest to the sales inbox.',
      modules: ['workflows'],
      category: 'sales',
      tags: ['automation', 'security'],
    },
  ],
  skills: [
    {
      name: 'screen-new-signup',
      description:
        'Score a new signup for fraud by checking its email address and IP address with Veille.',
      content:
        '# Screen New Signup\n\nDecide whether a new account looks genuine before it is activated.\n\n## Steps\n1. Run the check email operation on the signup email and note disposable, role account, public webmail and the risk score.\n2. Run the check IP operation on the signup IP and note VPN, proxy, Tor, datacenter and the threat score.\n3. Combine both results: block disposable inboxes and Tor traffic, review high risk or threat scores, accept the rest.\n\n## Output\nReturn accept, review or block, with the signals that drove the decision.',
    },
    {
      name: 'clean-email-list',
      description:
        'Verify a list of email addresses with Veille and keep only those that can receive mail.',
      content:
        '# Clean Email List\n\nRemove addresses that would bounce or waste sends before a campaign or CRM import.\n\n## Steps\n1. Run the verify email operation on each address.\n2. Keep addresses whose qualification is valid; drop invalid and disposable ones; set risky and unknown aside for review.\n3. Note role accounts separately, as they rarely reach a person.\n\n## Output\nReturn the kept, dropped and review lists with the verdict and risk score of each address.',
    },
    {
      name: 'verify-b2b-customer',
      description:
        'Verify the EU VAT number and IBAN of a business customer or supplier with Veille.',
      content:
        "# Verify B2B Customer\n\nConfirm a company's tax and bank details before invoicing or paying it.\n\n## Steps\n1. Run the verify VAT number operation with the number and its country prefix, and note whether it is valid and the registered name and address.\n2. Run the validate IBAN operation and note validity, bank name, BIC and SEPA membership.\n3. Compare the registered company name with the name on file.\n\n## Output\nReturn whether both checks pass, the registered company details and any mismatch to resolve.",
    },
    {
      name: 'convert-currency-amounts',
      description:
        'Convert amounts between currencies at the European Central Bank daily rate fetched with Veille.',
      content:
        '# Convert Currency Amounts\n\nConvert prices or invoice totals at the official daily rate.\n\n## Steps\n1. Run the get exchange rates operation with the source currency as the base and the target currencies as symbols.\n2. Multiply each amount by the rate of its target currency.\n3. Keep the date of the rates with the result.\n\n## Output\nReturn each converted amount with the rate and the date it applies to.',
    },
  ],
} as const satisfies BlockMeta
