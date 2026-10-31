import { z } from 'zod'

const companySchema = z
  .object({
    id: z.string(),
    name: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    domain: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    website: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    description: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    industry: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    employees: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    revenue: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    founded_year: z
      .number()
      .nullish()
      .transform((value) => value ?? null),
    technologies: z
      .array(z.string())
      .nullish()
      .transform((value) => value ?? []),
  })
  .passthrough()
const pageSchema = z
  .object({
    items: z.array(companySchema),
    page: z.number(),
    totalPages: z.number(),
    totalItems: z.number(),
  })
  .passthrough()
const scoresSchema = z.object({
  metadata: z.object({ scores: z.record(z.string(), z.number()) }).nullish(),
})

export function parseCompany(value: unknown) {
  return companySchema.parse(value)
}
export function parsePage(value: unknown) {
  return pageSchema.parse(value)
}
export function parseScores(value: unknown) {
  return scoresSchema.parse(value).metadata?.scores ?? {}
}
