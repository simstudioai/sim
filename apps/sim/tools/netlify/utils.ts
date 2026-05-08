import type { NetlifyEnvVar } from '@/tools/netlify/types'

export interface NetlifyApiEnvValue {
  id?: string
  context?: string
  context_parameter?: string
  value?: string
}

export interface NetlifyApiEnvVar {
  key?: string
  scopes?: string[]
  values?: NetlifyApiEnvValue[]
  is_secret?: boolean
  updated_at?: string
}

export function normalizeEnvVar(v: NetlifyApiEnvVar): NetlifyEnvVar {
  return {
    key: v.key ?? '',
    scopes: v.scopes ?? [],
    values: (v.values ?? []).map((val) => ({
      id: val.id ?? null,
      context: val.context ?? null,
      contextParameter: val.context_parameter ?? null,
      value: val.value ?? '',
    })),
    isSecret: v.is_secret ?? false,
    updatedAt: v.updated_at ?? null,
  }
}

export function buildEnvBody(params: {
  key: string
  value: string
  context?: string
  scopes?: string
  isSecret?: string
}): {
  key: string
  scopes: string[]
  values: Array<{ context: string; value: string }>
  is_secret: boolean
} {
  const scopes = params.scopes
    ? params.scopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ['builds', 'functions', 'runtime', 'post_processing']
  const context = params.context?.trim() ? params.context.trim() : 'all'

  return {
    key: params.key.trim(),
    scopes,
    values: [{ context, value: params.value }],
    is_secret: params.isSecret === 'true',
  }
}
