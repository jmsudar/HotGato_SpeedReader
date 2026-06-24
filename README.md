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

11. **Image Awareness:**
    * When a page contains images, a banner appears above the reader. Click it (or press **V**) to render that full PDF page in a high-resolution pop-up so you can see what the parser skipped over. The page text is overlaid as a selectable layer, so you can highlight and copy directly from the pop-up.

12. **Hold-to-Read, Rewind, and Progress:**
    * Hold the **Spacebar** to read and release to pause. On pause you get a progress readout (percent through the book plus the current page) and a render of the page you're on. Press the **Left Arrow** to jump back ~100 words.

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
| **Hold Space** | Read while held; release to pause |
| **Left Arrow** | Jump back ~100 words |
| **V** | View the current PDF page in a pop-up |
| **Esc** | Close the page pop-up |

The **GO! / Pause** button toggles reading as an alternative to holding Space. When you pause, you'll see your progress (percent and page number) and a render of the current page.

### Tuning the PDF parser

PDF parsing is heuristic. If too much or too little is stripped for your documents, edit the `PARSE_CONFIG` object near the top of [`core.js`](core.js) — it toggles each filter (footnotes, headers/footers, TOC pages, captions, and front matter) and exposes the thresholds. The `skipFrontMatter` filter drops praise/blurb, title, copyright, dedication, and author-bio pages near the start so reading begins at the real content (e.g. the foreword/preface). The parser logs a summary of what it kept, dropped, and the page it started on to the browser console.
