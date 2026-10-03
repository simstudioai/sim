import path from 'path'
import { createContentRegistry } from '@/lib/content/registry-factory'
import { CUSTOMER_SECTION } from '@/lib/customers/data'

const CUSTOMERS_DIR = path.join(process.cwd(), 'content', 'customers')
const AUTHORS_DIR = path.join(process.cwd(), 'content', 'authors')

const customersRegistry = createContentRegistry({
  contentDir: CUSTOMERS_DIR,
  authorsDir: AUTHORS_DIR,
  basePath: CUSTOMER_SECTION.basePath,
})

/** Published stories only, suitable for public collections and sitemap entries. */
export const getAllCustomerStoryMeta = customersRegistry.getAllPostMeta

/** Includes draft stories so the design preview can render with noindex metadata. */
export const getCustomerStoryBySlug = customersRegistry.getPostBySlug
export const getCustomerStorySource = customersRegistry.getPostSource
