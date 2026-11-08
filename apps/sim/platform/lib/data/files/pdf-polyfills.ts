/**
 * pdf.js calls `Promise.withResolvers` and `URL.parse` while its module evaluates, so the PDF viewer
 * imports this, for its side effects, before `react-pdf`.
 */
import '@/lib/core/utils/browser-polyfills'
