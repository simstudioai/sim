import { getCostMultiplier } from '@/lib/core/config/env-flags'
import {
  FUNCTION_DAYTONA_DISK_GB,
  FUNCTION_SANDBOX_CPU_COUNT,
  FUNCTION_SANDBOX_MEMORY_GB,
} from '@/lib/execution/remote-sandbox/function-resources'
import {
  PI_DAYTONA_DISK_GB,
  PI_SANDBOX_CPU_COUNT,
  PI_SANDBOX_MEMORY_GB,
} from '@/lib/execution/remote-sandbox/pi-resources'
import type { SandboxKind, SandboxProviderId } from '@/lib/execution/remote-sandbox/types'

const E2B_CPU_USD_PER_VCPU_SECOND = 0.000014
const E2B_MEMORY_USD_PER_GIB_SECOND = 0.0000045
const DAYTONA_CPU_USD_PER_VCPU_SECOND = 0.0504 / 3600
const DAYTONA_MEMORY_USD_PER_GIB_SECOND = 0.0162 / 3600
/**
 * Sim prices the full provisioned disk at the marginal list rate; provider free allowances,
 * credits, and discounts are intentionally not subtracted.
 */
const DAYTONA_DISK_USD_PER_GIB_SECOND = 0.000108 / 3600

export interface SandboxPricing {
  provider: SandboxProviderId
  multiplier: number
  resources: {
    vcpu: number
    memoryGiB: number
    diskGiB: number
  }
  rates: {
    cpuUsdPerVcpuSecond: number
    memoryUsdPerGiBSecond: number
    diskUsdPerGiBSecond: number
  }
}

export interface PricedSandboxUsage {
  durationMs: number
  rawCost: number
  billedCost: number
}

interface ProviderPricing extends Pick<SandboxPricing, 'resources' | 'rates'> {
  /** Kinds whose image is provisioned differently from the Function profile. */
  resourcesByKind?: Partial<Record<SandboxKind, SandboxPricing['resources']>>
}

const PRICING_BY_PROVIDER: Record<SandboxProviderId, ProviderPricing> = {
  e2b: {
    resources: {
      vcpu: FUNCTION_SANDBOX_CPU_COUNT,
      memoryGiB: FUNCTION_SANDBOX_MEMORY_GB,
      diskGiB: 0,
    },
    resourcesByKind: {
      // The Mothership template is built without explicit resources, so E2B runs it on its
      // default 2 vCPU and 1 GiB.
      mothership: { vcpu: 2, memoryGiB: 1, diskGiB: 0 },
      pi: { vcpu: PI_SANDBOX_CPU_COUNT, memoryGiB: PI_SANDBOX_MEMORY_GB, diskGiB: 0 },
    },
    rates: {
      cpuUsdPerVcpuSecond: E2B_CPU_USD_PER_VCPU_SECOND,
      memoryUsdPerGiBSecond: E2B_MEMORY_USD_PER_GIB_SECOND,
      diskUsdPerGiBSecond: 0,
    },
  },
  daytona: {
    resources: {
      vcpu: FUNCTION_SANDBOX_CPU_COUNT,
      memoryGiB: FUNCTION_SANDBOX_MEMORY_GB,
      diskGiB: FUNCTION_DAYTONA_DISK_GB,
    },
    resourcesByKind: {
      pi: {
        vcpu: PI_SANDBOX_CPU_COUNT,
        memoryGiB: PI_SANDBOX_MEMORY_GB,
        diskGiB: PI_DAYTONA_DISK_GB,
      },
    },
    rates: {
      cpuUsdPerVcpuSecond: DAYTONA_CPU_USD_PER_VCPU_SECOND,
      memoryUsdPerGiBSecond: DAYTONA_MEMORY_USD_PER_GIB_SECOND,
      diskUsdPerGiBSecond: DAYTONA_DISK_USD_PER_GIB_SECOND,
    },
  },
}

export function createSandboxPricing(
  provider: SandboxProviderId,
  kind: SandboxKind,
  multiplier = getCostMultiplier()
): SandboxPricing {
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error('Sandbox pricing multiplier must be a finite nonnegative number')
  }
  const pricing = PRICING_BY_PROVIDER[provider]
  const resources = pricing.resourcesByKind?.[kind] ?? pricing.resources
  return {
    provider,
    multiplier,
    resources: { ...resources },
    rates: { ...pricing.rates },
  }
}

export function priceSandboxUsage(
  pricing: SandboxPricing,
  observedDurationMs: number,
  providerLifetimeMs: number
): PricedSandboxUsage {
  const durationMs = Math.max(0, Math.min(observedDurationMs, providerLifetimeMs))
  const seconds = durationMs / 1000
  const rawCost =
    seconds * pricing.resources.vcpu * pricing.rates.cpuUsdPerVcpuSecond +
    seconds * pricing.resources.memoryGiB * pricing.rates.memoryUsdPerGiBSecond +
    seconds * pricing.resources.diskGiB * pricing.rates.diskUsdPerGiBSecond

  return {
    durationMs,
    rawCost,
    billedCost: Number.parseFloat((rawCost * pricing.multiplier).toFixed(8)),
  }
}
