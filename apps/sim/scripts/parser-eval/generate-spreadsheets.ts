/**
 * Builds Tier A spreadsheet fixtures with SheetJS so the same known cells arrive as
 * xlsx, xls, xlsb, ods and csv. Run from apps/sim: `bun scripts/parser-eval/generate-spreadsheets.ts <corpus-dir>`
 */
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'

const OUT = process.argv[2]
const FILES = path.join(OUT, 'files')
const SPEC = path.join(OUT, 'spec')
mkdirSync(FILES, { recursive: true })
mkdirSync(SPEC, { recursive: true })

let seed = 7
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]

interface SheetSpec { name: string; rows: (string | number)[][] }
interface Book { name: string; sheets: SheetSpec[]; note: string }

const cities = ['Lisbon', 'Austin', 'Kyoto', 'Nairobi', 'Zürich', 'São Paulo', 'Montréal', 'Delhi']
const books: Book[] = [
  {
    name: 'sheet-employees',
    note: 'single sheet, 60 rows, header row, numbers, dates as text, unicode',
    sheets: [{
      name: 'Employees',
      rows: [['Employee ID', 'Full name', 'Department', 'Office', 'Salary', 'Start date'],
        ...Array.from({ length: 60 }, (_, i) => [`E-${2000 + i}`, `${pick(['Ana', 'Bjørn', 'Chen', 'Dmitri', 'Eszter', 'Fatima', 'Gustavo', 'Hana'])} ${pick(['Araújo', 'Nakamura', 'Okafor', 'Svensson', 'Müller', 'Patel'])}`, pick(['Platform', 'Finance', 'Security', 'Support']), pick(cities), 48000 + Math.floor(rand() * 90000), `2024-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`])],
    }],
  },
  {
    name: 'sheet-multi',
    note: 'three sheets including an empty-ish one and a sheet whose header is not on row 1',
    sheets: [
      { name: 'Summary', rows: [['Metric', 'Q1', 'Q2'], ['Active workspaces', 1240, 1398], ['Churned workspaces', 31, 27], ['Net revenue retention', '104%', '109%']] },
      { name: 'Notes', rows: [['Prepared by the Finance team on 4 July.'], [], ['Figures exclude the Northwind pilot.']] },
      { name: 'Raw', rows: [['Export generated 2026-07-04'], [], ['Workspace', 'Plan', 'Seats', 'MRR'], ...Array.from({ length: 25 }, (_, i) => [`ws-${3000 + i}`, pick(['Team', 'Enterprise', 'Pro']), 3 + Math.floor(rand() * 200), Math.round(rand() * 20000) / 100])] },
    ],
  },
  {
    name: 'sheet-wide',
    note: 'wide sheet: 40 columns x 30 rows with commas and quotes inside cells',
    sheets: [{
      name: 'Matrix',
      rows: [['Row'].concat(Array.from({ length: 39 }, (_, c) => `Col ${c + 1}`)),
        ...Array.from({ length: 30 }, (_, r) => [`R${r + 1}`].concat(Array.from({ length: 39 }, (_, c) => (c % 7 === 0 ? `note, with "quotes" ${r}-${c}` : r * 100 + c))))],
    }],
  },
]

/** Typed cells: real dates, percentages, currency and formulas, with the display text a user sees in Excel. */
const typedBook: Book = {
  name: 'sheet-typed',
  note: 'real Date cells, percent/currency number formats, formulas with cached values, booleans',
  sheets: [{ name: 'Ledger', rows: [['Invoice', 'Issued', 'Due', 'Amount', 'Tax rate', 'Paid', 'Total'],
    ['INV-001', '2026-03-04', '2026-04-03', '$1,250.00', '20%', 'TRUE', '$1,500.00'],
    ['INV-002', '2026-05-17', '2026-06-16', '$980.50', '8.5%', 'FALSE', '$1,063.84'],
    ['INV-003', '2026-07-29', '2026-08-28', '$12,000.00', '0%', 'TRUE', '$12,000.00']] }],
}
function buildTypedSheet(): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([['Invoice', 'Issued', 'Due', 'Amount', 'Tax rate', 'Paid', 'Total']])
  const rows = [[1, new Date(Date.UTC(2026, 2, 4)), new Date(Date.UTC(2026, 3, 3)), 1250, 0.2, true], [2, new Date(Date.UTC(2026, 4, 17)), new Date(Date.UTC(2026, 5, 16)), 980.5, 0.085, false], [3, new Date(Date.UTC(2026, 6, 29)), new Date(Date.UTC(2026, 7, 28)), 12000, 0, true]]
  rows.forEach((r, i) => {
    const n = i + 2
    XLSX.utils.sheet_add_aoa(ws, [[`INV-00${r[0]}`]], { origin: `A${n}` })
    ws[`B${n}`] = { t: 'd', v: r[1], z: 'yyyy-mm-dd' }
    ws[`C${n}`] = { t: 'd', v: r[2], z: 'yyyy-mm-dd' }
    ws[`D${n}`] = { t: 'n', v: r[3], z: '"$"#,##0.00' }
    ws[`E${n}`] = { t: 'n', v: r[4], z: '0.#%' }
    ws[`F${n}`] = { t: 'b', v: r[5] }
    ws[`G${n}`] = { t: 'n', f: `D${n}*(1+E${n})`, v: (r[3] as number) * (1 + (r[4] as number)), z: '"$"#,##0.00' }
  })
  ws['!ref'] = 'A1:G4'
  return ws
}
books.push(typedBook)

const manifest: unknown[] = []
for (const book of books) {
  const wb = XLSX.utils.book_new()
  if (book.name === 'sheet-typed') XLSX.utils.book_append_sheet(wb, buildTypedSheet(), 'Ledger')
  else for (const sheet of book.sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name)
  const formats = ['xlsx', 'xls', 'xlsb', 'ods'] as const
  for (const fmt of formats) {
    const target = path.join(FILES, `${book.name}.${fmt}`)
    writeFileSync(target, XLSX.write(wb, { type: 'buffer', bookType: fmt }))
    manifest.push({ file: path.basename(target), doc: book.name, format: fmt, tier: 'A', absence: [] })
  }
  const csvTarget = path.join(FILES, `${book.name}.csv`)
  writeFileSync(csvTarget, XLSX.utils.sheet_to_csv(wb.Sheets[book.sheets[0].name]))
  manifest.push({ file: path.basename(csvTarget), doc: book.name, format: 'csv', tier: 'A', absence: [], firstSheetOnly: true })

  const cells = book.sheets.flatMap((s) => s.rows.flatMap((r) => r.map(String))).filter((c) => c.length >= 2)
  const adjacency = book.sheets.flatMap((s) => s.rows.flatMap((r) => r.slice(0, -1).map((c, i) => [String(c), String(r[i + 1])]).filter(([a, b]) => a.length >= 2 && b.length >= 2 && a !== b)))
  const firstSheetCells = book.sheets[0].rows.flatMap((r) => r.map(String)).filter((c) => c.length >= 2)
  writeFileSync(path.join(SPEC, `${book.name}.json`), JSON.stringify({ name: book.name, kind: 'spreadsheet', note: book.note, sheets: book.sheets.map((s) => s.name), sentinels: cells, firstSheetSentinels: firstSheetCells, table_adjacency: adjacency, order_pairs: [], headings: [], paragraphs: [], list_items: [], code: [] }, null, 1))
  writeFileSync(path.join(SPEC, `${book.name}.gt.txt`), book.sheets.map((s) => s.rows.map((r) => r.join('\t')).join('\n')).join('\n\n'))
}
writeFileSync(path.join(OUT, 'manifest-sheets.json'), JSON.stringify(manifest, null, 1))
console.log(`${books.length} workbooks; ${manifest.length} files`)
