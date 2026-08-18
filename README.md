# HotGato SpeedReader
Speed Reader for ADHD for rapid serial visual presentation (RSVP)

The speed reader is designed to assist users in rapidly reading and comprehending textual content. By breaking text down into manageable chunks and displaying them sequentially at a controlled speed, users can focus on comprehension without the distraction of scanning across lines or pages.

### Key Functionality and Features:

1. **Chunk Display:**
   * The text is divided into "chunks" of a specified number of words, and each chunk is displayed one at a time, allowing readers to absorb small bits of information rapidly.

2. **Customizable Speed:**
   * Users can set their reading speed in Words Per Minute (WPM), ranging from 100 to 1500. This allows for flexibility for both novice readers who want to start slow and speed-reading experts who want to push their limits.

3. **Customizable Chunk Size:**
   * Users have the ability to determine how many words they see in each chunk (between 1 and 5). This allows users to tailor the experience to their comfort level and reading capability.

4. **Special Punctuation Handling:**
   * The application intelligently recognizes sentence-ending punctuation and certain special characters, ensuring that they don't disrupt the reading flow. For example, "$3.99" or ".9" are treated as single entities rather than being split inappropriately.

5. **Adjustable Font Size and Family:**
   * Users can adjust the font size for better visibility, and can also choose from a variety of font families, including a special "ADHD" font where the first two letters of each word are highlighted for enhanced focus.

6. **Pause and Resume:**
   * With a simple click, users can pause their reading session and then resume it whenever they're ready.

7. **Local Storage Integration:**
   * User preferences, such as chosen speed, chunk size, font size, and font family, are saved locally. This ensures that users don’t have to reset their preferences each time they use the tool.

8. **Smart Text Parsing:**
   * The tool has been designed to handle various scenarios like multiple spaces, paragraphs, URLs, etc., ensuring that users get a smooth reading experience regardless of the text's structure.

9. **Sentence Awareness:**
   * The application is smart enough to recognize when a chunk would split a sentence in a way that disrupts comprehension, adjusting the chunk to preserve the sentence's integrity.

10. **PDF Reading (client-side):**
    * Load a PDF straight into the reader with the **Choose PDF** button — everything is parsed in the browser, so files never leave your machine. Parsing uses heuristics to strip noise (footnotes, tables of contents, running headers/footers, and figure/table captions) so you read the body text, not the clutter.

11. **Image and Code Awareness:**
    * When a page contains images or code blocks, a banner appears above the reader. Click it (or press **V**) to render that full PDF page in a high-resolution pop-up so you can see what the parser skipped over. The page text is overlaid as a selectable layer, so you can highlight and copy directly from the pop-up. Code blocks are outlined in the pop-up so you can find them at a glance.

12. **Hold-to-Read, Rewind, and Progress:**
    * Hold the **Spacebar** to read and release to pause. On pause you get a progress readout (percent through the book plus the current page) and a render of the page you're on. Press the **Left Arrow** to jump back ~100 words.

13. **One Page at a Time:**
    * Tick **One page at a time** to read the document page by page instead of straight through. Each page is read as a whole thought: playback starts at the beginning of the sentence sitting at the top of the page (backing into the previous page when that sentence started there) and runs to the end of the last sentence the page begins (carrying on into the next page to finish it). Reading stops on its own at the page boundary and the full page render pops up, ready to copy from or screenshot. Press **Space** again for the next page.

14. **Web Pages Saved as PDF:**
    * Standards, protocols, and API docs are often read as a web page printed to PDF. Those pages are one long sheet rather than a book page, so the page pop-up fits them to width and scrolls, and marks the line you had read up to — the equivalent of "where was I on this page". Monospace code blocks are detected, left out of the read-aloud text, and outlined in the pop-up instead.

15. **Progress Dock:**
    * A bar fixed to the bottom of the window shows how far you are through the page you're on, how far through the whole document, and which page you're on (`Page 7 of 24`). It's built for the periphery — no clicks needed, and it never intercepts one.

### Appeal to Users:

Given the rise in information consumption, tools like this speed reader become essential for many who are looking to consume vast amounts of text in shorter periods. The combination of user customization and smart text handling ensures an optimal and flexible reading experience. Whether someone is studying for an exam, going through a report, or just reading for leisure, this tool can enhance their efficiency and comprehension.

## Usage

### Launching the app

The reader is a static, fully client-side web app — no build step and no server-side code. PDF parsing happens entirely in your browser via [pdf.js](https://mozilla.github.io/pdf.js/).

Because PDF loading uses `fetch`, you need to serve the files over HTTP rather than opening `index.html` from the filesystem (`file://`). From the project root:

```bash
# Python (no install needed on most systems)
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Any static file server works (e.g. `npx serve`).

On startup the app loads the bundled `test.pdf`; use the **Choose PDF** button to read your own file.

### Reading a document

1. Click **Choose PDF** and pick a local PDF (or paste text into the text box for a quick read).
2. Adjust **Reading Speed**, **Chunk Size**, **Punctuation Pause**, **Font Size**, and **Font Family** to taste — your settings are remembered between sessions.
3. Read using either control scheme below.

### Keyboard controls

| Key | Action |
| --- | --- |
| **Hold Space** | Read while held; release to pause. In page mode, reads one page then stops |
| **Left Arrow** | Jump back ~100 words |
| **V** | View the current PDF page in a pop-up |
| **Esc** | Close the page pop-up |

The **GO! / Pause** button toggles reading as an alternative to holding Space. When you pause, you'll see your progress (percent and page number) and a render of the current page.

### One page at a time

Tick the **One page at a time** checkbox next to the **Choose PDF** button to switch from continuous reading to page-by-page reading. The setting is remembered between sessions and applies to PDFs only (pasted text has no pages, so the reader stays continuous).

In this mode the document is cut into one segment per page, and each segment is expanded outward to whole sentences:

* It **starts** at the first word of the sentence at the top of the page — if that sentence began on the previous page, playback backs up and starts there.
* It **ends** at the end of the last sentence the page begins — if that sentence finishes on the next page, playback carries on to finish it.

A sentence straddling a page break is therefore read twice, once as the tail of one page and once as the head of the next, which is what keeps each page a self-contained read.

Reading stops on its own when it reaches the end of the page, even if you're still holding Space, and the full page render opens so you can select, copy, or screenshot it. Press **Space** again to move to the next page. If you let go partway through a page, the reader stays put and the next press picks up where you left off rather than skipping the rest of the page.

Sentence detection is heuristic — it deliberately treats an ambiguous period (abbreviations like `Mr.`, initials like `J.`, list numbers like `1.`, or a lowercase word following) as *not* ending a sentence. On a page with no sentence punctuation at all (a table, a poem), the search gives up after `MAX_SENTENCE_SCAN` words so a single page can't drag in half the document.

### Reading web pages saved as PDF

Standards, RFCs, and API documentation are often saved from the browser as a PDF. Two things are handled specially for those documents.

**Where you are on the page.** The pop-up marks the line you had read up to with an orange band and scrolls it into view, so pausing on a long page shows you your place rather than just the page. A page taller than twice its width is treated as a web print-out: it is fitted to the window's *width* and the pop-up scrolls, instead of being shrunk whole to fit the window's height (which makes a long page unreadable). The backing canvas is capped at 16 megapixels so a very long page can't exceed the browser's canvas limits.

In page-at-a-time mode a sentence is often borrowed across a page break, so the words being read may not physically sit on the page shown. When that happens the marker pins to the edge the reading ran off — the bottom of the page when it has carried on to the next, the top when it started on the previous one.

**Code blocks.** Runs of monospace lines are treated as code: they're left out of the text you read, counted in the banner above the reader (`⌨️ 2 code blocks on this page`), and outlined in the page pop-up so you can find and copy them. Detection is font-based, using the family pdf.js reports for each text item:

* A line counts as code when at least `codeMonoFrac` (default 60%) of its characters are in a monospace font, so an inline `foo()` inside a paragraph doesn't trip it.
* If the *whole document* is monospace — a plain-text RFC, for instance — nothing is treated as code, since there is no code font to single out and the alternative would be dropping the entire document.
* Set `dropCodeBlocks: false` in `PARSE_CONFIG` to read code blocks aloud again.

One consequence worth knowing: a page consisting of nothing but code has no words left to read, so playback never lands on it and its banner never fires. The parse summary in the browser console reports these as `dropped.allCodePages`.

### The progress dock

Reading word-by-word hides how far along you are, so a progress dock sits fixed at the bottom of the window:

* **Page label** — `Page 7 of 24`, using the document's real page numbers.
* **Thick bar** — progress through the page you're on. In page-at-a-time mode this tracks the page segment being read; otherwise it tracks the real page.
* **Thin bar** — progress through the whole document, ticked once per page so it reads as a map rather than a featureless line. Ticks are dropped past 80 pages, where they'd be indistinguishable, and the whole thin bar is hidden for a single-page document, where it would just duplicate the thick one.
* **Word count** — `1,203 / 5,400 words`, next to the page percentage.

A sheen travels along the thick bar only while words are actually moving, so the dock also tells you at a glance whether the reader is running. The dock ignores pointer events (only the two bars take a hover, for their tooltips), so it can never swallow a click meant for the page behind it. Everything respects `prefers-reduced-motion`.

### Tuning the PDF parser

PDF parsing is heuristic. If too much or too little is stripped for your documents, edit the `PARSE_CONFIG` object near the top of [`core.js`](core.js) — it toggles each filter (footnotes, headers/footers, TOC pages, captions, front matter, and code blocks) and exposes the thresholds. The `skipFrontMatter` filter drops praise/blurb, title, copyright, dedication, and author-bio pages near the start so reading begins at the real content (e.g. the foreword/preface). The parser logs a summary of what it kept, dropped, and the page it started on to the browser console.
