import { parse } from 'tldts'

/**
 * Platforms whose tenant hosts no icon provider can see — not even at any parent the walk
 * reaches — mapped to the platform's own site, so a tenant still shows the product it is. A
 * platform whose parent already resolves (`salesforce.com`, `databricks.com`, `atlassian.net`)
 * needs no entry. Generic hosting domains (`herokuapp.com`, `azurewebsites.net`,
 * `cloudfront.net`) are deliberately absent: they serve other companies' apps, and the host's
 * logo would misrepresent them. GitLab Pages on Dedicated (`gitlab-dedicated.site`) maps like
 * `gitlab.io`, whose parent already shows GitLab's icon.
 */
const PLATFORM_SITES: ReadonlyMap<string, string> = new Map([
  ['awsapps.com', 'aws.amazon.com'],
  ['azuredatabricks.net', 'databricks.com'],
  ['coupacloud.com', 'coupa.com'],
  ['coupahost.com', 'coupa.com'],
  ['databricks.us', 'databricks.com'],
  ['databricksapps.com', 'databricks.com'],
  ['databricksapps.mil', 'databricks.com'],
  ['databricksapps.us', 'databricks.com'],
  ['gitlab-dedicated.com', 'gitlab.com'],
  ['gitlab-dedicated.site', 'gitlab.com'],
  ['gitlab-dedicated.systems', 'gitlab.com'],
  ['jamacloud.com', 'jamasoftware.com'],
  ['oktapreview.com', 'okta.com'],
  ['testrail.io', 'testrail.com'],
  ['ultipro.com', 'ukg.com'],
])

/**
 * Self-hosted tools conventionally served at `<product>.<company domain>` — only on a company's
 * own domain, never on a hosting platform's suffix (`gitlab.azurewebsites.net` is someone's app).
 */
const SELF_HOSTED_PRODUCTS: ReadonlyMap<string, string> = new Map([
  ['confluence', 'atlassian.com'],
  ['gitlab', 'gitlab.com'],
  ['grafana', 'grafana.com'],
  ['jenkins', 'jenkins.io'],
  ['jira', 'atlassian.com'],
  ['testrail', 'testrail.com'],
])

/** The public site of the platform a host belongs to, matched on whole labels, or `null`. */
export function platformSite(hostname: string): string | null {
  const labels = hostname.split('.')
  for (let index = 0; index < labels.length; index++) {
    const site = PLATFORM_SITES.get(labels.slice(index).join('.'))
    if (site) return site
  }
  if (parse(hostname, { allowPrivateDomains: true }).isPrivate) return null
  return SELF_HOSTED_PRODUCTS.get(labels[0]) ?? null
}
