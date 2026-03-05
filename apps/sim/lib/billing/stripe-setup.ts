/**
 * Stripe Price Setup Script
 *
 * Run this script to create the 20 Stripe prices (10 monthly + 10 annual)
 * for the credit-tier billing system. Requires STRIPE_SECRET_KEY in env.
 *
 * Usage: bunx tsx apps/sim/lib/billing/stripe-setup.ts
 *
 * After running, copy the printed env vars into your .env file.
 */

import Stripe from 'stripe'
import { ANNUAL_DISCOUNT_RATE, CREDIT_TIERS } from '@/lib/billing/constants'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
if (!STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY is required')
  process.exit(1)
}

const stripe = new Stripe(STRIPE_SECRET_KEY)

const PRODUCT_NAME = 'Sim Credits Plan'

async function findOrCreateProduct(): Promise<string> {
  const existing = await stripe.products.list({ limit: 100 })
  const product = existing.data.find((p) => p.name === PRODUCT_NAME && p.active)
  if (product) {
    console.log(`Using existing product: ${product.id}`)
    return product.id
  }

  const newProduct = await stripe.products.create({
    name: PRODUCT_NAME,
    description: 'Sim platform credit-based billing plan',
  })
  console.log(`Created product: ${newProduct.id}`)
  return newProduct.id
}

async function createPricesForProduct(productId: string) {
  const envVars: Record<string, string> = {}

  for (const tier of CREDIT_TIERS) {
    const monthlyAmountCents = tier.dollars * 100
    const annualAmountCents = Math.round(tier.dollars * 12 * (1 - ANNUAL_DISCOUNT_RATE) * 100)

    const monthlyPrice = await stripe.prices.create({
      product: productId,
      unit_amount: monthlyAmountCents,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: {
        tier_credits: tier.credits.toString(),
        tier_dollars: tier.dollars.toString(),
        interval: 'month',
      },
    })

    const annualPrice = await stripe.prices.create({
      product: productId,
      unit_amount: annualAmountCents,
      currency: 'usd',
      recurring: { interval: 'year' },
      metadata: {
        tier_credits: tier.credits.toString(),
        tier_dollars: tier.dollars.toString(),
        interval: 'year',
        discount_rate: ANNUAL_DISCOUNT_RATE.toString(),
      },
    })

    const envKeyMo = `STRIPE_PRICE_TIER_${tier.dollars}_MO`
    const envKeyYr = `STRIPE_PRICE_TIER_${tier.dollars}_YR`

    envVars[envKeyMo] = monthlyPrice.id
    envVars[envKeyYr] = annualPrice.id

    console.log(
      `Tier $${tier.dollars} (${tier.credits} credits): ` +
        `monthly=${monthlyPrice.id} ($${tier.dollars}/mo), ` +
        `annual=${annualPrice.id} ($${(annualAmountCents / 100).toFixed(2)}/yr)`
    )
  }

  console.log('\n# Add these to your .env file:')
  for (const [key, value] of Object.entries(envVars)) {
    console.log(`${key}=${value}`)
  }

  console.log('\n# Legacy compatibility (reuse $20/mo and $40/mo tier prices):')
  console.log(`# STRIPE_PRO_PRICE_ID can be set to the same value as STRIPE_PRICE_TIER_20_MO`)
  console.log(`# STRIPE_TEAM_PRICE_ID can be set to the same value as STRIPE_PRICE_TIER_40_MO`)
}

async function main() {
  console.log('Setting up Stripe prices for credit-tier billing...\n')
  console.log(
    `Tiers: ${CREDIT_TIERS.length} (${CREDIT_TIERS[0].credits} - ${CREDIT_TIERS[CREDIT_TIERS.length - 1].credits} credits)`
  )
  console.log(`Annual discount: ${ANNUAL_DISCOUNT_RATE * 100}%\n`)

  const productId = await findOrCreateProduct()
  await createPricesForProduct(productId)

  console.log(
    '\nDone! Enable "Display yearly prices in monthly terms" in Stripe Checkout settings:'
  )
  console.log('https://dashboard.stripe.com/settings/checkout')
}

main().catch(console.error)
