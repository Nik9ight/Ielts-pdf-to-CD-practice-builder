import fs from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const base = 'F:/IELTS Advantage VIP 2.0-20260926T140740Z-1-001/IELTS Advantage VIP 2.0/Reading/Task Types Practice/';
await fs.mkdir('tests/fixtures', { recursive: true });
for (const name of ['Multiple_Choice', 'Summary_Completion', 'True_False_NG']) {
  const doc = await getDocument({ data: new Uint8Array(await fs.readFile(base + name + '_Questions_Strategy_Practice.pdf')), useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const { items } = await page.getTextContent();
    const rows = [];
    for (const item of items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const y = item.transform[5];
      let row = rows.find(r => Math.abs(r.y-y) < 3);
      if (!row) rows.push(row = { y, items: [] });
      row.items.push({ x: item.transform[4], text: item.str });
    }
    pages.push(rows.sort((a,b)=>b.y-a.y).map(r=>r.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ')).join('\n'));
  }
  await fs.writeFile('tests/fixtures/'+name+'.json', JSON.stringify(pages,null,2));
  console.log('\nDOCUMENT '+name+'\n'+pages.map((p,i)=>'PAGE '+(i+1)+'\n'+p).join('\n\n'));
}
