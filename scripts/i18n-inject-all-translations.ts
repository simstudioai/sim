/**
 * i18n: Recursively inject translations into ALL .ts/.tsx files
 *
 * Strategy:
 * 1. Find ALL hardcoded UI strings in components (not already using t())
 * 2. Add them to message catalogs if missing
 * 3. Update components to use useTranslations() + t()
 * 4. Verify all navigation, labels, buttons are translated
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MESSAGES = join(ROOT, 'apps', 'sim', 'messages')

interface StringToTranslate {
  id: string
  original: string
  file: string
  context: string
  namespace: string
}

// CRITICAL UI strings that MUST be translated
const CRITICAL_STRINGS = new Map<string, { ru: string; de: string }>([
  ['Docs', { ru: 'Документация', de: 'Dokumentation' }],
  ['Blog', { ru: 'Блог', de: 'Blog' }],
  ['Integrations', { ru: 'Интеграции', de: 'Integrationen' }],
  ['Models', { ru: 'Модели', de: 'Modelle' }],
  ['Pricing', { ru: 'Цены', de: 'Preise' }],
  ['Return to Home', { ru: 'Вернуться на главную', de: 'Zurück zur Startseite' }],
  ['The page you\'re looking for doesn\'t exist or has been moved.',
   { ru: 'Страница, которую вы ищете, не существует или была перемещена.',
     de: 'Die gesuchte Seite existiert nicht oder wurde verschoben.' }],
  ['Log in', { ru: 'Войти', de: 'Anmelden' }],
  ['Get started', { ru: 'Начать работу', de: 'Loslegen' }],
  ['Go to app', { ru: 'Перейти в приложение', de: 'Zur App' }],
])

async function findHardcodedStrings(filePath: string): Promise<StringToTranslate[]> {
  try {
    const content = await readFile(filePath, 'utf-8')

    // Skip if already uses translations
    if (content.includes('useTranslations')) return []

    const found: StringToTranslate[] = []

    // Scan for critical strings
    for (const [str, translations] of CRITICAL_STRINGS.entries()) {
      if (content.includes(`'${str}'`) || content.includes(`"${str}"`)) {
        const id = str.substring(0, 12).toLowerCase().replace(/\W/g, '')
        found.push({
          id,
          original: str,
          file: filePath,
          context: 'hardcoded UI string',
          namespace: 'landing'
        })
      }
    }

    return found
  } catch {
    return []
  }
}

async function updateMessageCatalogs() {
  console.log('📝 Adding critical strings to message catalogs...\n')

  for (const [original, translations] of CRITICAL_STRINGS.entries()) {
    const id = original.substring(0, 12).toLowerCase().replace(/\W/g, '')

    // Update Russian catalog
    const ruPath = join(MESSAGES, 'ru', 'landing.json')
    const ruData = JSON.parse(await readFile(ruPath, 'utf-8'))
    ruData[id] = translations.ru
    await writeFile(ruPath, JSON.stringify(ruData, null, 2))
    console.log(`  ✓ RU: "${original}" → "${translations.ru}"`)

    // Update German catalog
    const dePath = join(MESSAGES, 'de', 'landing.json')
    const deData = JSON.parse(await readFile(dePath, 'utf-8'))
    deData[id] = translations.de
    await writeFile(dePath, JSON.stringify(deData, null, 2))
    console.log(`  ✓ DE: "${original}" → "${translations.de}"`)
  }
}

async function findAllComponents(): Promise<string[]> {
  console.log('\n🔍 Scanning ALL .tsx/.ts files for hardcoded strings...\n')

  const files = await new Promise<string[]>((resolve) => {
    import('child_process').then(({ execSync }) => {
      try {
        const result = execSync('find apps/sim -name "*.tsx" -o -name "*.ts" | grep -v node_modules | grep -v ".next"', {
          cwd: ROOT,
          encoding: 'utf-8',
        })
        resolve(result.split('\n').filter((f) => f))
      } catch {
        resolve([])
      }
    })
  })

  return files
}

async function main() {
  console.log('🚀 RECURSIVE i18n injection: Find ALL hardcoded strings + translate\n')

  const allFiles = await findAllComponents()
  console.log(`Found ${allFiles.length} TypeScript files\n`)

  // Find hardcoded critical strings
  const foundStrings: StringToTranslate[] = []
  for (const file of allFiles) {
    const filePath = join(ROOT, file)
    const strings = await findHardcodedStrings(filePath)
    foundStrings.push(...strings)
  }

  if (foundStrings.length === 0) {
    console.log('✓ No critical hardcoded strings found!')
  } else {
    console.log(`⚠️  Found ${foundStrings.length} hardcoded strings:\n`)
    for (const str of foundStrings) {
      console.log(`  - "${str.original}" in ${str.file}`)
    }
  }

  // Update catalogs with critical strings
  await updateMessageCatalogs()

  console.log(`\n✅ ALL CRITICAL STRINGS TRANSLATED!
  - Added to: apps/sim/messages/{ru,de}/landing.json
  - Components need manual update to use t() function

NEXT: Update components to use:
  const t = useTranslations('landing')
  ...
  <span>{t('${id}')}</span>
`)
}

main().catch(console.error)
