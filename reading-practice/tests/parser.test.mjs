import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { documentFromPages, buildDocument, splitGaps, paragraphRef, taskName } from '../dist/parser.mjs';

const fixture = name => documentFromPages(JSON.parse(fs.readFileSync(new URL(`fixtures/${name}.json`, import.meta.url))));

test('sentence completion PDF', () => {
  const doc = fixture('Sentence_Completion');
  assert.equal(doc.passageTitle, 'The environmental impact of fashion');
  assert.equal(doc.paragraphs.length, 6);
  assert.match(doc.paragraphs[3], /^Now that there is .* natural materials and crops\./); // paragraph continues across a page break
  assert.equal(doc.source, 'https://en.wikipedia.org/wiki/Environmental_impact_of_fashion');
  assert.equal(doc.groups.length, 1);
  const [g] = doc.groups;
  assert.equal(g.kind, 'gap');
  assert.deepEqual(g.items.map(i => i.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(taskName(g, doc.docTitle), 'Sentence completion');
  assert.deepEqual(splitGaps(g.items[2].text, [3]), [{ text: 'Over ' }, { gap: true, n: 3 }, { text: ' garments are bought by consumers annually.' }]);
  assert.equal(doc.key.answers[3].answer, '80/eighty billion');
  assert.equal(paragraphRef(doc.key.answers[10].note), 6);
  assert.equal(doc.key.links[0].label, 'Answer guidance video');
  assert.deepEqual(doc.warnings, []);
  assert.ok(!doc.paragraphs.join(' ').includes('Note: This is not a real IELTS test'));
});

test('yes / no / not given PDF', () => {
  const doc = fixture('Yes_No_NG');
  const [g] = doc.groups;
  assert.equal(g.kind, 'ynng');
  assert.deepEqual(g.instructions.filter(p => p.type === 'definition').map(p => p.term), ['YES', 'NO', 'NOT GIVEN']);
  assert.equal(g.items[6].text, 'The more an expectation of being rewarded is not met, the more the dopamine neurons in the brain are activated.');
  assert.equal(doc.paragraphs.length, 7);
  assert.equal(doc.source, 'http://theconversation.com/explainer-what-is-dopamine-and-is-it-to-blame-for-our-addictions-51268');
  assert.equal(doc.key.answers[10].answer, 'NG');
  assert.deepEqual(doc.warnings, []);
});

test('matching sentence endings PDF', () => {
  const doc = fixture('Matching_Sentences');
  const [g] = doc.groups;
  assert.equal(g.kind, 'matching');
  assert.equal(g.items.length, 10);
  assert.equal(g.options.length, 15);
  assert.equal(g.options[13].text, 'then the instrument will suffer less from changes in humidity and temperature than one made of solid wood.');
  assert.ok(g.items.every(i => !i.options.length));
  assert.equal(taskName(g), 'Matching sentence endings');
  assert.equal(doc.paragraphs.length, 9);
  assert.equal(doc.key.answers[10].answer, 'L');
  assert.deepEqual(doc.warnings, []);
});

test('multiple choice with per-question options', () => {
  const doc = buildDocument({ passage: 'Para one.\n\nPara two.', questions: [
    'Questions 1-2', 'Choose the correct letter, A, B, C or D.', '',
    '1. What does the writer say about', 'dopamine?', 'A. It is rare.', 'B. It is common', 'in all animals.', 'C. It is new.', 'D. It is old.',
    '2. Why did the experiment fail?', 'A. Money', 'B. Time', 'C. Ethics', 'D. Staff',
  ].join('\n'), key: 'Answer Key\n1. B\n2. C' });
  const [g] = doc.groups;
  assert.equal(g.kind, 'choice');
  assert.equal(g.items[0].text, 'What does the writer say about dopamine?');
  assert.deepEqual(g.items[0].options.map(o => o.key), ['A', 'B', 'C', 'D']);
  assert.equal(g.items[0].options[1].text, 'It is common in all animals.');
  assert.equal(g.items[1].options.length, 4);
  assert.deepEqual(doc.warnings, []);
});

test('true / false / not given and a second group', () => {
  const doc = buildDocument({ questions: [
    'Questions 1-2', 'Do the following statements agree with the information given in the text?', '',
    'TRUE if the statement agrees with the information', 'FALSE if the statement contradicts the information', 'NOT GIVEN if there is no information on this', '',
    '1 Rats like levers.', '2 Turtles have no dopamine.', '',
    'Questions 3-4', 'Answer the questions below.', 'Choose NO MORE THAN TWO WORDS from the passage for each answer.', '',
    '3 Which animal pressed a lever?', '4 When was the experiment?',
  ].join('\n'), key: '1 TRUE   3 rats\n2 FALSE   4 1970' });
  assert.deepEqual(doc.groups.map(g => g.kind), ['tfng', 'short']);
  assert.deepEqual(doc.groups[0].items.map(i => i.text), ['Rats like levers.', 'Turtles have no dopamine.']);
  assert.deepEqual(Object.values(doc.key.answers).map(a => a.n + ':' + a.answer), ['1:TRUE', '2:FALSE', '3:rats', '4:1970']);
  assert.deepEqual(doc.warnings, []);
});

test('summary completion with a word box', () => {
  const doc = buildDocument({ questions: [
    'Questions 5-7', 'Complete the summary using the list of words, A-F, below.', '',
    'Fast fashion', '',
    'Clothes are now made from 5 ………. rather than natural fibres. This causes',
    '6 ………. when washed, and the burning of 7 ………. releases CO2.', '',
    'A plastics   B microplastics   C wool', 'D unsold stock   E cotton   F water',
  ].join('\n') });
  const [g] = doc.groups;
  assert.equal(g.kind, 'summary');
  assert.equal(g.summary.title, 'Fast fashion');
  assert.equal(g.options.map(o => o.key).join(''), 'ABCDEF');
  const gaps = splitGaps(g.summary.text, [5, 6, 7]);
  assert.deepEqual(gaps.filter(p => p.gap).map(p => p.n), [5, 6, 7]);
  assert.equal(gaps[0].text, 'Clothes are now made from ');
  assert.deepEqual(doc.warnings.filter(w => w.startsWith('Questions')), []);
});

test('matching headings with a roman-numeral list before the questions', () => {
  const doc = buildDocument({ questions: [
    'Questions 1-3', 'Choose the correct heading for each paragraph from the list of headings below.', '',
    'List of Headings', 'i. The cost of fashion', 'ii. A history of wool', 'iii. Water and soil', 'iv. Looking ahead', '',
    '1 Paragraph A', '2 Paragraph B', '3 Paragraph C',
  ].join('\n') });
  const [g] = doc.groups;
  assert.equal(g.kind, 'matching');
  assert.deepEqual(g.options.map(o => o.key), ['i', 'ii', 'iii', 'iv']);
  assert.equal(taskName(g), 'Matching headings');
});

test('choose TWO letters', () => {
  const doc = buildDocument({ questions: [
    'Questions 11-12', 'Choose TWO letters, A-E.', 'Which TWO problems does the writer mention?',
    'A. cost', 'B. noise', 'C. heat', 'D. damp', 'E. light',
  ].join('\n') });
  assert.equal(doc.groups[0].kind, 'multi');
  assert.equal(doc.groups[0].options.length, 5);
});
