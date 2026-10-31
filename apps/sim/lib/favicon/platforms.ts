/**
 * Platforms whose tenant hosts no icon provider can see — not even at the parent domain — mapped
 * to the platform's own site, so a tenant still shows the product it is. Generic hosting domains
 * (`herokuapp.com`, `azurewebsites.net`, `cloudfront.net`) are deliberately absent: they serve
 * other companies' apps, and the host's logo would misrepresent them.
 */
const PLATFORM_SITES: ReadonlyMap<string, string> = new Map([
  ['awsapps.com', 'aws.amazon.com'],
  ['azuredatabricks.net', 'databricks.com'],
  ['cloud.databricks.com', 'databricks.com'],
  ['coupahost.com', 'coupa.com'],
  ['databricksapps.com', 'databricks.com'],
  ['gitlab-dedicated.site', 'gitlab.com'],
  ['jamacloud.com', 'jamasoftware.com'],
  ['lightning.force.com', 'salesforce.com'],
  ['my.salesforce.com', 'salesforce.com'],
  ['oktapreview.com', 'okta.com'],
  ['ultipro.com', 'ukg.com'],
])

/** Self-hosted tools conventionally served at `<product>.<company domain>`. */
const SELF_HOSTED_PRODUCTS: ReadonlyMap<string, string> = new Map([
  ['confluence', 'atlassian.com'],
  ['gitlab', 'gitlab.com'],
  ['grafana', 'grafana.com'],
  ['jenkins', 'jenkins.io'],
  ['jira', 'atlassian.com'],
  ['sentry', 'sentry.io'],
  ['testrail', 'testrail.com'],
])

/** The public site of the platform a host belongs to, matched on whole labels, or `null`. */
export function platformSite(hostname: string): string | null {
  const labels = hostname.split('.')
  for (let index = 0; index < labels.length; index++) {
    const site = PLATFORM_SITES.get(labels.slice(index).join('.'))
    if (site) return site
  }
  return SELF_HOSTED_PRODUCTS.get(labels[0]) ?? null
}
