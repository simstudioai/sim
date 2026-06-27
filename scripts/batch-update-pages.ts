/**
 * BATCH UPDATE PAGES: Add i18n to all landing pages
 *
 * Updates:
 * 1. Contact page ✅ (already done)
 * 2. Privacy page
 * 3. Terms page
 * 4. Models page
 * 5. Add all translations to catalogs
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

async function updateCatalogs() {
  const messagesPath = join(process.cwd(), 'apps/sim/messages')

  const ruCatalog = JSON.parse(await readFile(join(messagesPath, 'ru/components.json'), 'utf-8'))
  const deCatalog = JSON.parse(await readFile(join(messagesPath, 'de/components.json'), 'utf-8'))

  // All page translations needed
  const translations = {
    privacy: {
      ru: 'Политика конфиденциальности',
      de: 'Datenschutzrichtlinie'
    },
    privacydesc: {
      ru: 'Узнайте, как Sim собирает, использует и защищает ваши личные данные',
      de: 'Erfahren Sie, wie Sim Ihre persönlichen Daten erfasst, nutzt und schützt'
    },
    terms: {
      ru: 'Условия обслуживания',
      de: 'Servicebestimmungen'
    },
    termsdesc: {
      ru: 'Прочитайте наши условия обслуживания перед использованием Sim',
      de: 'Lesen Sie unsere Servicebestimmungen vor der Nutzung von Sim'
    },
    models: {
      ru: 'Каталог моделей ИИ',
      de: 'AI-Modellverzeichnis'
    },
    modelsdesc: {
      ru: 'Изучите все доступные модели ИИ и их возможности',
      de: 'Erkunden Sie alle verfügbaren AI-Modelle und ihre Funktionen'
    }
  }

  // Add to catalogs
  Object.entries(translations).forEach(([key, { ru, de }]) => {
    ruCatalog[key] = ru
    deCatalog[key] = de
  })

  // Save
  await writeFile(join(messagesPath, 'ru/components.json'), JSON.stringify(ruCatalog, null, 2))
  await writeFile(join(messagesPath, 'de/components.json'), JSON.stringify(deCatalog, null, 2))

  console.log('✅ Updated catalogs with 6 new page translations')
  console.log('   Keys added: privacy, privacydesc, terms, termsdesc, models, modelsdesc')

  return Object.keys(translations).length
}

async function main() {
  console.log('📝 === BATCH UPDATE PAGES ===\n')
  const count = await updateCatalogs()
  console.log(`\n✅ COMPLETE: ${count} translations added`)
  console.log('\n📋 NEXT STEP: Update page components to use t()')
  console.log('   1. Privacy page layout')
  console.log('   2. Terms page layout')
  console.log('   3. Models page')
  console.log('   4. Test all pages work with translations')
}

main().catch(console.error)
