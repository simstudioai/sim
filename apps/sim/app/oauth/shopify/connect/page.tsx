import { ChipLink, StatusPageContent } from '@sim/emcn'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getShopifyInstallHandoff } from '@/lib/oauth/shopify-handoff'
import { shopifyInstallCookieName } from '@/lib/oauth/shopify-install-protocol'
import { LogoShell } from '@/app/(landing)/components/logo-shell'
import { ConnectionForm } from '@/app/oauth/shopify/connect/connection-form'

export const metadata: Metadata = {
  title: 'Connect Shopify',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

interface ShopifyConnectionPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ShopifyConnectionPage({ searchParams }: ShopifyConnectionPageProps) {
  const params = await searchParams
  const attemptId = typeof params.attempt === 'string' ? params.attempt : ''
  let shopDomain: string | undefined
  if (!params.error && attemptId) {
    try {
      const jar = await cookies()
      const proof = jar.get(shopifyInstallCookieName(attemptId))?.value ?? ''
      const handoff = await getShopifyInstallHandoff(attemptId, proof)
      shopDomain = handoff.shopDomain
    } catch {
      shopDomain = undefined
    }
  }
  if (!shopDomain) {
    return (
      <LogoShell center>
        <StatusPageContent
          title='Shopify connection could not be completed'
          description='The connection link is invalid or expired. Open Sim from Shopify to start a new connection.'
        >
          <ChipLink href='/home'>Open Sim</ChipLink>
        </StatusPageContent>
      </LogoShell>
    )
  }
  const session = await getSession()
  if (!session?.user?.id) {
    const callbackUrl = `/oauth/shopify/connect?${new URLSearchParams({ attempt: attemptId })}`
    redirect(`/login?${new URLSearchParams({ callbackUrl })}`)
  }
  return (
    <LogoShell center>
      <ConnectionForm key={attemptId} attemptId={attemptId} shopDomain={shopDomain} />
    </LogoShell>
  )
}
