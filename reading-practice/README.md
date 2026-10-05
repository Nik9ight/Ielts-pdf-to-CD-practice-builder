# Reading Practice

Turns IELTS reading practice PDFs into a computer-delivered style test: passage on the left, questions on the right, a pausable timer, and the answer key hidden until you submit.

## Run it

```sh
cd reading-practice
npm install
npm start
```

Then open http://127.0.0.1:4173.

PDFs in the folder above `reading-practice/` (and its subfolders) are listed automatically. To use another folder:

```sh
PDF_DIR="/path/to/your/pdfs" npm start
```

You can also open any PDF with **Open another PDF** or drag it onto the page.

## In the test

- **Timer**: set the minutes before starting, or tick *No time limit* to count up. **Pause** stops the clock and hides the passage.
- **Resize**: drag the bar between the two panels (double-click it to reset).
- **Highlight**: select text, right-click, then choose *Highlight*. Right-click a highlight to clear it.
- **Settings**: text size and colour scheme (black on white, white on black, yellow on black).
- **Navigation**: the numbered buttons at the bottom jump to a question. Filled buttons are answered.
- **Submit**: answers are locked and the answer key appears under each question, with *Show in passage* links when the key names a paragraph. There is no automatic marking.

Progress is saved in the browser, so if you close or reload the page you can carry on from the home screen.

## If a PDF comes out wrong

On the screen before you start, open **Check or fix the extracted text**. You can edit the passage, questions and answer key there, then press **Apply changes**. Question groups must start with a line like `Questions 1-10`. Scanned (image-only) PDFs are not supported.

Supported question layouts: sentence/short-answer completion, True/False/Not Given, Yes/No/Not Given, multiple choice (one or several answers), matching with a lettered or roman-numeral list (sentence endings, headings, information), and summary/notes completion with or without a word box.

## Development

- `dist/parser.mjs`: PDF text → passage, question groups and answer key (no DOM, so it is tested in Node).
- `dist/app.mjs`: the app's user interface.
- `npm test` runs the parser tests. `npm run fixtures -- path/to/file.pdf` saves a PDF's text as a new test fixture in `tests/fixtures/`.
