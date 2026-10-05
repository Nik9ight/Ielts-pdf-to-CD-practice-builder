// Turns the text of a practice PDF into a passage, question groups and an answer key.
// Pure functions only (no DOM), so the same code runs in the browser and in Node tests.

export const COLUMN = '   '; // marks a wide horizontal gap between two text items (table columns)
const COLUMN_SPLIT = /\s{3,}|\t/;
const GAP = /(?:…|\.{3,}|_{3,})[…._]*/g;
const hasGap = text => text.search(GAP) >= 0;
const ROMAN = ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii','xiii','xiv','xv','xvi','xvii','xviii','xix','xx'];

// ---------- Stage 1: positioned PDF text -> lines and paragraphs ----------

/**
 * pages: [[{ str, x, y, width, height }]] — one array of text items per page (PDF coordinates, y grows upwards).
 * Returns { docTitle, passageTitle, text } where text has one line per PDF line and blank lines between blocks.
 */
export function layoutToText(pages) {
  const pageLines = pages.map((items, page) => buildLines(items).map(line => ({ ...line, page })));

  // Running headers / footers: identical lines that repeat on most pages.
  const counts = new Map();
  for (const lines of pageLines) for (const key of new Set(lines.map(l => runningKey(l.text)))) counts.set(key, (counts.get(key) || 0) + 1);
  const minRepeats = Math.max(2, Math.ceil(pages.length * 0.6));
  const isRunning = line => pages.length > 1 && counts.get(runningKey(line.text)) >= minRepeats;
  const running = pageLines.flat().filter(isRunning);
  const docTitle = running.length ? [...running].sort((a, b) => b.height - a.height || b.y - a.y)[0].text : '';
  const kept = pageLines.map(lines => lines.filter(l => !isRunning(l)));

  const all = kept.flat();
  const bodyHeight = mode(all.map(l => Math.round(l.height)));
  const gaps = [];
  for (const lines of kept) for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0 && Math.round(lines[i].height) === bodyHeight) gaps.push(gap);
  }
  const lineGap = median(gaps) || bodyHeight * 1.4;

  let passageTitle = '';
  const out = [];
  let prev = null;
  for (const line of all) {
    const big = Math.round(line.height) > bodyHeight + 1;
    if (!passageTitle && big && !/^questions?\s+\d/i.test(line.text) && out.length < 3) {
      passageTitle = line.text;
      prev = null;
      out.push('');
      continue;
    }
    if (prev) {
      let breakBefore;
      if (prev.page !== line.page) breakBefore = /[.!?:"”’)]$/.test(prev.text) && /^[A-Z0-9“"‘(]/.test(line.text);
      else breakBefore = prev.y - line.y > lineGap * 1.3;
      if (breakBefore || big || Math.round(prev.height) > bodyHeight + 1) out.push('');
    }
    out.push(line.text);
    prev = line;
  }
  return { docTitle, passageTitle, text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

function buildLines(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    let row = rows.find(r => Math.abs(r.y - item.y) < Math.max(2, item.height * 0.3));
    if (!row) rows.push(row = { y: item.y, height: 0, items: [] });
    row.items.push(item);
    row.height = Math.max(row.height, item.height);
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(row => {
    row.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const item of row.items) {
      const gap = end === null ? 0 : item.x - end;
      if (end !== null) {
        if (gap > Math.max(24, item.height * 2)) text = text.trimEnd() + COLUMN;
        else if (gap > item.height * 0.12 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
      }
      text += item.str;
      end = item.x + (item.width || item.str.length * item.height * 0.5);
    }
    return { y: row.y, height: row.height, x: row.items[0].x, text: text.replace(/\u00a0/g, ' ').trim() };
  });
}

const runningKey = text => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const median = values => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
function mode(values) {
  const counts = new Map();
  let best = values[0] || 12;
  for (const v of values) { counts.set(v, (counts.get(v) || 0) + 1); if (counts.get(v) > (counts.get(best) || 0)) best = v; }
  return best;
}

// ---------- Stage 2: text -> sections ----------

/** Splits the full text into passage / questions / answer-key text. */
export function splitSections(text) {
  const lines = text.split('\n');
  let questionsAt = lines.findIndex(l => /^questions?\s+\d+/i.test(l.trim()));
  let keyAt = lines.findIndex((l, i) => i > Math.max(questionsAt, 0) && /^(answer\s*key|answers|key to answers|suggested answers)\b[^a-z]*$/i.test(l.trim()));
  if (questionsAt < 0) questionsAt = keyAt >= 0 ? keyAt : lines.length;
  if (keyAt < 0) keyAt = lines.length;

  let passageLines = lines.slice(0, questionsAt);
  let source = '';
  const sourceAt = passageLines.findIndex(l => /^source\s*:/i.test(l.trim()));
  if (sourceAt >= 0) {
    // A source citation runs until the next blank line.
    let end = sourceAt;
    while (end < passageLines.length && passageLines[end].trim()) end++;
    for (const line of passageLines.slice(sourceAt, end).map(l => l.trim())) {
      // URLs wrapped over two lines are re-joined without a space.
      source += /https?:\/\/\S*$/.test(source) && !/\s/.test(line) ? line : (source ? ' ' : '') + line;
    }
    source = source.replace(/^source\s*:\s*/i, '');
    passageLines = [...passageLines.slice(0, sourceAt), ...passageLines.slice(end)];
  }
  return {
    passage: passageLines.join('\n').trim(),
    questions: lines.slice(questionsAt, keyAt).join('\n').trim(),
    key: lines.slice(keyAt).join('\n').trim(),
    source,
  };
}

/** Passage text (blank line between paragraphs) -> array of paragraph strings. */
export function parsePassage(text) {
  return text.split(/\n\s*\n/).map(block => joinWrapped(block.split('\n'))).filter(Boolean);
}

function joinWrapped(lines) {
  let out = '';
  for (const raw of lines) {
    const line = raw.replace(/\s{3,}/g, ' ').trim();
    if (!line) continue;
    if (!out) out = line;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) out += line; // re-join a word hyphenated across lines
    else out += ' ' + line;
  }
  return out;
}

// ---------- Stage 3: questions text -> groups ----------

const GROUP_HEADING = /^questions?\s+(\d+)(?:\s*(?:-|–|—|to|and)\s*(\d+))?\b[.:]?\s*(.*)$/i;
const DEFINITION = /^(TRUE|FALSE|YES|NO|NOT GIVEN)\s+(.*)$/i;

export function parseQuestions(text) {
  const groups = [];
  let group = null;
  let blank = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { blank = true; continue; }
    const heading = line.match(GROUP_HEADING);
    if (heading && (!group || group.lines.length)) {
      const from = +heading[1];
      const to = heading[2] ? +heading[2] : from;
      group = { from, to: Math.max(from, to), lines: [] };
      groups.push(group);
      if (heading[3]) group.lines.push({ text: heading[3], blank: false });
    } else {
      if (!group) groups.push(group = { from: 1, to: 1, lines: [], implicit: true });
      group.lines.push({ text: line, blank });
    }
    blank = false;
  }
  return groups.map(buildGroup);
}

function buildGroup({ from, to, lines, implicit }) {
  const intro = [];
  const items = [];
  const options = [];
  let item = null;
  let target = null; // the option list that the most recent option line went into
  let summary = null;

  const instructionText = lines.map(l => l.text).join(' ');
  const isSummary = /complete the (summary|notes|table|flow[- ]?chart|paragraph|text)/i.test(instructionText) && lines.some(l => hasGap(l.text));

  if (isSummary) {
    // Summary-style: one block of text with numbered gaps; any lettered word box becomes the options.
    let start = lines.findIndex(l => hasGap(l.text));
    while (start > 0 && !lines[start].blank && !isInstructionLine(lines[start - 1].text)) start--;
    // A short line right before the text (no full stop) is the summary title.
    const titleAt = start > 0 && lines[start].blank && isTitleLine(lines[start - 1].text) && !isInstructionLine(lines[start - 1].text) ? start - 1 : -1;
    const title = titleAt >= 0 ? lines[titleAt].text : '';
    const bodyLines = [];
    lines.forEach((line, i) => {
      const cells = optionCells(line.text, options);
      if (cells) { options.push(...cells); return; }
      if (i === titleAt) return;
      if (i < start) intro.push(line);
      else bodyLines.push(line);
    });
    summary = { title, text: joinBody(bodyLines) };
  } else {
    for (const line of lines) {
      const q = line.text.match(/^(\d{1,3})\s*[.)]?\s+(.*)$/) || line.text.match(/^(\d{1,3})\s*[.)]\s*(.*)$/);
      const n = q ? +q[1] : NaN;
      if (q && n >= from && n <= to && (!item || n > item.n)) {
        item = { n, lines: [q[2]], options: [] };
        items.push(item);
        target = null;
        continue;
      }
      const cells = optionCells(line.text, target || (item && !options.length ? item.options : options), !!item);
      if (cells) {
        // An option box after a question belongs to that question unless a shared box is already open.
        if (!target) target = item && !options.length ? item.options : options;
        target.push(...cells);
        continue;
      }
      if (target && target.length) target[target.length - 1].text += ' ' + line.text.replace(/\s{3,}/g, ' ');
      else if (item) item.lines.push(line.text);
      else intro.push(line);
    }
  }

  // A single "option" is just a wrapped stem line that happened to start with "A ".
  for (const it of items) if (it.options.length === 1) { it.lines.push(it.options[0].key + ' ' + it.options[0].text); it.options = []; }
  // A box after the last question with no options elsewhere is a shared list (matching tasks).
  const withOptions = items.filter(it => it.options.length);
  if (!options.length && items.length > 1 && withOptions.length === 1 && withOptions[0] === items[items.length - 1] && withOptions[0].options.length >= 3) {
    options.push(...withOptions[0].options);
    withOptions[0].options = [];
  }

  const instructions = paragraphsOf(intro, /not given/i.test(instructionText));
  const instr = instructions.map(p => (p.term ? p.term + ' ' : '') + p.text).join(' ');
  let kind;
  if (summary) kind = 'summary';
  else if (/not given/i.test(instr) && /\bfalse\b/i.test(instr)) kind = 'tfng';
  else if (/not given/i.test(instr)) kind = 'ynng';
  else if (items.some(it => it.options.length)) kind = 'choice';
  else if (!items.length && options.length) kind = 'multi';
  else if (options.length) kind = 'matching';
  else if (items.some(it => hasGap(it.lines.join(' ')))) kind = 'gap';
  else kind = 'short';

  if (implicit && items.length) { from = items[0].n; to = items[items.length - 1].n; }
  return {
    from, to, kind,
    instructions,
    items: items.map(it => ({ n: it.n, text: joinWrapped(it.lines), options: it.options })),
    options,
    summary,
  };
}

function isInstructionLine(text) {
  return /(each answer|from the (text|passage|box|list)|below|answer sheet|write (the correct|your)|choose|complete the|NB\b)/i.test(text);
}
const isTitleLine = text => text.split(/\s+/).length <= 10 && !/[.?!:]$/.test(text);

function joinBody(lines) {
  // Keep bullet / note lines on their own line; re-flow everything else.
  const out = [];
  for (const line of lines) {
    const text = line.text.replace(/\s{3,}/g, ' ');
    if (!out.length || line.blank || /^[•●▪◦\-–—*]\s*/.test(text)) out.push(text);
    else out[out.length - 1] = joinWrapped([out[out.length - 1], text]);
  }
  return out.join('\n');
}

/** Returns option cells if the line is a lettered (A, B…) or roman-numbered (i, ii…) option line. */
function optionCells(text, list, loose = false) {
  const cells = text.split(COLUMN_SPLIT).map(c => c.trim()).filter(Boolean);
  const expected = nextKey(list);
  const out = [];
  for (const cell of cells) {
    const m = cell.match(/^([A-Z]|[ivx]{1,5})\s*[.)]\s*(.+)$/) || (cells.length > 1 || loose ? cell.match(/^([A-Z]|[ivx]{1,5})\s+(.+)$/) : null);
    const want = out.length ? nextKey(out, expected) : expected;
    if (!m || !want.includes(m[1])) return null;
    out.push({ key: m[1], text: m[2].trim() });
  }
  return out.length ? out : null;
}

function nextKey(list, fallback) {
  if (!list || !list.length) return fallback || ['A', 'i'];
  const last = list[list.length - 1].key;
  if (/^[A-Z]$/.test(last)) return [String.fromCharCode(last.charCodeAt(0) + 1)];
  const idx = ROMAN.indexOf(last);
  return idx >= 0 && idx < ROMAN.length - 1 ? [ROMAN[idx + 1]] : [];
}

function paragraphsOf(lines, withDefinitions) {
  const out = [];
  for (const { text: raw, blank } of lines) {
    const text = raw.replace(/\s{3,}/g, ' ');
    const def = withDefinitions && text.match(DEFINITION);
    if (def) { out.push({ type: 'definition', term: def[1].toUpperCase(), text: def[2] }); continue; }
    const last = out[out.length - 1];
    if (!last || last.type !== 'text' || blank || /[.?!:]$/.test(last.text) || /^NB\b/.test(text)) out.push({ type: 'text', text });
    else last.text = joinWrapped([last.text, text]);
  }
  return out;
}

/** Splits text around answer gaps: returns [{ text } | { gap: true, n }]. Gap numbers come from "(3) ……" or run in sequence. */
export function splitGaps(text, numbers) {
  const parts = [];
  let last = 0;
  let next = 0;
  const used = new Set();
  for (const match of text.matchAll(GAP)) {
    let before = text.slice(last, match.index);
    let n;
    const label = before.match(/\(?\b(\d{1,3})\)?\s*[.)]?\s*$/);
    if (label && numbers.includes(+label[1]) && !used.has(+label[1])) { n = +label[1]; before = before.slice(0, label.index); }
    else { while (next < numbers.length && used.has(numbers[next])) next++; n = numbers[next]; }
    if (n === undefined) { parts.push({ text: text.slice(last, match.index + match[0].length) }); last = match.index + match[0].length; continue; }
    used.add(n);
    if (before) parts.push({ text: before });
    parts.push({ gap: true, n });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// ---------- Stage 4: answer key ----------

export function parseKey(text) {
  const answers = {};
  const notes = [];
  let last = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || /^(answer\s*key|answers|key to answers|suggested answers)\b[^a-z]*$/i.test(line)) continue;
    const cells = line.split(COLUMN_SPLIT).map(c => c.trim()).filter(Boolean);
    let used = false;
    for (const cell of cells) {
      const loose = cell.match(/^(\d{1,3})\s+(\S.*)$/);
      const m = cell.match(/^(\d{1,3})\s*[.):]\s*(.*)$/) || (loose && (cells.length > 1 || +loose[1] === (last ? last.n + 1 : 1)) ? loose : null);
      if (m && +m[1] >= 1 && +m[1] <= 200 && !(m[1] in answers) && (!last || +m[1] > last.n || cells.length > 1)) {
        let answer = m[2].trim();
        let note = '';
        const split = answer.match(/^(.*?)\s+((?:extra info|explanation|para(?:graph)?\s*\d|line\s*\d|see\b).*)$/i);
        if (split) { answer = split[1]; note = split[2]; }
        last = answers[m[1]] = { n: +m[1], answer, note };
        used = true;
      } else if (last && used) {
        last.note = (last.note ? last.note + ' ' : '') + cell;
      } else if (last && cells.length === 1 && !/^https?:/i.test(cell)) {
        last.note = (last.note ? last.note + ' ' : '') + cell;
        used = true;
      } else {
        notes.push(cell);
      }
    }
  }
  const links = [];
  for (const note of notes) {
    const url = note.match(/https?:\/\/\S+/);
    if (url) links.push({ url: url[0], label: (notes[notes.indexOf(note) - 1] || '').replace(/:$/, '') || 'Link' });
  }
  return { answers, notes: notes.filter(n => !/https?:\/\//.test(n) && !links.some(l => l.label === n.replace(/:$/, ''))), links };
}

/** Paragraph number referenced by an answer-key note such as "Extra info- para 3". */
export const paragraphRef = note => { const m = (note || '').match(/\bpara(?:graph)?\.?\s*(\d+)/i); return m ? +m[1] : null; };

// ---------- Everything together ----------

export function buildDocument({ docTitle = '', passageTitle = '', passage = '', questions = '', key = '', source = '' }) {
  const groups = parseQuestions(questions);
  const parsedKey = parseKey(key);
  const warnings = [];
  for (const g of groups) {
    const expected = g.to - g.from + 1;
    if (g.kind === 'summary') {
      const gaps = splitGaps(g.summary.text, range(g.from, g.to)).filter(p => p.gap).length;
      if (gaps !== expected) warnings.push(`Questions ${g.from}–${g.to}: found ${gaps} answer gaps in the text, expected ${expected}.`);
    } else if (g.kind !== 'multi' && g.items.length !== expected) {
      warnings.push(`Questions ${g.from}–${g.to}: found ${g.items.length} of ${expected} questions.`);
    }
  }
  if (!groups.length) warnings.push('No questions were found. Paste them into the questions box, starting with a line like “Questions 1-10”.');
  const numbers = groups.flatMap(g => range(g.from, g.to));
  const keyCount = numbers.filter(n => parsedKey.answers[n]).length;
  if (!key.trim()) warnings.push('No answer key was found. You can paste one into the answer key box.');
  else if (keyCount < numbers.length) warnings.push(`The answer key covers ${keyCount} of ${numbers.length} questions.`);
  return {
    docTitle: docTitle.trim(),
    passageTitle: passageTitle.trim(),
    paragraphs: parsePassage(passage),
    source,
    groups,
    key: parsedKey,
    numbers,
    warnings,
    raw: { passageTitle, passage, questions, key, source, docTitle },
  };
}

export function documentFromPages(pages) {
  const { docTitle, passageTitle, text } = layoutToText(pages);
  return buildDocument({ docTitle, passageTitle, ...splitSections(text) });
}

export const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** A short human name for a group's task type. */
export function taskName(group, docTitle = '') {
  const fromTitle = docTitle.replace(/\s*questions?\s*strategy\s*practice\s*$/i, '').replace(/\s*practice\s*$/i, '').trim();
  const instr = group.instructions.map(p => p.text).join(' ');
  if (group.kind === 'tfng') return 'True / False / Not Given';
  if (group.kind === 'ynng') return 'Yes / No / Not Given';
  if (/heading/i.test(instr)) return 'Matching headings';
  if (/ending/i.test(instr)) return 'Matching sentence endings';
  if (group.kind === 'matching') return /paragraph|section/i.test(instr) ? 'Matching information' : 'Matching';
  if (group.kind === 'choice' || group.kind === 'multi') return 'Multiple choice';
  if (group.kind === 'summary') { const m = instr.match(/complete the (summary|notes|table|flow[- ]?chart)/i); return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + ' completion' : 'Completion'; }
  if (/sentence/i.test(instr)) return 'Sentence completion';
  return fromTitle || (group.kind === 'gap' ? 'Completion' : 'Short answer');
}

/** Converts a pdf.js getTextContent() result into the plain items layoutToText expects. */
export const itemsFromTextContent = content => content.items
  .filter(item => 'str' in item)
  .map(item => ({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height || Math.abs(item.transform[3]) }));
