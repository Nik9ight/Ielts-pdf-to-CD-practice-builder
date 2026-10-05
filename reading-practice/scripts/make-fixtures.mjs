// Saves the positioned text of practice PDFs as test fixtures.
// Usage: node scripts/make-fixtures.mjs path/to/A.pdf path/to/B.pdf
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { itemsFromTextContent } from '../dist/parser.mjs';

await fs.mkdir(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
for (const file of process.argv.slice(2)) {
  const doc = await getDocument({ data: new Uint8Array(await fs.readFile(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push(itemsFromTextContent(await (await doc.getPage(i)).getTextContent()));
  const name = path.basename(file, '.pdf').replace(/_Questions_Strategy_Practice$/, '');
  await fs.writeFile(new URL(`../tests/fixtures/${name}.json`, import.meta.url), JSON.stringify(pages));
  console.log(`tests/fixtures/${name}.json  (${doc.numPages} pages)`);
}
