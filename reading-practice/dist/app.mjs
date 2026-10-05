import * as pdfjs from '/vendor/build/pdf.min.mjs';
import { documentFromPages, buildDocument, itemsFromTextContent, splitGaps, paragraphRef, taskName, range } from './parser.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/build/pdf.worker.min.mjs';

const $ = id => document.getElementById(id);
const SESSION_KEY = 'reading-practice:session';
const PREFS_KEY = 'reading-practice:prefs';
const HISTORY_KEY = 'reading-practice:history';

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: carry on without saving */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

/** Builds an element: el('p', { class: 'x', onclick: fn }, 'text', child) */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

/** Text with runs of capitals (e.g. NO MORE THAN TWO WORDS, A-O, NB) in bold, as in the real instructions. */
function rich(text) {
  const frag = document.createDocumentFragment();
  const re = /\b(?:[A-Z]{2,}[A-Z/’'-]*|[A-Z][-–][A-Z])(?:\s+(?:[A-Z]+[A-Z/’'-]*|[A-Z][-–][A-Z]))*\b/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    frag.append(text.slice(last, m.index), el('strong', {}, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

const clock = seconds => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
};
const prettyName = name => name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+Questions Strategy Practice$/i, '').trim();

// ---------------------------------------------------------------- state

let draft = null;   // { doc, name, id } while on the check screen
let session = null; // the running or reviewed test
let ticker = null;
let lastTick = 0;
let saveTimer = null;

// ---------------------------------------------------------------- library

async function loadLibrary() {
  const box = $('library');
  box.replaceChildren(el('p', { class: 'muted small' }, 'Looking for PDFs…'));
  try {
    const res = await fetch('/api/library');
    if (!res.ok) throw new Error();
    const { folder, pdfs } = await res.json();
    const history = store.get(HISTORY_KEY, {});
    $('library-folder').textContent = `Showing PDFs from ${folder}. Add PDFs there and reload to see them.`;
    if (!pdfs.length) { box.replaceChildren(el('div', { class: 'library-empty muted' }, 'No PDFs found in that folder yet. Use “Open another PDF” below.')); return; }
    box.replaceChildren(...pdfs.map(pdf => {
      const done = history[pdf.id];
      return el('button', { class: 'library-item', onclick: () => openFromLibrary(pdf) },
        el('strong', {}, prettyName(pdf.name)),
        el('span', { class: 'muted' }, [pdf.folder, done ? `Last practised ${new Date(done).toLocaleDateString()}` : 'Not practised yet'].filter(Boolean).join(' · ')),
        el('span', { class: 'go' }, 'Open →'));
    }));
  } catch {
    box.replaceChildren();
    $('library-folder').textContent = 'The PDF list is not available. You can still open a PDF below.';
  }
}

async function openFromLibrary(pdf) {
  setStatus(`Opening ${pdf.name}…`);
  try {
    const res = await fetch('/api/pdf?id=' + encodeURIComponent(pdf.id));
    if (!res.ok) throw new Error('The file could not be read.');
    await openPdf(new Uint8Array(await res.arrayBuffer()), pdf.name, pdf.id);
  } catch (error) { setStatus(error.message, true); }
}

async function openFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setStatus('Please choose a PDF file.', true); return; }
  setStatus(`Opening ${file.name}…`);
  try { await openPdf(new Uint8Array(await file.arrayBuffer()), file.name, 'file:' + file.name); }
  catch (error) { setStatus(error.message, true); }
}

async function openPdf(data, name, id) {
  let pdf;
  try { pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise; }
  catch { throw new Error('This PDF could not be opened. It may be damaged or password protected.'); }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) pages.push(itemsFromTextContent(await (await pdf.getPage(i)).getTextContent()));
  pdf.destroy();
  if (!pages.some(p => p.length)) throw new Error('No text was found in this PDF. Scanned (image-only) PDFs are not supported.');
  setStatus('');
  showCheck({ doc: documentFromPages(pages), name, id });
}

function setStatus(text, error = false) {
  $('load-status').textContent = text;
  $('load-status').classList.toggle('error', error);
}

// ---------------------------------------------------------------- check screen

function showCheck(next) {
  draft = next;
  const { doc } = draft;
  $('pick').hidden = true;
  $('resume').hidden = true;
  $('check').hidden = false;
  $('fix').open = doc.warnings.length > 0 && !doc.groups.length;
  $('edit-title').value = doc.raw.passageTitle;
  $('edit-passage').value = doc.raw.passage;
  $('edit-questions').value = doc.raw.questions;
  $('edit-key').value = doc.raw.key;
  const count = doc.numbers.length;
  $('minutes').value = Math.max(5, Math.ceil((count * 1.5) / 5) * 5);
  renderCheck();
  window.scrollTo(0, 0);
}

function renderCheck() {
  const { doc, name } = draft;
  $('check-title').textContent = doc.passageTitle || prettyName(name);
  $('check-file').textContent = name;
  const types = [...new Set(doc.groups.map(g => taskName(g, doc.docTitle)))];
  const keyCount = doc.numbers.filter(n => doc.key.answers[n]).length;
  const facts = [
    [types.join(', ') || 'Unknown task type', !!types.length],
    [doc.numbers.length ? `Questions ${doc.numbers[0]}–${doc.numbers[doc.numbers.length - 1]}` : 'No questions found', doc.numbers.length > 0],
    [`${doc.paragraphs.length} paragraph${doc.paragraphs.length === 1 ? '' : 's'}`, doc.paragraphs.length > 0],
    [keyCount ? `Answer key for ${keyCount} question${keyCount === 1 ? '' : 's'}` : 'No answer key', keyCount > 0],
  ];
  $('check-facts').replaceChildren(...facts.map(([text, ok]) => el('li', { class: ok ? 'ok' : '' }, text)));
  $('check-warnings').replaceChildren(...doc.warnings.map(w => el('li', {}, w)));
  $('start').disabled = !doc.groups.length;
}

function applyEdits() {
  draft.doc = buildDocument({
    docTitle: draft.doc.docTitle,
    passageTitle: $('edit-title').value,
    passage: $('edit-passage').value,
    questions: $('edit-questions').value,
    key: $('edit-key').value,
    source: draft.doc.source,
  });
  renderCheck();
}

function backToLibrary() {
  draft = null;
  $('check').hidden = true;
  $('pick').hidden = false;
  $('file-input').value = '';
  showResumeBanner();
  loadLibrary();
}

// ---------------------------------------------------------------- session lifecycle

function startTest() {
  if ($('fix').open) applyEdits();
  const minutes = Math.min(180, Math.max(1, Math.round(+$('minutes').value || 20)));
  session = {
    doc: draft.doc, name: draft.name, id: draft.id,
    answers: {},
    limit: $('untimed').checked ? 0 : minutes * 60,
    originalLimit: $('untimed').checked ? 0 : minutes * 60,
    elapsed: 0,
    running: true,
    submitted: false,
    current: draft.doc.numbers[0],
  };
  draft = null;
  enterExam();
}

function enterExam() {
  $('setup').hidden = true;
  $('exam').hidden = false;
  document.body.classList.toggle('reviewing', session.submitted);
  $('exam-name').textContent = session.doc.passageTitle || prettyName(session.name);
  const nums = session.doc.numbers;
  $('part-text').textContent = nums.length ? `Read the text and answer questions ${nums[0]}–${nums[nums.length - 1]}.` : '';
  renderPassage();
  renderQuestions();
  renderNav();
  updateReviewBar();
  updateTimer();
  if (!session.submitted) startTicker();
  save();
  if (!session.submitted && !session.running) openPause();
  setCurrent(session.current || nums[0], false);
}

function leaveExam() {
  stopTicker();
  closeDialogs();
  save();
  session = null;
  document.body.classList.remove('reviewing');
  $('exam').hidden = true;
  $('setup').hidden = false;
  backToLibrary();
}

function retry() {
  const { doc, name, id, originalLimit } = session;
  session = { doc, name, id, answers: {}, limit: originalLimit, originalLimit, elapsed: 0, running: true, submitted: false, current: doc.numbers[0] };
  enterExam();
}

function save() {
  if (session) store.set(SESSION_KEY, { ...session, running: false });
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function showResumeBanner() {
  const saved = store.get(SESSION_KEY, null);
  if (!saved || !saved.doc) { $('resume').hidden = true; return; }
  const answered = saved.doc.numbers.filter(n => hasAnswer(saved.answers[n])).length;
  $('resume-title').textContent = (saved.submitted ? 'Last review: ' : 'Unfinished test: ') + (saved.doc.passageTitle || prettyName(saved.name));
  $('resume-detail').textContent = ` ${answered} of ${saved.doc.numbers.length} answered · ${clock(saved.elapsed)} used`;
  $('resume-open').textContent = saved.submitted ? 'View review' : 'Continue';
  $('resume').hidden = false;
}

// ---------------------------------------------------------------- timer

function startTicker() {
  stopTicker();
  lastTick = performance.now();
  ticker = setInterval(tick, 250);
}
function stopTicker() { clearInterval(ticker); ticker = null; }

function tick() {
  const now = performance.now();
  if (session && session.running && !session.submitted) {
    session.elapsed += (now - lastTick) / 1000;
    if (session.limit && session.elapsed >= session.limit) {
      session.elapsed = session.limit;
      session.running = false;
      updateTimer();
      save();
      $('expired-dialog').showModal();
    }
    if (Math.floor(session.elapsed) % 5 === 0) saveSoon();
  }
  lastTick = now;
  updateTimer();
}

function updateTimer() {
  if (!session) return;
  const t = $('timer');
  if (session.submitted) { t.textContent = `Time used ${clock(session.elapsed)}`; t.classList.remove('low'); }
  else if (session.limit) {
    const left = session.limit - session.elapsed;
    t.textContent = `${clock(left)} left`;
    t.classList.toggle('low', left <= 300);
  } else {
    t.textContent = `${clock(session.elapsed)}` + (session.originalLimit ? ` (limit ${clock(session.originalLimit)})` : ' elapsed');
    t.classList.toggle('low', !!session.originalLimit);
  }
  $('pause').hidden = session.submitted;
  $('submit').hidden = session.submitted;
  $('pause-time').textContent = session.limit ? `${clock(session.limit - session.elapsed)} left` : `${clock(session.elapsed)} elapsed`;
}

function openPause() {
  session.running = false;
  save();
  updateTimer();
  if (!$('pause-dialog').open) $('pause-dialog').showModal();
}
function resume() {
  $('pause-dialog').close();
  session.running = true;
  lastTick = performance.now();
}

function closeDialogs() {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}

// ---------------------------------------------------------------- passage

function renderPassage() {
  const { doc } = session;
  const article = $('passage');
  article.replaceChildren(
    doc.passageTitle ? el('h2', {}, doc.passageTitle) : null,
    ...doc.paragraphs.map((text, i) => el('p', { class: 'para', id: `para-${i + 1}`, dataset: { para: String(i + 1) } }, text)),
    session.submitted && doc.source ? el('p', { class: 'source' }, 'Source: ' + doc.source) : null,
  );
  $('passage-pane').scrollTop = 0;
}

function locateParagraph(n) {
  const p = $(`para-${n}`);
  if (!p) return;
  p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  p.classList.remove('flash');
  void p.offsetWidth; // restart the animation
  p.classList.add('flash');
}

// ---------------------------------------------------------------- questions

const hasAnswer = v => Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());

function renderQuestions() {
  const box = $('questions');
  box.replaceChildren(...session.doc.groups.map(renderGroup));
  if (session.submitted) box.append(renderKeyTable());
  $('questions-pane').scrollTop = 0;
}

function renderGroup(group) {
  const { doc } = session;
  const section = el('section', { class: 'group', 'aria-label': `Questions ${group.from} to ${group.to}` });
  section.append(el('h3', {}, group.from === group.to ? `Question ${group.from}` : `Questions ${group.from}–${group.to}`));

  const defs = group.instructions.filter(p => p.type === 'definition');
  for (const p of group.instructions) {
    if (p.type === 'text') section.append(el('p', { class: 'instr' }, rich(p.text)));
    else if (p === defs[0]) section.append(el('table', { class: 'defs' }, el('tbody', {}, defs.map(d => el('tr', {}, el('th', {}, d.term), el('td', {}, d.text))))));
  }

  const boxOptions = group.options.length && group.kind !== 'multi'
    ? el('div', { class: 'options-box' }, group.options.map(o => el('div', {}, el('span', { class: 'letter' }, o.key), el('span', {}, o.text))))
    : null;
  // Matching headings show the list first; sentence endings and word boxes show it after the questions.
  const listFirst = group.options.length && /^[ivx]+$/.test(group.options[0].key);
  if (boxOptions && listFirst) section.append(boxOptions);

  if (group.kind === 'summary') {
    if (group.summary.title) section.append(el('p', { class: 'summary-title' }, group.summary.title));
    const numbers = range(group.from, group.to);
    for (const line of group.summary.text.split('\n')) {
      const p = el('p', { class: 'summary', 'data-highlightable': '' });
      for (const part of splitGaps(line, numbers)) p.append(part.gap ? gapControl(part.n, group) : part.text);
      section.append(p);
    }
    if (session.submitted) section.append(...numbers.map(n => keyNote(n, true)));
  } else if (group.kind === 'multi') {
    const count = group.to - group.from + 1;
    const q = el('div', { class: 'q', dataset: { q: String(group.from) } });
    const chosen = range(group.from, group.to).map(n => session.answers[n]).filter(Boolean);
    q.append(el('div', { class: 'choices' }, group.options.map(o => el('label', { class: 'choice' },
      el('input', { type: 'checkbox', value: o.key, checked: chosen.includes(o.key), disabled: session.submitted, dataset: { q: String(group.from) },
        onchange: e => onMultiChange(e, group, count) }),
      el('span', { class: 'letter' }, o.key), el('span', { 'data-highlightable': '' }, o.text)))));
    if (session.submitted) q.append(...range(group.from, group.to).map(n => keyNote(n, true)));
    section.append(q);
  } else {
    for (const item of group.items) section.append(renderItem(item, group));
  }

  if (boxOptions && !listFirst) section.append(boxOptions);
  return section;
}

function renderItem(item, group) {
  const n = item.n;
  const q = el('div', { class: 'q', id: `q-${n}`, dataset: { q: String(n) } });
  const text = el('p', { class: 'q-text', 'data-highlightable': '' }, el('span', { class: 'qn' }, String(n)));
  q.append(text);

  if (group.kind === 'tfng' || group.kind === 'ynng') {
    text.append(item.text);
    const values = group.kind === 'tfng' ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN'];
    q.append(radioList(n, values.map(v => ({ value: v, label: v }))));
  } else if (group.kind === 'choice') {
    text.append(item.text);
    q.append(radioList(n, item.options.map(o => ({ value: o.key, letter: o.key, label: o.text }))));
  } else if (group.kind === 'matching' || group.kind === 'gap') {
    const parts = splitGaps(item.text, [n]);
    if (parts.some(p => p.gap)) for (const part of parts) text.append(part.gap ? gapControl(n, group) : part.text);
    else text.append(item.text, ' ', gapControl(n, group, 'match-select'));
  } else {
    text.append(item.text);
    q.append(el('input', { class: 'short-answer', type: 'text', placeholder: String(n), 'aria-label': `Answer ${n}`, autocomplete: 'off', spellcheck: 'false',
      value: session.answers[n] || '', disabled: session.submitted, dataset: { q: String(n) }, oninput: e => setAnswer(n, e.target.value) }));
  }
  if (session.submitted) q.append(keyNote(n));
  return q;
}

function radioList(n, choices) {
  return el('div', { class: 'choices', role: 'radiogroup', 'aria-label': `Question ${n}` }, choices.map(c => el('label', { class: 'choice' },
    el('input', { type: 'radio', name: `q${n}`, value: c.value, checked: session.answers[n] === c.value, disabled: session.submitted, dataset: { q: String(n) },
      onchange: e => setAnswer(n, e.target.value) }),
    c.letter ? el('span', { class: 'letter' }, c.letter) : null,
    el('span', { 'data-highlightable': '' }, c.label))));
}

/** A text box in the gap, or a drop-down when the group has a lettered list to choose from. */
function gapControl(n, group, extraClass = '') {
  if (group.options.length) {
    return el('select', { class: extraClass, 'aria-label': `Answer ${n}`, disabled: session.submitted, dataset: { q: String(n) }, onchange: e => setAnswer(n, e.target.value) },
      el('option', { value: '' }, String(n)),
      group.options.map(o => el('option', { value: o.key, selected: session.answers[n] === o.key }, o.key)));
  }
  return el('input', { class: 'gap', type: 'text', placeholder: String(n), 'aria-label': `Answer ${n}`, autocomplete: 'off', spellcheck: 'false',
    value: session.answers[n] || '', disabled: session.submitted, dataset: { q: String(n) }, oninput: e => setAnswer(n, e.target.value) });
}

function onMultiChange(event, group, count) {
  const boxes = [...$('questions').querySelectorAll(`input[type=checkbox][data-q="${group.from}"]`)];
  let picked = boxes.filter(b => b.checked).map(b => b.value);
  if (picked.length > count) { event.target.checked = false; picked = picked.filter(v => v !== event.target.value); }
  picked.sort();
  range(group.from, group.to).forEach((n, i) => { session.answers[n] = picked[i] || ''; markNav(n); });
  updateAnsweredCount();
  saveSoon();
}

function setAnswer(n, value) {
  session.answers[n] = value;
  markNav(n);
  updateAnsweredCount();
  saveSoon();
}

function keyNote(n, withNumber = false) {
  const entry = session.doc.key.answers[n];
  const yours = session.answers[n];
  const note = el('div', { class: 'key' });
  if (withNumber) note.append(el('strong', {}, `${n}  `));
  if (!entry) { note.append(el('span', { class: 'yours' }, 'Not in the answer key.')); return note; }
  note.append('Answer: ', el('b', {}, entry.answer));
  if (withNumber || !hasAnswer(yours)) note.append(el('span', { class: 'yours' }, ` · you: ${hasAnswer(yours) ? yours : '(blank)'}`));
  if (entry.note) note.append(el('span', { class: 'yours' }, ` · ${entry.note}`));
  const para = paragraphRef(entry.note);
  if (para && $(`para-${para}`)) note.append(el('button', { type: 'button', onclick: () => locateParagraph(para) }, 'Show in passage'));
  return note;
}

function renderKeyTable() {
  const { doc } = session;
  const wrap = el('section', { class: 'key-table', 'aria-label': 'Answer key' }, el('h3', {}, 'Your answers and the answer key'));
  wrap.append(el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Q'), el('th', {}, 'Your answer'), el('th', {}, 'Answer key'), el('th', {}, 'Where'))),
    el('tbody', {}, doc.numbers.map(n => {
      const entry = doc.key.answers[n];
      const para = entry && paragraphRef(entry.note);
      return el('tr', {},
        el('td', {}, String(n)),
        el('td', {}, hasAnswer(session.answers[n]) ? session.answers[n] : el('span', { class: 'muted' }, '—')),
        el('td', {}, entry ? entry.answer : el('span', { class: 'muted' }, 'not found')),
        el('td', {}, entry && entry.note ? (para && $(`para-${para}`) ? el('button', { class: 'btn link', onclick: () => locateParagraph(para) }, entry.note) : entry.note) : ''));
    }))));
  const extras = [
    ...doc.key.links.map(l => el('div', {}, `${l.label}: `, el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.url))),
    ...doc.key.notes.map(n => el('div', { class: 'muted' }, n)),
  ];
  if (extras.length) wrap.append(el('div', { class: 'links' }, extras));
  return wrap;
}

// ---------------------------------------------------------------- navigation

function renderNav() {
  $('qnav').replaceChildren(...session.doc.numbers.map(n => el('button', { type: 'button', dataset: { n: String(n) }, 'aria-label': `Question ${n}`, onclick: () => goTo(n) }, String(n))));
  session.doc.numbers.forEach(markNav);
  updateAnsweredCount();
}

function markNav(n) {
  const b = $('qnav').querySelector(`[data-n="${n}"]`);
  if (b) b.classList.toggle('answered', hasAnswer(session.answers[n]));
}

function updateAnsweredCount() {
  const total = session.doc.numbers.length;
  const done = session.doc.numbers.filter(n => hasAnswer(session.answers[n])).length;
  $('answered').textContent = `${done} of ${total} answered`;
}

function setCurrent(n, scroll = true) {
  if (!session || n === undefined) return;
  session.current = n;
  for (const b of $('qnav').querySelectorAll('button')) b.classList.toggle('current', +b.dataset.n === n);
  for (const q of $('questions').querySelectorAll('.q.current')) q.classList.remove('current');
  const target = findQuestion(n);
  const block = target && target.closest('.q');
  if (block) block.classList.add('current');
  if (scroll && target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function findQuestion(n) {
  const group = session.doc.groups.find(g => n >= g.from && n <= g.to);
  if (group && group.kind === 'multi') return $('questions').querySelector(`[data-q="${group.from}"]`);
  return $('questions').querySelector(`input[data-q="${n}"], select[data-q="${n}"]`) || $(`q-${n}`);
}

function goTo(n) {
  setCurrent(n);
  const target = findQuestion(n);
  const control = target && (target.matches('input, select') ? target : target.querySelector('input, select'));
  if (control && !control.disabled) control.focus({ preventScroll: true });
}

function step(delta) {
  const nums = session.doc.numbers;
  const i = nums.indexOf(session.current);
  const next = nums[Math.min(nums.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))];
  goTo(next);
}

// ---------------------------------------------------------------- submit and review

function askSubmit() {
  const total = session.doc.numbers.length;
  const done = session.doc.numbers.filter(n => hasAnswer(session.answers[n])).length;
  $('submit-message').textContent = done === total ? `You have answered all ${total} questions.` : `You have answered ${done} of ${total} questions. ${total - done} ${total - done === 1 ? 'is' : 'are'} still blank.`;
  $('submit-dialog').showModal();
}

function submit() {
  closeDialogs();
  session.submitted = true;
  session.running = false;
  stopTicker();
  if (session.id) { const h = store.get(HISTORY_KEY, {}); h[session.id] = Date.now(); store.set(HISTORY_KEY, h); }
  enterExam();
}

function updateReviewBar() {
  $('review-bar').hidden = !session.submitted;
  if (!session.submitted) return;
  const over = session.originalLimit && session.elapsed > session.originalLimit ? ` (${clock(session.elapsed - session.originalLimit)} over the limit)` : '';
  const keyed = session.doc.numbers.some(n => session.doc.key.answers[n]);
  $('review-text').textContent = `Time used ${clock(session.elapsed)}${over}. ` + (keyed ? 'The answer key is shown under each question.' : 'No answer key was found in this PDF.');
}

// ---------------------------------------------------------------- highlighting

let ctxRange = null;
let ctxMark = null;

function onContextMenu(event) {
  const mark = event.target.closest('mark.hl');
  const sel = window.getSelection();
  const range = sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
  const inside = range && $('panes').contains(range.commonAncestorContainer);
  if (!mark && !inside) { hideCtx(); return; }
  event.preventDefault();
  ctxRange = inside ? range.cloneRange() : null;
  ctxMark = mark;
  $('ctx-highlight').hidden = !ctxRange;
  $('ctx-clear').hidden = !ctxMark;
  const menu = $('ctx');
  menu.hidden = false;
  const { innerWidth: w, innerHeight: h } = window;
  menu.style.left = Math.min(event.clientX, w - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(event.clientY, h - menu.offsetHeight - 8) + 'px';
  menu.querySelector('button:not([hidden])').focus();
}
function hideCtx() { $('ctx').hidden = true; ctxRange = null; ctxMark = null; }

function highlight(range) {
  const allowed = node => node.parentElement && node.parentElement.closest('.passage p, .passage h2, [data-highlightable]') && !node.parentElement.closest('select, option, button, .key');
  const root = range.commonAncestorContainer;
  const nodes = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    while (walker.nextNode()) nodes.push(walker.currentNode);
  }
  for (const node of nodes) {
    if (!allowed(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start >= end || !node.data.slice(start, end).trim()) continue;
    node.splitText(end);
    const middle = node.splitText(start);
    const mark = el('mark', { class: 'hl' });
    middle.replaceWith(mark);
    mark.append(middle);
  }
  window.getSelection().removeAllRanges();
}

function clearHighlight(mark) {
  const parent = mark.parentNode;
  mark.replaceWith(...mark.childNodes);
  parent.normalize();
}

// ---------------------------------------------------------------- layout and preferences

function applyPrefs() {
  const prefs = store.get(PREFS_KEY, {});
  document.documentElement.dataset.size = prefs.size || 'standard';
  document.documentElement.dataset.contrast = prefs.contrast || 'standard';
  $('text-size').value = prefs.size || 'standard';
  $('contrast').value = prefs.contrast || 'standard';
  if (prefs.split) $('panes').style.setProperty('--left', prefs.split + '%');
}
function setPref(key, value) {
  const prefs = store.get(PREFS_KEY, {});
  prefs[key] = value;
  store.set(PREFS_KEY, prefs);
  applyPrefs();
}

function setupDivider() {
  const divider = $('divider');
  const panes = $('panes');
  const setSplit = pct => { const v = Math.min(75, Math.max(25, pct)); panes.style.setProperty('--left', v + '%'); return v; };
  let last = 50;
  divider.addEventListener('pointerdown', e => {
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
    document.body.classList.add('resizing');
  });
  divider.addEventListener('pointermove', e => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const box = panes.getBoundingClientRect();
    last = setSplit(((e.clientX - box.left) / box.width) * 100);
  });
  const end = e => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    divider.releasePointerCapture(e.pointerId);
    divider.classList.remove('dragging');
    document.body.classList.remove('resizing');
    setPref('split', Math.round(last));
  };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
  divider.addEventListener('dblclick', () => { last = setSplit(50); setPref('split', 50); });
  divider.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const now = parseFloat(getComputedStyle(panes).getPropertyValue('--left')) || 50;
    last = setSplit(now + (e.key === 'ArrowLeft' ? -3 : 3));
    setPref('split', Math.round(last));
  });
}

// ---------------------------------------------------------------- wiring

function init() {
  applyPrefs();
  setupDivider();
  loadLibrary();
  showResumeBanner();

  $('file-input').addEventListener('change', e => openFile(e.target.files[0]));
  const drop = $('drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragging'); openFile(e.dataTransfer.files[0]); });

  $('resume-open').addEventListener('click', () => {
    const saved = store.get(SESSION_KEY, null);
    if (!saved) return;
    session = { ...saved, running: false };
    enterExam();
  });
  $('resume-discard').addEventListener('click', () => { store.remove(SESSION_KEY); showResumeBanner(); });

  $('back').addEventListener('click', backToLibrary);
  $('apply-edits').addEventListener('click', applyEdits);
  $('untimed').addEventListener('change', e => { $('minutes').disabled = e.target.checked; });
  $('start').addEventListener('click', startTest);

  $('pause').addEventListener('click', openPause);
  $('resume-test').addEventListener('click', resume);
  $('pause-dialog').addEventListener('cancel', e => { e.preventDefault(); resume(); });
  $('submit').addEventListener('click', askSubmit);
  $('submit-cancel').addEventListener('click', () => $('submit-dialog').close());
  $('submit-confirm').addEventListener('click', submit);
  $('expired-submit').addEventListener('click', submit);
  $('expired-continue').addEventListener('click', () => { session.limit = 0; session.running = true; lastTick = performance.now(); $('expired-dialog').close(); updateTimer(); });
  $('expired-dialog').addEventListener('cancel', e => e.preventDefault());

  $('settings').addEventListener('click', () => $('settings-dialog').showModal());
  $('settings-close').addEventListener('click', () => $('settings-dialog').close());
  $('text-size').addEventListener('change', e => setPref('size', e.target.value));
  $('contrast').addEventListener('change', e => setPref('contrast', e.target.value));
  $('exit').addEventListener('click', () => { if (session && !session.submitted) session.running = false; leaveExam(); });

  $('retry').addEventListener('click', retry);
  $('leave').addEventListener('click', leaveExam);
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));

  $('questions').addEventListener('focusin', e => {
    const holder = e.target.closest('[data-q]');
    if (!holder) return;
    const n = +holder.dataset.q;
    const group = session.doc.groups.find(g => n >= g.from && n <= g.to);
    if (group && group.kind === 'multi') { const first = range(group.from, group.to).find(k => !hasAnswer(session.answers[k])); setCurrent(first ?? group.from, false); }
    else setCurrent(n, false);
  });

  $('panes').addEventListener('contextmenu', onContextMenu);
  $('ctx-highlight').addEventListener('click', () => { if (ctxRange) highlight(ctxRange); hideCtx(); });
  $('ctx-clear').addEventListener('click', () => { if (ctxMark) clearHighlight(ctxMark); hideCtx(); });
  document.addEventListener('pointerdown', e => { if (!$('ctx').contains(e.target)) hideCtx(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtx(); });
  $('passage-pane').addEventListener('scroll', hideCtx);
  $('questions-pane').addEventListener('scroll', hideCtx);

  // Save the clock when the tab is hidden or closed, so a reload continues from the same time.
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
}

init();
