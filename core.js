// Define all the variables
let textInput;
let speedSelector;
let pauseSpeedSelector;
let chunkSelector;
let fontSizeSelector;
let fontFamilySelector;
let startPauseButton;
let textOutput;
let pdfFileInput;
let pdfStatus;
let imageBanner;
let pauseInfo;
let pageModeToggle;
let progressDock;
let progressPageLabel;
let progressDetail;
let progressPageFill;
let progressDocFill;
let progressDocTicks;
let progressDocTrack;
let isReading = false;
var isPaused = false;
var userInteracted = false;

// Prepared-document state (filled once per loaded PDF / text, reused for playback)
let pdfDoc = null;              // live pdf.js document, kept for page rendering
let sourceWords = [];           // extracted words as-is, before any page-mode expansion
let chunks = [];                // [[{text,page}, ...], ...]
let chunkTexts = [];            // pre-joined display string per chunk (no per-tick work)
let chunkWordLists = [];        // pre-split word strings per chunk (for Bionic display)
let chunkSpecial = [];          // pre-computed "needs punctuation pause" flag per chunk
let chunkPages = [];            // page number for each chunk (page of its first word)
let chunkStartWord = [];        // cumulative word index at the start of each chunk
let chunkY = [];                // PDF y of each chunk's first word (lightbox marker)
let chunkLineHeight = [];       // font height of that line, for the marker's thickness
let chunkSrcPages = [];         // page the chunk's words physically sit on
let pageRuns = [];              // [{ page, startWord, endWord }] one run per page of playback
let chunkRun = [];              // index into pageRuns for each chunk (O(1) progress lookup)
let totalWords = 0;
let numPages = 0;
let pageImageCounts = {};       // { pageNum: imageCount }
let pageCodeCounts = {};        // { pageNum: codeBlockCount }
let pageCodeRects = {};         // { pageNum: [{ top, bottom, left, right }] } in PDF coords
let documentReady = false;

// Page-at-a-time mode: playback is cut into one segment per page, each starting at
// the top-of-page sentence and running to the end of the last sentence on the page.
let pageMode = false;
let pageSegments = [];          // [{ page, startChunk, endChunk }] (endChunk inclusive)
let currentSegmentIndex = 0;
let segmentComplete = false;    // this page is read out; the next Space moves on

// Playback position
let currentChunkIndex = 0;
let currentWordIndex = 0;
let currentPage = null;
let currentY = null;            // PDF y of the line being read (for the lightbox marker)
let currentLineHeight = 0;
let currentSrcPage = null;      // page the current words physically sit on
let lastBannerPage = null;      // page the image banner currently reflects (avoids per-tick DOM writes)
let rafId = null;               // requestAnimationFrame handle for the reading loop
let nextWordTime = 0;           // timestamp (ms) at which the next chunk should appear
let spaceHeld = false;

// Cached control values so the reading loop never reads the DOM per word
let currentSpeed = 300;
let currentPauseFactor = 3;

// Matches punctuation/numbers/URLs that warrant an extra pause. No `g` flag so
// `.test()` stays stateless and this can be reused without recompiling per tick.
const SPECIAL_CHAR_REGEX = /(\d+(\.\d+)?|[.,!?'"`\n]|https?:\/\/[^\s]+|\s{2,})/;

// Define default minimum values
const DEFAULT_VALUES = {
  speed: 300,              // Minimum speed (WPM)
  pauseSpeed: 3,         // Minimum pause factor
  chunkSize: 1,            // Minimum chunk size
  fontSize: 25,            // Minimum font size
  fontFamily: 'sans-serif' // Default font family
};
const textOutputElement = document.getElementById('textOutput');

// Hardcoded default PDF path, loaded on startup. The file picker can replace it.
const PDF_PATH = './test.pdf';
const WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Tunable heuristics for intelligent PDF parsing. All filters are best-effort:
// pdf.js exposes font size + position but not semantic structure, so adjust these
// thresholds against real documents and watch the console log of dropped content.
const PARSE_CONFIG = {
  dropFootnotes: true,        // small font + bottom-of-page text
  dropHeadersFooters: true,   // text repeated in top/bottom band across pages
  skipTocPages: true,         // pages dominated by dot-leaders / trailing page numbers
  dropCaptions: true,         // lines like "Figure 1: ..." / "Table 2 ..."
  skipFrontMatter: true,      // skip praise/blurbs/title/copyright; start at the first section heading
  dropCodeBlocks: true,       // monospace runs (code samples in a proportional-font doc)
  countImageMasks: false,     // image masks are often decorative vector fills
  footnoteFontRatio: 0.85,    // line font smaller than this * body font => candidate
  footnoteBandFrac: 0.22,     // ...and within this bottom fraction of the page
  edgeBandFrac: 0.07,         // top/bottom band considered header/footer territory
  headerRepeatFrac: 0.30,     // a band line on >30% of pages is a running head/foot
  tocLineFrac: 0.5,           // share of lines looking like TOC entries to skip a page
  tocMinLines: 5,             // ...only on pages with at least this many lines
  codeMonoFrac: 0.6,          // share of a line's characters in a mono font to call it code
  codeMinLines: 1,            // shortest run of mono lines that counts as a code block
  codeDocMonoFrac: 0.6        // if the whole doc is this monospace (an RFC), nothing is "code"
};

// Fonts that signal a code sample. pdf.js reports the real family name via the
// `styles` map returned alongside the text items.
const MONO_FONT_REGEX = /mono|courier|consol|menlo|inconsolata|source\s*code|andale|lucida\s*console|dejavu\s*sans\s*mono|ibm\s*plex\s*mono|fira\s*(code|mono)/i;

// A page taller than this many times its width is a web page printed to PDF, not
// a book page: fit it to width and let the lightbox scroll rather than shrinking
// the whole thing to an unreadable sliver.
const TALL_PAGE_RATIO = 2;

// Ceiling on the lightbox canvas backing store, so a very long web-print page
// can't blow past the browser's canvas limits.
const MAX_CANVAS_PIXELS = 16000000;

// Safe way to update UI elements
function updateUIElement(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = value;
  }
}

function setStatus(message) {
  if (pdfStatus) pdfStatus.textContent = message;
}

// Initialize settings from storage with fallback to defaults
function initializeSettings() {
  console.log("Initializing settings...");

  // First set everything to minimum defaults
  speedSelector.value = DEFAULT_VALUES.speed;
  updateUIElement('speedValue', DEFAULT_VALUES.speed);

  pauseSpeedSelector.value = DEFAULT_VALUES.pauseSpeed;
  updateUIElement('pauseSpeedValue', DEFAULT_VALUES.pauseSpeed);

  chunkSelector.value = DEFAULT_VALUES.chunkSize;
  updateUIElement('chunkValue', DEFAULT_VALUES.chunkSize);

  fontSizeSelector.value = DEFAULT_VALUES.fontSize;
  updateUIElement('fontValue', DEFAULT_VALUES.fontSize);
  textOutput.style.fontSize = DEFAULT_VALUES.fontSize + 'px';

  fontFamilySelector.value = DEFAULT_VALUES.fontFamily;
  textOutputElement.className = '';
  textOutputElement.classList.add('body-' + DEFAULT_VALUES.fontFamily);

  pageMode = false;
  if (pageModeToggle) pageModeToggle.checked = false;

  // Then try to load from localStorage
  try {
    const storedSpeed = localStorage.getItem('speedSelector');
    if (storedSpeed) {
      speedSelector.value = storedSpeed;
      updateUIElement('speedValue', storedSpeed);
    }

    const storedPauseSpeed = localStorage.getItem('pauseSpeedSelector');
    if (storedPauseSpeed) {
      pauseSpeedSelector.value = storedPauseSpeed;
      updateUIElement('pauseSpeedValue', storedPauseSpeed);
    }

    const storedChunkSize = localStorage.getItem('chunkSize');
    if (storedChunkSize) {
      chunkSelector.value = storedChunkSize;
      updateUIElement('chunkValue', storedChunkSize);
    }

    const storedFontSize = localStorage.getItem('fontSize');
    if (storedFontSize) {
      fontSizeSelector.value = storedFontSize;
      updateUIElement('fontValue', storedFontSize);
      textOutput.style.fontSize = storedFontSize + 'px';
    }

    const storedFontFamily = localStorage.getItem('fontFamily');
    if (storedFontFamily) {
      fontFamilySelector.value = storedFontFamily;
      textOutputElement.className = '';
      textOutputElement.classList.add('body-' + storedFontFamily);
    }

    pageMode = localStorage.getItem('pageMode') === '1';
    if (pageModeToggle) pageModeToggle.checked = pageMode;
  } catch (e) {
    console.error("Error loading settings from localStorage:", e);
  }

  // Seed the cached control values from the (possibly restored) inputs
  currentSpeed = parseInt(speedSelector.value) || DEFAULT_VALUES.speed;
  currentPauseFactor = parseFloat(pauseSpeedSelector.value) || DEFAULT_VALUES.pauseSpeed;
  updateReaderHint();
}

// The keyboard hint under the reader changes shape in page mode
function updateReaderHint() {
  const hint = document.getElementById('readerHint');
  if (!hint) return;
  hint.innerHTML = pageMode
    ? 'Hold <kbd>Space</kbd> to read a page · let go for the page image · <kbd>Space</kbd> again for the next page'
    : 'Hold <kbd>Space</kbd> to read · <kbd>&larr;</kbd> rewind 100 words · <kbd>V</kbd> view page';
}

// Set up event listeners for controls
function setupEventListeners() {
  // Speed selector
  speedSelector.addEventListener('input', function() {
    updateUIElement('speedValue', this.value);
    localStorage.setItem('speedSelector', this.value);
    currentSpeed = parseInt(this.value) || DEFAULT_VALUES.speed;
  });

  // Pause speed selector
  pauseSpeedSelector.addEventListener('input', function() {
    updateUIElement('pauseSpeedValue', this.value);
    localStorage.setItem('pauseSpeedSelector', this.value);
    currentPauseFactor = parseFloat(this.value) || DEFAULT_VALUES.pauseSpeed;
  });

  // Chunk size selector - rebuild chunks from the prepared words
  chunkSelector.addEventListener('input', function() {
    updateUIElement('chunkValue', this.value);
    localStorage.setItem('chunkSize', this.value);
    if (sourceWords.length) {
      rebuildPlayback();
      resetPosition();
    }
  });

  // Page-at-a-time toggle - re-cuts the document into per-page segments
  if (pageModeToggle) {
    pageModeToggle.addEventListener('change', function() {
      pageMode = this.checked;
      localStorage.setItem('pageMode', pageMode ? '1' : '0');
      rebuildPlayback();
      resetPosition();
      updateReaderHint();
    });

    // A mouse click would otherwise leave the checkbox focused, where the next
    // Space toggles it back off instead of reading. Keyboard clicks (detail 0)
    // keep focus so the toggle stays operable from the keyboard.
    pageModeToggle.addEventListener('click', function(event) {
      if (event.detail > 0) this.blur();
    });
  }

  // Font size selector
  fontSizeSelector.addEventListener('input', function() {
    updateUIElement('fontValue', this.value);
    textOutput.style.fontSize = this.value + 'px';
    localStorage.setItem('fontSize', this.value);
  });

  // Text input events
  textInput.addEventListener('click', function() {
    userInteracted = true;
  });

  textInput.addEventListener('input', function() {
    userInteracted = true;
  });

  // Font family selector
  fontFamilySelector.addEventListener('change', function() {
    if (this.value) {
      textOutputElement.className = '';
      textOutputElement.classList.add('body-' + this.value);
    }
    localStorage.setItem('fontFamily', this.value);

    // Re-render the current chunk in the new font, if we have one
    if (chunks.length && currentChunkIndex < chunks.length) {
      showChunk(currentChunkIndex);
    }
  });

  // Start/pause button mirrors the spacebar controls
  startPauseButton.addEventListener('click', async function() {
    if (isReading) {
      pause();
    } else {
      await startReading();
    }
  });

  // File picker - load any local PDF, fully client-side
  if (pdfFileInput) {
    pdfFileInput.addEventListener('change', async function() {
      const file = this.files && this.files[0];
      if (!file) return;
      try {
        const data = await file.arrayBuffer();
        await prepareDocumentFromSource({ data }, file.name);
      } catch (error) {
        console.error('Error loading selected PDF:', error);
        setStatus('Could not load that PDF.');
      }
    });
  }

  // Image alert banner opens the page view
  if (imageBanner) {
    imageBanner.addEventListener('click', function() {
      if (currentPage) renderPageModal(currentPage, `Page ${currentPage}`, readingMarker());
    });
  }

  // Global keyboard controls
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
}

// True when the focused element is a typing field we should not hijack
function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT';
}

async function onKeyDown(event) {
  if (isTypingTarget(event.target)) return;

  if (event.code === 'Space') {
    event.preventDefault(); // stop the page from scrolling
    if (spaceHeld) return;  // ignore auto-repeat while held
    spaceHeld = true;
    closeModal();
    const ready = await ensureContent();
    if (!ready) {
      setStatus('No PDF or text to read.');
      return;
    }
    if (spaceHeld && !isReading) {
      // A page that read all the way through hands off to the next one. Letting go
      // part way through a page instead resumes where you stopped, so an early
      // release never skips text you haven't heard yet.
      if (inPageMode() && segmentComplete) advanceSegment();
      startPlayback();
    }
    return;
  }

  if (event.code === 'ArrowLeft') {
    event.preventDefault();
    rewindWords(100);
    return;
  }

  if (event.code === 'KeyV') {
    if (currentPage) renderPageModal(currentPage, `Page ${currentPage}`, readingMarker());
  }
}

function onKeyUp(event) {
  if (event.code === 'Space') {
    spaceHeld = false;
    if (isReading) pause();
  }
}

document.addEventListener('DOMContentLoaded', (event) => {
  // Assign the variables
  textInput = document.getElementById('textInput');
  speedSelector = document.getElementById('speedSelector');
  pauseSpeedSelector = document.getElementById('pauseSpeedSelector');
  chunkSelector = document.getElementById('chunkSize');
  fontSizeSelector = document.getElementById('fontSize');
  fontFamilySelector = document.getElementById('fontFamily');
  startPauseButton = document.getElementById('startPause');
  textOutput = document.getElementById('textOutput');
  pdfFileInput = document.getElementById('pdfFile');
  pdfStatus = document.getElementById('pdfStatus');
  imageBanner = document.getElementById('imageBanner');
  pauseInfo = document.getElementById('pauseInfo');
  pageModeToggle = document.getElementById('pageMode');
  progressDock = document.getElementById('progressDock');
  progressPageLabel = document.getElementById('progressPage');
  progressDetail = document.getElementById('progressDetail');
  progressPageFill = document.getElementById('progressPageFill');
  progressDocFill = document.getElementById('progressDocFill');
  progressDocTicks = document.getElementById('progressDocTicks');
  progressDocTrack = document.getElementById('progressDocTrack');

  if (!textInput || !speedSelector || !pauseSpeedSelector || !chunkSelector ||
      !fontSizeSelector || !fontFamilySelector || !startPauseButton || !textOutput) {
    console.error("Failed to find one or more UI elements!");
    return;
  }

  // Initialize settings and set up event listeners
  initializeSettings();
  setupEventListeners();

  // Extension-specific code - Load extracted text
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['extractedText'], function(result) {
      if (result.extractedText) {
        textInput.value = result.extractedText;
      }
    });
  }

  // Load the default PDF on startup so the reader works out of the box
  prepareDocumentFromSource(PDF_PATH, PDF_PATH).catch((error) => {
    console.log('Default PDF not loaded, falling back to pasted text.', error);
    setStatus('No PDF loaded — choose a PDF or paste text.');
  });
});

//-------------------------------------
// START of word/chunk helpers

// Convert raw pasted text into page-less word objects
function textToWords(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((t) => ({ text: t, page: null }));
}

// Group ordered word objects into chunks, ending a chunk early on a
// sentence-final word so chunks don't straddle sentence boundaries.
// `breaks` (optional) is a Set of word indices where a chunk must start, used by
// page mode so no chunk straddles a page segment.
function buildChunks(words, chunkSize, breaks) {
  const result = [];
  let i = 0;
  while (i < words.length) {
    let chunkEnd = Math.min(i + chunkSize, words.length);

    if (breaks) {
      for (let j = i + 1; j < chunkEnd; j++) {
        if (breaks.has(j)) {
          chunkEnd = j;
          break;
        }
      }
    }

    // A chunk that runs its full length and lands on a sentence-final word needs
    // no trimming; anything shorter (end of document, or a hard break) is rescanned.
    const isFullSize = chunkEnd === i + chunkSize;
    if (!(isFullSize && /[.!?]$/.test(words[chunkEnd - 1]?.text || ''))) {
      const slice = words.slice(i, chunkEnd);
      const nextPunctuationIndex = slice.findIndex((w) => /[.!?]$/.test(w.text));
      if (nextPunctuationIndex !== -1) {
        chunkEnd = i + nextPunctuationIndex + 1;
      }
    }

    const chunk = words.slice(i, chunkEnd);
    if (!chunk.length) break;
    result.push(chunk);
    i += chunk.length;
  }
  return result;
}

// Words ending in a period that usually aren't ending a sentence
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'rev', 'hon', 'gen', 'col', 'lt', 'sgt', 'capt',
  'vs', 'etc', 'al', 'ca', 'cf', 'eg', 'ie', 'inc', 'ltd', 'co', 'corp', 'dept', 'est',
  'fig', 'figs', 'no', 'nos', 'vol', 'vols', 'ch', 'chap', 'pp', 'ed', 'eds', 'trans', 'approx',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'
]);

// Give up looking for a sentence boundary after this many words, so a page of
// punctuation-free text (a table, a poem) can't drag in half the document.
const MAX_SENTENCE_SCAN = 250;

// Heuristic sentence-boundary test over the token stream. pdf.js hands us words,
// not sentences, so this stays conservative: when a period is ambiguous (an
// abbreviation, an initial, a list number, a lowercase word next) we treat the
// sentence as continuing.
function isSentenceEnd(token, nextToken) {
  if (!token) return false;
  const trimmed = token.replace(/[)\]}"'”’»]+$/, ''); // closing quotes/brackets ride along
  if (!/[.!?]$/.test(trimmed)) return false;
  if (/[!?]$/.test(trimmed)) return true;

  const body = trimmed.slice(0, -1);
  if (/^[A-Z]$/.test(body)) return false;                 // an initial, e.g. "J."
  if (/^\d+$/.test(body)) return false;                   // a list number, e.g. "1."
  if (/^([A-Za-z]\.)+[A-Za-z]$/.test(body)) return false; // "e.g." / "U.S."
  if (ABBREVIATIONS.has(body.toLowerCase().replace(/[^a-z]/g, ''))) return false;
  if (nextToken && /^[a-z]/.test(nextToken)) return false; // the sentence clearly runs on
  return true;
}

// Cut the word stream into one segment per page. A segment starts at the first
// word of the sentence that opens the page (reaching back into the previous page
// when that sentence started there) and ends at the end of the last sentence the
// page begins (reaching forward into the next page to finish it). Sentences that
// straddle a page boundary therefore appear in both neighbouring segments, so the
// words are re-emitted into a new array rather than indexed in place.
function buildPageSegments(words) {
  // Page runs are contiguous: extraction walks the document page by page.
  const runs = [];
  for (let i = 0; i < words.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.page === words[i].page) {
      last.end = i;
    } else {
      runs.push({ page: words[i].page, start: i, end: i });
    }
  }

  const expanded = [];
  const segments = [];
  for (const run of runs) {
    let start = run.start;
    const backStop = Math.max(0, run.start - MAX_SENTENCE_SCAN);
    while (start > backStop && !isSentenceEnd(words[start - 1].text, words[start].text)) {
      start--;
    }

    let end = run.end;
    const forwardStop = Math.min(words.length - 1, run.end + MAX_SENTENCE_SCAN);
    while (end < forwardStop && !isSentenceEnd(words[end].text, words[end + 1].text)) {
      end++;
    }

    const startWord = expanded.length;
    for (let i = start; i <= end; i++) {
      // Stamp every word with the segment's page so the banner and the lightbox
      // follow the page being read, not the page a borrowed sentence came from.
      // `srcPage` keeps the page the word physically sits on, which the lightbox
      // marker needs so a borrowed sentence doesn't point at the wrong spot.
      expanded.push({
        text: words[i].text,
        page: run.page,
        srcPage: words[i].srcPage != null ? words[i].srcPage : words[i].page,
        y: words[i].y,
        h: words[i].h
      });
    }
    segments.push({ page: run.page, startWord, endWord: expanded.length });
  }

  return { words: expanded, segments };
}

// Translate segment word ranges into chunk ranges. Every segment boundary was fed
// to buildChunks as a hard break, so each one lands exactly on a chunk start.
function mapSegmentsToChunks(segments) {
  const chunkAtWord = new Map();
  for (let i = 0; i < chunkStartWord.length; i++) {
    chunkAtWord.set(chunkStartWord[i], i);
  }

  const mapped = [];
  for (const segment of segments) {
    const startChunk = chunkAtWord.get(segment.startWord);
    if (startChunk === undefined) continue;
    const nextChunk = chunkAtWord.has(segment.endWord) ? chunkAtWord.get(segment.endWord) : chunks.length;
    mapped.push({ page: segment.page, startChunk, endChunk: nextChunk - 1 });
  }
  return mapped;
}

// Rebuild chunks + derived indices from a flat word array. Everything the
// per-word reading loop needs (display text, word lists, pause flag, page) is
// computed once here so playback does no string/regex work per tick.
function rebuildChunks(words, breaks) {
  const chunkSize = parseInt(chunkSelector.value) || 1;
  chunks = buildChunks(words, chunkSize, breaks);
  chunkTexts = [];
  chunkWordLists = [];
  chunkSpecial = [];
  chunkPages = [];
  chunkStartWord = [];
  chunkY = [];
  chunkLineHeight = [];
  chunkSrcPages = [];
  pageRuns = [];
  chunkRun = [];
  let running = 0;
  for (const chunk of chunks) {
    const wordList = chunk.map((w) => w.text);
    const text = wordList.join(' ');
    const first = chunk[0];
    chunkWordLists.push(wordList);
    chunkTexts.push(text);
    chunkSpecial.push(SPECIAL_CHAR_REGEX.test(text));
    chunkStartWord.push(running);
    chunkPages.push(first ? first.page : null);
    chunkY.push(first && first.y != null ? first.y : null);
    chunkLineHeight.push(first && first.h ? first.h : 0);
    chunkSrcPages.push(first ? (first.srcPage != null ? first.srcPage : first.page) : null);

    // Track the word span of each page so the progress dock can show how far
    // through the current page we are without searching per tick. In page mode
    // these runs line up with the page segments; otherwise with the real pages.
    const page = first ? first.page : null;
    let run = pageRuns[pageRuns.length - 1];
    if (!run || run.page !== page) {
      run = { page, startWord: running, endWord: running };
      pageRuns.push(run);
    }
    run.endWord = running + chunk.length;
    chunkRun.push(pageRuns.length - 1);

    running += chunk.length;
  }
  totalWords = running;
}

// Turn the extracted words into the playback stream, applying page mode if it is
// on and the source actually has pages (pasted text doesn't).
function rebuildPlayback() {
  if (!sourceWords.length) return;

  if (pageMode && sourceWords.some((w) => w.page != null)) {
    const { words, segments } = buildPageSegments(sourceWords);
    rebuildChunks(words, new Set(segments.map((s) => s.startWord)));
    pageSegments = mapSegmentsToChunks(segments);
  } else {
    rebuildChunks(sourceWords, null);
    pageSegments = [];
  }
  buildProgressTicks();
}

// Page mode is active only when we actually managed to cut the document into pages
function inPageMode() {
  return pageMode && pageSegments.length > 0;
}

function resetPosition() {
  stopTimer();
  isReading = false;
  isPaused = false;
  currentChunkIndex = 0;
  currentWordIndex = 0;
  currentSegmentIndex = 0;
  segmentComplete = false;
  lastBannerPage = null;
  if (startPauseButton) startPauseButton.textContent = 'GO!';
  hidePauseInfo();
  setProgressReading(false);
  showProgressDock(chunks.length > 0);
  if (chunks.length) {
    showChunk(0);
  } else {
    textOutput.textContent = 'Your text will appear here...';
  }
}
// END of word/chunk helpers
//-------------------------------------

//-------------------------------------
// START of PDF extraction + filtering

// Normalize a line for cross-page repetition matching (page numbers -> '#')
function normalizeLine(text) {
  return text.trim().toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
}

function isPageNumberLine(text) {
  const t = text.trim();
  return /^\d{1,4}$/.test(t) || /^[ivxlcdm]+$/i.test(t);
}

function looksLikeTocLine(text) {
  return /\.{3,}/.test(text) || /\.\s\.\s\./.test(text) || /\s\d{1,4}\s*$/.test(text);
}

function looksLikeCaption(text) {
  return /^\s*(figure|fig\.?|table|plate|chart|image|exhibit)\s*\d/i.test(text);
}

// Front-matter junk we want to skip so reading starts at the real content
// (around the preface/foreword) instead of praise blurbs, the title page, or the
// copyright page. Detected per page since book headings are often unmatchable
// (e.g. letter-spaced display type like "B L A C K  H AT").
function isFrontMatterPage(lines, bodyFont) {
  const joined = lines.map((l) => l.text).join('  ');
  const maxFont = lines.reduce((m, l) => Math.max(m, l.fontHeight), 0);
  const wordCount = joined.split(/\s+/).filter(Boolean).length;

  // Praise / blurb pages ("Praise for ...", "Advance praise for ...")
  const isPraise = /\b(praise|acclaim)\s+for\b|advance praise/i.test(joined);
  // Copyright / publication pages
  const isCopyright = /\ball rights reserved\b|copyright\s*[©(]|\bisbn\b|library of congress/i.test(joined);
  // Author bio pages ("About the Authors", "About the Technical Reviewer")
  const isAboutAuthor = lines.some((l) => /^about the (author|technical|contributor|editor)/i.test(l.text.trim()));
  // Title / half-title pages: a few lines dominated by very large display type
  const isTitlePage = bodyFont > 0 && maxFont >= bodyFont * 2.2 && lines.length <= 10;
  // Dedication / epigraph: a near-empty page near the front of the book
  const isShortFrontPage = wordCount > 0 && wordCount < 25;

  return isPraise || isCopyright || isAboutAuthor || isTitlePage || isShortFrontPage;
}

// Read one page's text into y-grouped lines with font metadata
async function getPageLines(page) {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const styles = textContent.styles || {};
  const buckets = new Map();

  for (const item of textContent.items) {
    if (!item.str) continue;
    const tr = item.transform;
    const y = tr[5];
    const fontHeight = Math.abs(tr[3]) || item.height || 0;
    const key = Math.round(y / 2) * 2; // merge baselines within ~2px
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { y, items: [], fhSum: 0, fhN: 0, chars: 0, monoChars: 0 };
      buckets.set(key, bucket);
    }
    bucket.items.push({ x: tr[4], str: item.str, w: item.width || 0 });
    bucket.fhSum += fontHeight;
    bucket.fhN += 1;

    // Font family drives code-block detection; pdf.js only exposes it via `styles`
    const style = styles[item.fontName];
    const family = (style && style.fontFamily) || item.fontName || '';
    bucket.chars += item.str.length;
    if (MONO_FONT_REGEX.test(family)) bucket.monoChars += item.str.length;
  }

  const lines = [];
  for (const bucket of buckets.values()) {
    bucket.items.sort((a, b) => a.x - b.x);
    const text = bucket.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    lines.push({
      y: bucket.y,
      text,
      fontHeight: bucket.fhN ? bucket.fhSum / bucket.fhN : 0,
      chars: bucket.chars,
      monoChars: bucket.monoChars,
      xMin: Math.min(...bucket.items.map((it) => it.x)),
      xMax: Math.max(...bucket.items.map((it) => it.x + it.w))
    });
  }
  // Top of page first (PDF origin is bottom-left, so larger y is higher up)
  lines.sort((a, b) => b.y - a.y);
  return { lines, height: viewport.height, width: viewport.width };
}

// Group a page's consecutive monospace lines into code blocks. Returns a flag per
// line (so the caller can drop those words) plus the block rectangles in PDF
// coordinates, which the lightbox draws so you can find the code you skipped.
function findCodeBlocks(lines, docIsMono) {
  const flags = lines.map(() => false);
  const blocks = [];
  if (!PARSE_CONFIG.dropCodeBlocks || docIsMono) return { flags, blocks };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    flags[i] = line.chars > 0 && line.monoChars / line.chars >= PARSE_CONFIG.codeMonoFrac;
  }

  for (let i = 0; i < lines.length; i++) {
    if (!flags[i]) continue;
    let end = i;
    while (end + 1 < lines.length && flags[end + 1]) end++;
    const run = lines.slice(i, end + 1);

    if (run.length >= PARSE_CONFIG.codeMinLines) {
      blocks.push({
        top: Math.max(...run.map((l) => l.y + l.fontHeight)),
        bottom: Math.min(...run.map((l) => l.y - l.fontHeight * 0.3)),
        left: Math.min(...run.map((l) => l.xMin)),
        right: Math.max(...run.map((l) => l.xMax)),
        lines: run.length
      });
    } else {
      for (let k = i; k <= end; k++) flags[k] = false; // too short to count as a block
    }
    i = end;
  }

  return { flags, blocks };
}

// Count image-paint operations on a page
async function countPageImages(page) {
  const OPS = pdfjsLib.OPS;
  try {
    const opList = await page.getOperatorList();
    let count = 0;
    for (const fn of opList.fnArray) {
      if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintJpegXObject ||
        fn === OPS.paintInlineImageXObject ||
        (PARSE_CONFIG.countImageMasks && fn === OPS.paintImageMaskXObject)
      ) {
        count += 1;
      }
    }
    return count;
  } catch (e) {
    return 0;
  }
}

// Extract filtered body words + per-page image counts from a pdf.js document
async function extractStructuredPDF(doc) {
  const pageData = [];
  const imageCounts = {};
  const fontHistogram = new Map();
  let docChars = 0;
  let docMonoChars = 0;

  // Pass 1: collect lines, image counts, and a body-font histogram
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const { lines, height, width } = await getPageLines(page);
    imageCounts[pageNum] = await countPageImages(page);
    pageData.push({ pageNum, lines, height, width });

    for (const line of lines) {
      const fh = Math.round(line.fontHeight);
      if (fh > 0) {
        fontHistogram.set(fh, (fontHistogram.get(fh) || 0) + line.text.length);
      }
      docChars += line.chars;
      docMonoChars += line.monoChars;
    }
  }

  // A document that is monospace throughout (a plain-text RFC, a code listing) has
  // no "code font" to single out — treating it as code would drop the whole thing.
  const docIsMono = docChars > 0 && docMonoChars / docChars > PARSE_CONFIG.codeDocMonoFrac;

  // Dominant body font height = most common rounded height, weighted by characters
  let bodyFont = 0;
  let bestWeight = -1;
  for (const [fh, weight] of fontHistogram.entries()) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bodyFont = fh;
    }
  }

  // Detect running headers/footers: normalized text repeated in the edge bands
  const bandCounts = new Map();
  for (const { lines, height } of pageData) {
    const topY = height * (1 - PARSE_CONFIG.edgeBandFrac);
    const bottomY = height * PARSE_CONFIG.edgeBandFrac;
    const seen = new Set();
    for (const line of lines) {
      if (line.y >= topY || line.y <= bottomY) {
        const norm = normalizeLine(line.text);
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          bandCounts.set(norm, (bandCounts.get(norm) || 0) + 1);
        }
      }
    }
  }
  const repeatedHeaders = new Set();
  const repeatThreshold = Math.max(2, doc.numPages * PARSE_CONFIG.headerRepeatFrac);
  for (const [norm, count] of bandCounts.entries()) {
    if (count >= repeatThreshold) repeatedHeaders.add(norm);
  }

  // Pass 2: filter lines into body words
  const words = [];
  const codeCounts = {};
  const codeRects = {};
  const dropped = { footnote: 0, header: 0, caption: 0, code: 0, tocPages: 0, frontMatterPages: 0, allCodePages: 0 };
  // Only treat the front slice of the book as candidate front matter, so a large
  // chapter-title page deep in the body is never mistaken for a title page.
  const frontLimit = Math.ceil(doc.numPages * 0.15);

  for (const { pageNum, lines, height } of pageData) {
    // Code blocks are found before the other filters so a listing that runs into
    // the footnote band is still recognised as code rather than a footnote.
    const { flags: codeFlags, blocks: codeBlocks } = findCodeBlocks(lines, docIsMono);
    codeCounts[pageNum] = codeBlocks.length;
    if (codeBlocks.length) codeRects[pageNum] = codeBlocks;

    // Whole-page TOC skip
    if (PARSE_CONFIG.skipTocPages && lines.length >= PARSE_CONFIG.tocMinLines) {
      const tocHits = lines.filter((l) => looksLikeTocLine(l.text)).length;
      const hasContentsHeading = lines.some((l) => /^(table of )?contents$/i.test(l.text.trim()));
      if (hasContentsHeading || tocHits / lines.length > PARSE_CONFIG.tocLineFrac) {
        dropped.tocPages += 1;
        continue;
      }
    }

    // Skip praise/blurb, copyright, and title pages near the front of the book
    if (PARSE_CONFIG.skipFrontMatter && pageNum <= frontLimit && isFrontMatterPage(lines, bodyFont)) {
      dropped.frontMatterPages += 1;
      continue;
    }

    const footnoteBand = height * PARSE_CONFIG.footnoteBandFrac;
    const topY = height * (1 - PARSE_CONFIG.edgeBandFrac);
    const bottomY = height * PARSE_CONFIG.edgeBandFrac;
    const wordsBeforePage = words.length;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const inEdgeBand = line.y >= topY || line.y <= bottomY;

      if (codeFlags[lineIndex]) {
        dropped.code += 1;
        continue;
      }

      if (PARSE_CONFIG.dropHeadersFooters && inEdgeBand &&
          (repeatedHeaders.has(normalizeLine(line.text)) || isPageNumberLine(line.text))) {
        dropped.header += 1;
        continue;
      }

      if (PARSE_CONFIG.dropFootnotes && bodyFont > 0 &&
          line.fontHeight < bodyFont * PARSE_CONFIG.footnoteFontRatio &&
          line.y <= footnoteBand) {
        dropped.footnote += 1;
        continue;
      }

      if (PARSE_CONFIG.dropCaptions && looksLikeCaption(line.text)) {
        dropped.caption += 1;
        continue;
      }

      for (const token of line.text.split(' ')) {
        // y/h ride along so the lightbox can mark the line being read
        if (token) {
          words.push({ text: token, page: pageNum, srcPage: pageNum, y: line.y, h: line.fontHeight });
        }
      }
    }

    // A page that is nothing but code has no words left to read, so playback never
    // visits it and its banner never fires. Worth knowing about when tuning.
    if (words.length === wordsBeforePage && codeBlocks.length) {
      dropped.allCodePages += 1;
    }
  }

  console.log('PDF parse summary:', {
    pages: doc.numPages,
    bodyFontHeight: bodyFont,
    keptWords: words.length,
    dropped,
    startsOnPage: words[0] ? words[0].page : null,
    pagesWithImages: Object.values(imageCounts).filter((c) => c > 0).length,
    documentIsMonospace: docIsMono,
    pagesWithCode: Object.values(codeCounts).filter((c) => c > 0).length
  });

  return { words, pageImageCounts: imageCounts, pageCodeCounts: codeCounts, pageCodeRects: codeRects };
}

// Load a PDF (from a URL string or { data } ArrayBuffer) and prepare it for reading
async function prepareDocumentFromSource(source, label) {
  setStatus('Loading PDF…');
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;

  const loadingTask = pdfjsLib.getDocument(source);
  const doc = await loadingTask.promise;
  pdfDoc = doc;
  numPages = doc.numPages;

  const extracted = await extractStructuredPDF(doc);
  pageImageCounts = extracted.pageImageCounts;
  pageCodeCounts = extracted.pageCodeCounts;
  pageCodeRects = extracted.pageCodeRects;
  sourceWords = extracted.words;
  rebuildPlayback();
  resetPosition();
  documentReady = true;

  const name = label ? label.replace(/^\.\//, '') : 'PDF';
  setStatus(`${name} — ${totalWords.toLocaleString()} words, ${numPages} pages.`);
}
// END of PDF extraction + filtering
//-------------------------------------

//-------------------------------------
// START of playback

// Make sure we have something to read; fall back to the textarea if no PDF
async function ensureContent() {
  if (documentReady && chunks.length && !userInteracted) return true;

  const text = textInput.value;
  if (text && text.trim()) {
    pdfDoc = null;
    numPages = 0;
    pageImageCounts = {};
    pageCodeCounts = {};
    pageCodeRects = {};
    sourceWords = textToWords(text);
    rebuildPlayback();
    resetPosition();
    documentReady = true;
    userInteracted = false;
    setStatus(`Pasted text — ${totalWords.toLocaleString()} words.`);
    return chunks.length > 0;
  }

  return documentReady && chunks.length > 0;
}

function stopTimer() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// Compute the display delay for a chunk using pre-cached length + pause flag
function chunkDelay(index) {
  const length = chunks[index].length;
  let delay = (length / currentSpeed) * 60000;
  if (chunkSpecial[index]) {
    delay += (60000 / currentSpeed) * currentPauseFactor;
  }
  return delay;
}

// Render a single chunk to the output (no scheduling, no index advance)
function showChunk(index) {
  if (!chunks[index]) return;
  currentPage = chunkPages[index];
  currentY = chunkY[index];
  currentLineHeight = chunkLineHeight[index];
  currentSrcPage = chunkSrcPages[index];
  updatePageBanner(currentPage);
  updateProgress(index);

  if (fontFamilySelector.value === 'Bionic') {
    displayBionicText(chunkWordLists[index]);
  } else {
    textOutput.textContent = chunkTexts[index];
  }
}

// The reading loop, driven by requestAnimationFrame so word changes are synced to
// the display refresh. Using a timestamp target (instead of setTimeout) avoids the
// timer drift / sub-frame jitter that makes fast reading feel laggy.
function tick(now) {
  if (!isReading) return;
  if (now >= nextWordTime) {
    // In page mode, stop at the page boundary even if Space is still held. The
    // check happens here (rather than right after the last chunk is drawn) so the
    // final chunk of the page gets its full display time first.
    if (inPageMode()) {
      const segment = pageSegments[currentSegmentIndex];
      if (segment && currentChunkIndex > segment.endChunk) {
        finishSegment();
        return;
      }
    }
    if (currentChunkIndex >= chunks.length) {
      finishReading();
      return;
    }
    showChunk(currentChunkIndex);
    currentWordIndex = chunkStartWord[currentChunkIndex] + chunks[currentChunkIndex].length;
    nextWordTime = now + chunkDelay(currentChunkIndex);
    currentChunkIndex++;
  }
  rafId = requestAnimationFrame(tick);
}

function startPlayback() {
  hidePauseInfo();
  closeModal();
  isReading = true;
  isPaused = false;
  setProgressReading(true);
  startPauseButton.textContent = 'Pause';
  stopTimer();
  nextWordTime = 0; // show the first chunk on the very next frame
  rafId = requestAnimationFrame(tick);
}

// Used by the GO button (button needs to prepare content first)
async function startReading() {
  const ready = await ensureContent();
  if (!ready) {
    textOutput.textContent = 'Please choose a PDF or enter text.';
    return;
  }
  if (inPageMode() && segmentComplete) advanceSegment();
  startPlayback();
}

function pause() {
  isReading = false;
  isPaused = true;
  spaceHeld = false;
  stopTimer();
  setProgressReading(false);
  startPauseButton.textContent = 'Start';
  showPauseView();
}

function finishReading() {
  isReading = false;
  stopTimer();
  setProgressReading(false);
  startPauseButton.textContent = 'GO!';
  currentChunkIndex = 0;
  currentWordIndex = 0;
  currentSegmentIndex = 0;
  segmentComplete = false;
}

// Reached the end of a page in page mode: park here and show the page image
function finishSegment() {
  isReading = false;
  isPaused = true;
  segmentComplete = true;
  stopTimer();
  setProgressReading(false);
  startPauseButton.textContent = 'Next page';
  showPauseView();
}

function jumpToSegment(index) {
  currentSegmentIndex = index;
  segmentComplete = false;
  const segment = pageSegments[index];
  currentChunkIndex = segment.startChunk;
  currentWordIndex = chunkStartWord[segment.startChunk];
}

// Move on after a finished page, wrapping back to the first page at the end
function advanceSegment() {
  const next = currentSegmentIndex + 1;
  jumpToSegment(next < pageSegments.length ? next : 0);
}

function segmentIndexForChunk(chunkIndex) {
  for (let i = 0; i < pageSegments.length; i++) {
    if (chunkIndex <= pageSegments[i].endChunk) return i;
  }
  return Math.max(0, pageSegments.length - 1);
}

// Jump back roughly n words and show the landing chunk
function rewindWords(n) {
  if (!chunks.length) return;
  const target = Math.max(0, currentWordIndex - n);
  let idx = 0;
  while (idx < chunkStartWord.length - 1 && chunkStartWord[idx + 1] <= target) {
    idx++;
  }
  currentChunkIndex = idx;
  currentWordIndex = chunkStartWord[idx];
  showChunk(idx);

  // Rewinding can cross back into an earlier page; follow it there
  if (inPageMode()) {
    currentSegmentIndex = segmentIndexForChunk(idx);
    segmentComplete = false;
  }

  if (isReading) {
    // advance past the shown chunk; the rAF loop (still running) continues from here
    currentWordIndex = chunkStartWord[idx] + chunks[idx].length;
    currentChunkIndex = idx + 1;
    nextWordTime = performance.now() + chunkDelay(idx);
  }
}

// Where the reader has got to on the page, for the lightbox marker
function readingMarker() {
  if (currentY == null) return null;
  return { y: currentY, h: currentLineHeight, srcPage: currentSrcPage };
}

function progressPercent() {
  if (!totalWords) return 0;
  return Math.round((currentWordIndex / totalWords) * 100);
}

// Show where we are on pause: progress readout + (if a PDF) the real page
function showPauseView() {
  const percent = progressPercent();
  let label;
  if (segmentComplete && currentPage) {
    label = `End of page ${currentPage} of ${numPages} · Space for the next page`;
  } else if (currentPage) {
    label = `${percent}% · page ${currentPage} of ${numPages}`;
  } else {
    label = `${percent}% read`;
  }

  if (pauseInfo) {
    pauseInfo.textContent = label;
    pauseInfo.style.display = 'block';
  }
  if (pdfDoc && currentPage) {
    renderPageModal(currentPage, label, readingMarker());
  }
}

function hidePauseInfo() {
  if (pauseInfo) pauseInfo.style.display = 'none';
}
// END of playback
//-------------------------------------

//-------------------------------------
// START of progress dock

// Last values written to the dock. The reading loop calls updateProgress on every
// chunk, so each field is only touched when it actually changed.
let lastPageFillPct = -1;
let lastDocFillPct = -1;
let lastPageLabelText = null;
let lastDetailText = null;

function clamp01(value) {
  if (!(value > 0)) return 0;   // also catches NaN
  return value > 1 ? 1 : value;
}

function showProgressDock(show) {
  if (!progressDock) return;
  progressDock.hidden = !show;
  document.body.classList.toggle('hasProgressDock', show);
}

// The travelling sheen runs only while words are actually moving
function setProgressReading(reading) {
  if (progressPageFill) progressPageFill.classList.toggle('isReading', reading);
}

// One tick per page boundary on the document track, so the bar reads as a map of
// the document rather than a featureless line. Skipped when the pages are too
// many to tell apart.
function buildProgressTicks() {
  lastPageFillPct = -1;
  lastDocFillPct = -1;
  lastPageLabelText = null;
  lastDetailText = null;
  if (!progressDocTicks) return;

  // A single-page document (a web page printed to one long sheet) would show two
  // identical bars, so the document track only appears once there is more than one page.
  if (progressDocTrack) progressDocTrack.hidden = pageRuns.length < 2;

  progressDocTicks.innerHTML = '';
  if (!totalWords || pageRuns.length < 2 || pageRuns.length > 80) return;

  for (let i = 1; i < pageRuns.length; i++) {
    const tick = document.createElement('span');
    tick.style.left = (pageRuns[i].startWord / totalWords) * 100 + '%';
    progressDocTicks.appendChild(tick);
  }
}

// Update the dock for the chunk just shown
function updateProgress(index) {
  if (!progressDock || !chunks[index]) return;

  const wordsRead = chunkStartWord[index] + chunks[index].length;
  const run = pageRuns[chunkRun[index]];
  const docFrac = clamp01(totalWords ? wordsRead / totalWords : 0);
  const runLength = run ? run.endWord - run.startWord : 0;
  const pageFrac = runLength ? clamp01((wordsRead - run.startWord) / runLength) : docFrac;

  // Tenth-of-a-percent resolution is finer than the bar can show, and keeps the
  // style writes down to one per visible step.
  const pagePct = Math.round(pageFrac * 1000) / 10;
  if (pagePct !== lastPageFillPct) {
    lastPageFillPct = pagePct;
    if (progressPageFill) progressPageFill.style.width = pagePct + '%';
  }
  const docPct = Math.round(docFrac * 1000) / 10;
  if (docPct !== lastDocFillPct) {
    lastDocFillPct = docPct;
    if (progressDocFill) progressDocFill.style.width = docPct + '%';
  }

  const page = run ? run.page : null;
  const counts = `${wordsRead.toLocaleString()} / ${totalWords.toLocaleString()} words`;
  let pageLabel;
  let detail;
  if (page != null) {
    pageLabel = numPages ? `Page ${page} of ${numPages}` : `Page ${page}`;
    detail = `${Math.round(pageFrac * 100)}% of page · ${counts}`;
  } else {
    pageLabel = 'Pasted text';
    detail = `${Math.round(docFrac * 100)}% · ${counts}`;
  }

  if (pageLabel !== lastPageLabelText) {
    lastPageLabelText = pageLabel;
    if (progressPageLabel) progressPageLabel.textContent = pageLabel;
  }
  if (detail !== lastDetailText) {
    lastDetailText = detail;
    if (progressDetail) progressDetail.textContent = detail;
  }
}
// END of progress dock
//-------------------------------------

//-------------------------------------
// START of image banner + page modal

// Flag anything on this page that the reader skipped over: images, and code
// blocks, which are shown in the page view rather than read out.
function updatePageBanner(pageNum) {
  if (!imageBanner) return;
  // Only touch the DOM when the page actually changes — otherwise reassigning
  // textContent/display every word forces a layout reflow and causes hitches.
  if (pageNum === lastBannerPage) return;
  lastBannerPage = pageNum;

  const images = pageNum ? (pageImageCounts[pageNum] || 0) : 0;
  const codeBlocks = pageNum ? (pageCodeCounts[pageNum] || 0) : 0;

  const parts = [];
  if (images > 0) parts.push(`📷 ${images > 1 ? images + ' images' : 'An image'}`);
  if (codeBlocks > 0) parts.push(`⌨️ ${codeBlocks > 1 ? codeBlocks + ' code blocks' : 'A code block'}`);

  if (parts.length) {
    imageBanner.textContent = `${parts.join(' · ')} on this page — press V or click to view`;
    imageBanner.style.display = 'block';
  } else {
    imageBanner.style.display = 'none';
  }
}

let modalEls = null;
let currentRenderTask = null;

function ensureModal() {
  if (modalEls) return modalEls;

  const overlay = document.createElement('div');
  overlay.id = 'pdfModal';
  overlay.className = 'pdfModal';

  const content = document.createElement('div');
  content.className = 'pdfModalContent';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'pdfModalClose';
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeModal);

  // Page wrapper holds the canvas image and a transparent, selectable text layer
  const wrap = document.createElement('div');
  wrap.className = 'pdfPageWrap';

  const canvas = document.createElement('canvas');
  canvas.className = 'pdfModalCanvas';

  const textLayer = document.createElement('div');
  textLayer.className = 'textLayer';

  // Non-interactive overlay for the reading-position marker and code-block boxes,
  // stacked above the text layer so it never blocks selection or copying.
  const markLayer = document.createElement('div');
  markLayer.className = 'pdfMarkLayer';

  const caption = document.createElement('div');
  caption.className = 'pdfModalCaption';

  wrap.appendChild(canvas);
  wrap.appendChild(textLayer);
  wrap.appendChild(markLayer);
  content.appendChild(closeBtn);
  content.appendChild(wrap);
  content.appendChild(caption);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
  });

  modalEls = { overlay, content, wrap, canvas, textLayer, markLayer, caption };
  return modalEls;
}

function closeModal() {
  if (modalEls) modalEls.overlay.style.display = 'none';
}

// Map a point from PDF space (origin bottom-left) into viewport/CSS space
// (origin top-left), honouring page rotation when pdf.js exposes the converter.
function convertPoint(viewport, x, y) {
  if (typeof viewport.convertToViewportPoint === 'function') {
    const point = viewport.convertToViewportPoint(x, y);
    return { x: point[0], y: point[1] };
  }
  const scale = viewport.scale || 1;
  return { x: x * scale, y: viewport.height - y * scale };
}

// Draw the code-block outlines and the reading-position marker over the page.
// Returns the marker's top offset in CSS px so the caller can scroll to it.
function drawPageMarks(markLayer, viewport, pageHeight, pageNum, marker) {
  markLayer.innerHTML = '';
  markLayer.style.width = viewport.width + 'px';
  markLayer.style.height = viewport.height + 'px';

  for (const rect of pageCodeRects[pageNum] || []) {
    const a = convertPoint(viewport, rect.left, rect.top);
    const b = convertPoint(viewport, rect.right, rect.bottom);
    const box = document.createElement('div');
    box.className = 'pdfCodeBox';
    box.style.left = Math.min(a.x, b.x) + 'px';
    box.style.top = Math.min(a.y, b.y) + 'px';
    box.style.width = Math.abs(b.x - a.x) + 'px';
    box.style.height = Math.abs(b.y - a.y) + 'px';
    markLayer.appendChild(box);
  }

  if (!marker || marker.y == null) return null;

  // A sentence borrowed across a page break is read while a different page is on
  // screen; pin the marker to the edge it ran off rather than a bogus position.
  let markY = marker.y;
  if (marker.srcPage != null && pageNum != null) {
    if (marker.srcPage > pageNum) markY = 0;                 // read on past the bottom
    else if (marker.srcPage < pageNum) markY = pageHeight;   // started above the top
  }

  const scale = viewport.scale || 1;
  const lineHeight = Math.max((marker.h || 0) * scale, 6);
  const baseline = convertPoint(viewport, 0, markY).y;
  const height = lineHeight * 1.35;
  const top = Math.max(0, Math.min(baseline - lineHeight, viewport.height - height));

  const band = document.createElement('div');
  band.className = 'pdfReadMarker';
  band.style.top = top + 'px';
  band.style.height = height + 'px';
  markLayer.appendChild(band);
  return top;
}

// Render a full PDF page into the lightbox: a crisp (device-pixel-ratio) canvas
// image plus a transparent text layer overlay so the text can be selected/copied.
// `marker` ({ y, h, srcPage }) highlights the line being read and scrolls to it.
async function renderPageModal(pageNum, caption, marker) {
  if (!pdfDoc || !pageNum) return;
  const { overlay, content, wrap, canvas, textLayer, markLayer, caption: captionEl } = ensureModal();

  // Cancel any render still in flight and wait for pdf.js to release the canvas
  // before starting a new one, otherwise it throws "same canvas" mid-render.
  if (currentRenderTask) {
    try {
      currentRenderTask.cancel();
      await currentRenderTask.promise;
    } catch (e) { /* cancelled render rejects; that's expected */ }
    currentRenderTask = null;
  }

  try {
    const page = await pdfDoc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const maxW = Math.min(window.innerWidth * 0.92, 1400);
    const maxH = window.innerHeight * 0.85;

    // A web page printed to PDF is one very tall sheet. Fitting that to the window
    // height makes it illegible, so fit to width instead and let the lightbox
    // scroll — which is also what makes "where am I on the page" meaningful.
    const isTallPage = base.height / base.width > TALL_PAGE_RATIO;
    const cssScale = isTallPage
      ? maxW / base.width
      : Math.min(maxW / base.width, maxH / base.height);

    // Backing store is CSS px * DPR for sharpness, capped so a very long page
    // stays inside the browser's canvas limits.
    const dpr = window.devicePixelRatio || 1;
    let renderScale = cssScale * dpr;
    const pixels = base.width * renderScale * base.height * renderScale;
    if (pixels > MAX_CANVAS_PIXELS) renderScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);

    const cssViewport = page.getViewport({ scale: cssScale });
    const renderViewport = page.getViewport({ scale: renderScale });

    wrap.style.width = cssViewport.width + 'px';
    wrap.style.height = cssViewport.height + 'px';
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    canvas.style.width = cssViewport.width + 'px';
    canvas.style.height = cssViewport.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    currentRenderTask = page.render({ canvasContext: ctx, viewport: renderViewport });
    await currentRenderTask.promise;
    currentRenderTask = null;

    // Selectable text overlay, sized to the CSS viewport
    textLayer.innerHTML = '';
    textLayer.style.width = cssViewport.width + 'px';
    textLayer.style.height = cssViewport.height + 'px';
    textLayer.style.setProperty('--scale-factor', cssScale);
    try {
      const textContent = await page.getTextContent();
      await pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport: cssViewport,
        textDivs: []
      }).promise;
    } catch (textErr) {
      console.warn('Text layer unavailable for page', pageNum, textErr);
    }

    const markerTop = drawPageMarks(markLayer, cssViewport, base.height, pageNum, marker);

    captionEl.textContent = caption || `Page ${pageNum}`;
    overlay.style.display = 'flex';

    // Scroll the reading position into view (only meaningful once displayed, since
    // clientHeight is zero while the overlay is hidden).
    content.scrollTop = markerTop === null
      ? 0
      : Math.max(0, wrap.offsetTop + markerTop - content.clientHeight * 0.4);
  } catch (error) {
    if (error && error.name === 'RenderingCancelledException') return; // superseded
    console.error('Error rendering page', pageNum, error);
  }
}
// END of image banner + page modal
//-------------------------------------

//-------------------------------------
// START of bionic display
// Function to display bionic text (Firefox-safe implementation with improved spacing)
function displayBionicText(words) {
  // Clear the output first
  textOutput.innerHTML = '';

  // Create a container div to hold all the content
  const container = document.createElement('div');
  container.style.whiteSpace = 'pre-wrap'; // Preserve spaces

  words.forEach((word, index) => {
    // Skip empty words
    if (!word) return;

    // Create a wrapper for each word + space
    const wordWrapper = document.createElement('span');

    // Determine how many letters to highlight (1 or 2)
    const highlightLength = Math.min(2, word.length);

    if (highlightLength > 0) {
      // Create the highlight span
      const highlightSpan = document.createElement('span');
      highlightSpan.className = 'highlight';
      highlightSpan.textContent = word.substring(0, highlightLength);
      wordWrapper.appendChild(highlightSpan);

      // Add the rest of the word if there's more
      if (word.length > highlightLength) {
        const restOfWord = document.createTextNode(word.substring(highlightLength));
        wordWrapper.appendChild(restOfWord);
      }
    } else {
      wordWrapper.appendChild(document.createTextNode(word));
    }

    // Add the word to the container
    container.appendChild(wordWrapper);

    // Add a space after the word (except for the last word)
    if (index < words.length - 1) {
      container.appendChild(document.createTextNode(' '));
    }
  });

  // Add the container to the output
  textOutput.appendChild(container);
}
// END of bionic display
//-------------------------------------
