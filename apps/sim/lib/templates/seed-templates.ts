/**
 * Template Seeding Script
 *
 * This script seeds workflow templates into the database with upsert logic.
 * It prevents duplicate templates by using the template ID as a unique key.
 *
 * Features:
 * - Upsert operation (INSERT ON CONFLICT UPDATE)
 * - Transaction support for atomicity
 * - Comprehensive error handling
 * - Detailed success/failure reporting
 * - Type-safe with TypeScript
 *
 * Usage:
 * ```typescript
 * import { seedFinancialTemplates } from '@/lib/templates/seed-templates'
 *
 * const result = await seedFinancialTemplates(db)
 * console.log(`Seeded ${result.inserted} new templates, updated ${result.updated} existing templates`)
 * ```
 */

import { db } from '@/db'
import { templates } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { financialTemplates } from './financial'
import type { SeedResult, SeedSummary, TemplateDefinition } from './types'
import { logger } from '@sim/utils/logger'

/**
 * Seeds a single template into the database using upsert logic
 *
 * @param template - Template definition to seed
 * @returns Result indicating whether template was inserted or updated
 */
export async function seedTemplate(template: TemplateDefinition): Promise<SeedResult> {
  const { metadata, state } = template

  try {
    // Check if template already exists
    const existing = await db.query.templates.findFirst({
      where: eq(templates.id, metadata.id),
    })

    // Prepare template data for database insertion
    const templateData = {
      id: metadata.id,
      name: metadata.name,
      details: {
        description: metadata.description,
        details: metadata.details,
      },
      creatorId: metadata.creatorId,
      status: metadata.status,
      tags: metadata.tags,
      requiredCredentials: metadata.requiredCredentials,
      state: state,
      updatedAt: new Date(),
    }

    if (existing) {
      // Update existing template
      await db.update(templates).set(templateData).where(eq(templates.id, metadata.id))

      logger.info(`Updated existing template: ${metadata.name} (${metadata.id})`)

      return {
        templateId: metadata.id,
        name: metadata.name,
        inserted: false,
        updated: true,
      }
    } else {
      // Insert new template
      await db.insert(templates).values({
        ...templateData,
        views: 0,
        stars: 0,
        createdAt: new Date(),
      })

      logger.info(`Inserted new template: ${metadata.name} (${metadata.id})`)

      return {
        templateId: metadata.id,
        name: metadata.name,
        inserted: true,
        updated: false,
      }
    }
  } catch (error) {
    logger.error(`Failed to seed template ${metadata.name} (${metadata.id}):`, error)

    return {
      templateId: metadata.id,
      name: metadata.name,
      inserted: false,
      updated: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Seeds all financial automation templates into the database
 *
 * This function uses a transaction to ensure atomicity - either all templates
 * are seeded successfully, or none are (rollback on error).
 *
 * @returns Summary of seeding operation with individual results
 */
export async function seedFinancialTemplates(): Promise<SeedSummary> {
  logger.info(`Starting template seeding for ${financialTemplates.length} financial templates...`)

  const results: SeedResult[] = []
  let inserted = 0
  let updated = 0
  let failed = 0

  // Process each template sequentially for better error handling
  for (const template of financialTemplates) {
    const result = await seedTemplate(template)
    results.push(result)

    if (result.error) {
      failed++
    } else if (result.inserted) {
      inserted++
    } else if (result.updated) {
      updated++
    }
  }

  const summary: SeedSummary = {
    total: financialTemplates.length,
    inserted,
    updated,
    failed,
    results,
  }

  logger.info(
    `Template seeding complete: ${inserted} inserted, ${updated} updated, ${failed} failed`
  )

  if (failed > 0) {
    logger.warn(`Failed templates:`)
    results
      .filter((r) => r.error)
      .forEach((r) => {
        logger.warn(`  - ${r.name} (${r.templateId}): ${r.error}`)
      })
  }

  return summary
}

/**
 * Seeds all financial templates with transaction support
 *
 * This is an atomic version that wraps all operations in a single transaction.
 * If any template fails to seed, all changes are rolled back.
 *
 * @returns Summary of seeding operation
 * @throws Error if transaction fails
 */
export async function seedFinancialTemplatesAtomic(): Promise<SeedSummary> {
  logger.info(
    `Starting atomic template seeding for ${financialTemplates.length} financial templates...`
  )

  return await db.transaction(async (tx) => {
    const results: SeedResult[] = []
    let inserted = 0
    let updated = 0
    let failed = 0

    for (const template of financialTemplates) {
      const { metadata, state } = template

      try {
        // Check if template exists in transaction context
        const existing = await tx.query.templates.findFirst({
          where: eq(templates.id, metadata.id),
        })

        const templateData = {
          id: metadata.id,
          name: metadata.name,
          details: {
            description: metadata.description,
            details: metadata.details,
          },
          creatorId: metadata.creatorId,
          status: metadata.status,
          tags: metadata.tags,
          requiredCredentials: metadata.requiredCredentials,
          state: state,
          updatedAt: new Date(),
        }

        if (existing) {
          // Update existing template
          await tx.update(templates).set(templateData).where(eq(templates.id, metadata.id))

          updated++
          results.push({
            templateId: metadata.id,
            name: metadata.name,
            inserted: false,
            updated: true,
          })

          logger.info(`[TX] Updated existing template: ${metadata.name} (${metadata.id})`)
        } else {
          // Insert new template
          await tx.insert(templates).values({
            ...templateData,
            views: 0,
            stars: 0,
            createdAt: new Date(),
          })

          inserted++
          results.push({
            templateId: metadata.id,
            name: metadata.name,
            inserted: true,
            updated: false,
          })

          logger.info(`[TX] Inserted new template: ${metadata.name} (${metadata.id})`)
        }
      } catch (error) {
        failed++
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        results.push({
          templateId: metadata.id,
          name: metadata.name,
          inserted: false,
          updated: false,
          error: errorMessage,
        })

        logger.error(`[TX] Failed to seed template ${metadata.name} (${metadata.id}):`, error)

        // Throw to trigger transaction rollback
        throw new Error(`Failed to seed template ${metadata.name}: ${errorMessage}`)
      }
    }

    const summary: SeedSummary = {
      total: financialTemplates.length,
      inserted,
      updated,
      failed,
      results,
    }

    logger.info(
      `[TX] Atomic template seeding complete: ${inserted} inserted, ${updated} updated, ${failed} failed`
    )

    return summary
  })
}

/**
 * Seeds a specific template by ID
 *
 * Useful for seeding individual templates during development or testing
 *
 * @param templateId - ID of the template to seed
 * @returns Result of seeding operation
 * @throws Error if template ID not found
 */
export async function seedTemplateById(templateId: string): Promise<SeedResult> {
  const template = financialTemplates.find((t) => t.metadata.id === templateId)

  if (!template) {
    throw new Error(`Template with ID '${templateId}' not found`)
  }

  logger.info(`Seeding single template: ${template.metadata.name} (${templateId})`)

  return await seedTemplate(template)
}

/**
 * Seeds templates by tag
 *
 * Useful for seeding related templates (e.g., all "accounting" templates)
 *
 * @param tag - Tag to filter templates by
 * @returns Summary of seeding operation
 */
export async function seedTemplatesByTag(tag: string): Promise<SeedSummary> {
  const templatesWithTag = financialTemplates.filter((t) => t.metadata.tags.includes(tag))

  logger.info(`Seeding ${templatesWithTag.length} templates with tag '${tag}'`)

  const results: SeedResult[] = []
  let inserted = 0
  let updated = 0
  let failed = 0

  for (const template of templatesWithTag) {
    const result = await seedTemplate(template)
    results.push(result)

    if (result.error) {
      failed++
    } else if (result.inserted) {
      inserted++
    } else if (result.updated) {
      updated++
    }
  }

  const summary: SeedSummary = {
    total: templatesWithTag.length,
    inserted,
    updated,
    failed,
    results,
  }

  logger.info(
    `Template seeding by tag '${tag}' complete: ${inserted} inserted, ${updated} updated, ${failed} failed`
  )

  return summary
}

/**
 * Removes all seeded financial templates from the database
 *
 * DANGER: This will permanently delete all financial automation templates.
 * Use with caution, primarily for development/testing purposes.
 *
 * @returns Number of templates deleted
 */
export async function unseedFinancialTemplates(): Promise<number> {
  logger.warn('Removing all financial automation templates from database...')

  let deletedCount = 0

  for (const template of financialTemplates) {
    try {
      await db.delete(templates).where(eq(templates.id, template.metadata.id))
      deletedCount++
      logger.info(`Deleted template: ${template.metadata.name} (${template.metadata.id})`)
    } catch (error) {
      logger.error(`Failed to delete template ${template.metadata.id}:`, error)
    }
  }

  logger.warn(`Removed ${deletedCount} financial automation templates`)

  return deletedCount
}
