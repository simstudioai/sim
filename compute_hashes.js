const crypto = require('crypto')
const fs = require('fs')

// Read migration files and compute hashes
const migrations = [
  { idx: 42, file: '0042_breezy_miracleman.sql', when: 1749784177503 },
  { idx: 43, file: '0043_silent_the_anarchist.sql', when: 1750193663357 },
  { idx: 44, file: '0044_fresh_amazoness.sql', when: 1750275675152 },
]

migrations.forEach((migration) => {
  const content = fs.readFileSync(`./db/migrations/${migration.file}`, 'utf8')
  const hash = crypto.createHash('sha256').update(content).digest('hex')
  console.log(`Migration ${migration.idx}: ${hash}`)
  console.log(`  File: ${migration.file}`)
  console.log(`  Timestamp: ${migration.when}`)
  console.log('')
})
