import { z } from 'zod'

const scope = z.object({ workspaceId: z.string().min(1).max(100).optional() })
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe('Test file name: tests/<name>.test.js, lowercase letters, numbers, and dashes.')
const versionSchema = z
  .enum(['draft', 'deployed'])
  .describe(
    'Which version of the workflows to test: draft while editing, deployed before shipping.'
  )

/** Create, describe, and run the workspace's workflow tests. Cases live in `tests/<name>.test.js`. */
export const mothershipTestsInputSchema = z.discriminatedUnion('action', [
  scope
    .extend({
      action: z.literal('create'),
      name: nameSchema,
      title: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('The concern this file tests, in one line.'),
      description: z.string().max(2000).optional(),
    })
    .strict(),
  scope
    .extend({
      action: z.literal('update'),
      name: nameSchema,
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
    })
    .strict(),
  scope.extend({ action: z.literal('list'), version: versionSchema }).strict(),
  scope.extend({ action: z.literal('get'), name: nameSchema, version: versionSchema }).strict(),
  scope
    .extend({
      action: z.literal('run'),
      version: versionSchema,
      names: z
        .array(nameSchema)
        .min(1)
        .max(100)
        .optional()
        .describe('Omit to run every test file.'),
      only: z
        .array(z.string().min(1).max(500))
        .min(1)
        .max(100)
        .optional()
        .describe('With exactly one name: the "describe > it" test names to run in it.'),
    })
    .strict(),
  scope.extend({ action: z.literal('delete'), name: nameSchema }).strict(),
])
