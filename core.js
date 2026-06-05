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
let isReading = false;
var isPaused = false;
var userInteracted = false;

// Prepared-document state (filled once per loaded PDF / text, reused for playback)
let pdfDoc = null;              // live pdf.js document, kept for page rendering
let documentWords = [];         // ordered [{ text, page }] after filtering
let chunks = [];                // [[{text,page}, ...], ...]
let chunkTexts = [];            // pre-joined display string per chunk (no per-tick work)
let chunkWordLists = [];        // pre-split word strings per chunk (for Bionic display)
let chunkSpecial = [];          // pre-computed "needs punctuation pause" flag per chunk
let chunkPages = [];            // page number for each chunk (page of its first word)
let chunkStartWord = [];        // cumulative word index at the start of each chunk
let totalWords = 0;
let numPages = 0;
let pageImageCounts = {};       // { pageNum: imageCount }
let documentReady = false;

// Playback position
let currentChunkIndex = 0;
let currentWordIndex = 0;
let currentPage = null;
let lastBannerPage = null;      // page the image banner currently reflects (avoids per-tick DOM writes)
let readingTimeout = null;
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
  countImageMasks: false,     // image masks are often decorative vector fills
  footnoteFontRatio: 0.85,    // line font smaller than this * body font => candidate
  footnoteBandFrac: 0.22,     // ...and within this bottom fraction of the page
  edgeBandFrac: 0.07,         // top/bottom band considered header/footer territory
  headerRepeatFrac: 0.30,     // a band line on >30% of pages is a running head/foot
  tocLineFrac: 0.5,           // share of lines looking like TOC entries to skip a page
  tocMinLines: 5              // ...only on pages with at least this many lines
};

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
  } catch (e) {
    console.error("Error loading settings from localStorage:", e);
  }

  // Seed the cached control values from the (possibly restored) inputs
  currentSpeed = parseInt(speedSelector.value) || DEFAULT_VALUES.speed;
  currentPauseFactor = parseFloat(pauseSpeedSelector.value) || DEFAULT_VALUES.pauseSpeed;
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
    if (documentWords.length) {
      rebuildChunks(documentWords);
      resetPosition();
    }
  });

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
      if (currentPage) renderPageModal(currentPage, `Page ${currentPage}`);
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
    if (currentPage) renderPageModal(currentPage, `Page ${currentPage}`);
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
function buildChunks(words, chunkSize) {
  const result = [];
  let i = 0;
  while (i < words.length) {
    let chunkEnd = i + chunkSize;

    if (!(chunkEnd <= words.length && /[.!?]$/.test(words[chunkEnd - 1]?.text || ''))) {
      const slice = words.slice(i, i + chunkSize);
      const nextPunctuationIndex = slice.findIndex((w) => /[.!?]$/.test(w.text));
      if (nextPunctuationIndex !== -1 && nextPunctuationIndex < chunkSize) {
        chunkEnd = i + nextPunctuationIndex + 1;
      }
    }

    const chunk = words.slice(i, Math.min(chunkEnd, words.length));
    if (!chunk.length) break;
    result.push(chunk);
    i += chunk.length;
  }
  return result;
}

// Rebuild chunks + derived indices from a flat word array. Everything the
// per-word reading loop needs (display text, word lists, pause flag, page) is
// computed once here so playback does no string/regex work per tick.
function rebuildChunks(words) {
  documentWords = words;
  const chunkSize = parseInt(chunkSelector.value) || 1;
  chunks = buildChunks(words, chunkSize);
  chunkTexts = [];
  chunkWordLists = [];
  chunkSpecial = [];
  chunkPages = [];
  chunkStartWord = [];
  let running = 0;
  for (const chunk of chunks) {
    const wordList = chunk.map((w) => w.text);
    const text = wordList.join(' ');
    chunkWordLists.push(wordList);
    chunkTexts.push(text);
    chunkSpecial.push(SPECIAL_CHAR_REGEX.test(text));
    chunkStartWord.push(running);
    chunkPages.push(chunk[0] ? chunk[0].page : null);
    running += chunk.length;
  }
  totalWords = running;
}

function resetPosition() {
  stopTimer();
  isReading = false;
  isPaused = false;
  currentChunkIndex = 0;
  currentWordIndex = 0;
  lastBannerPage = null;
  if (startPauseButton) startPauseButton.textContent = 'GO!';
  hidePauseInfo();
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
  const buckets = new Map();

  for (const item of textContent.items) {
    if (!item.str) continue;
    const tr = item.transform;
    const y = tr[5];
    const fontHeight = Math.abs(tr[3]) || item.height || 0;
    const key = Math.round(y / 2) * 2; // merge baselines within ~2px
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { y, items: [], fhSum: 0, fhN: 0 };
      buckets.set(key, bucket);
    }
    bucket.items.push({ x: tr[4], str: item.str });
    bucket.fhSum += fontHeight;
    bucket.fhN += 1;
  }

  const lines = [];
  for (const bucket of buckets.values()) {
    bucket.items.sort((a, b) => a.x - b.x);
    const text = bucket.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    lines.push({
      y: bucket.y,
      text,
      fontHeight: bucket.fhN ? bucket.fhSum / bucket.fhN : 0
    });
  }
  // Top of page first (PDF origin is bottom-left, so larger y is higher up)
  lines.sort((a, b) => b.y - a.y);
  return { lines, height: viewport.height };
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

  // Pass 1: collect lines, image counts, and a body-font histogram
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const { lines, height } = await getPageLines(page);
    imageCounts[pageNum] = await countPageImages(page);
    pageData.push({ pageNum, lines, height });

    for (const line of lines) {
      const fh = Math.round(line.fontHeight);
      if (fh > 0) {
        fontHistogram.set(fh, (fontHistogram.get(fh) || 0) + line.text.length);
      }
    }
  }

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
  const dropped = { footnote: 0, header: 0, caption: 0, tocPages: 0, frontMatterPages: 0 };
  // Only treat the front slice of the book as candidate front matter, so a large
  // chapter-title page deep in the body is never mistaken for a title page.
  const frontLimit = Math.ceil(doc.numPages * 0.15);

  for (const { pageNum, lines, height } of pageData) {
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

    for (const line of lines) {
      const inEdgeBand = line.y >= topY || line.y <= bottomY;

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
        if (token) words.push({ text: token, page: pageNum });
      }
    }
  }

  console.log('PDF parse summary:', {
    pages: doc.numPages,
    bodyFontHeight: bodyFont,
    keptWords: words.length,
    dropped,
    startsOnPage: words[0] ? words[0].page : null,
    pagesWithImages: Object.values(imageCounts).filter((c) => c > 0).length
  });

  return { words, pageImageCounts: imageCounts };
}

// Load a PDF (from a URL string or { data } ArrayBuffer) and prepare it for reading
async function prepareDocumentFromSource(source, label) {
  setStatus('Loading PDF…');
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;

  const loadingTask = pdfjsLib.getDocument(source);
  const doc = await loadingTask.promise;
  pdfDoc = doc;
  numPages = doc.numPages;

  const { words, pageImageCounts: counts } = await extractStructuredPDF(doc);
  pageImageCounts = counts;
  rebuildChunks(words);
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
    rebuildChunks(textToWords(text));
    resetPosition();
    documentReady = true;
    userInteracted = false;
    setStatus(`Pasted text — ${totalWords.toLocaleString()} words.`);
    return chunks.length > 0;
  }

  return documentReady && chunks.length > 0;
}

function stopTimer() {
  if (readingTimeout) {
    clearTimeout(readingTimeout);
    readingTimeout = null;
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
  updateImageBanner(currentPage);

  if (fontFamilySelector.value === 'Bionic') {
    displayBionicText(chunkWordLists[index]);
  } else {
    textOutput.textContent = chunkTexts[index];
  }
}

// The reading loop tick
function tick() {
  if (!isReading) return;
  if (currentChunkIndex >= chunks.length) {
    finishReading();
    return;
  }
  const chunk = chunks[currentChunkIndex];
  showChunk(currentChunkIndex);
  currentWordIndex = chunkStartWord[currentChunkIndex] + chunk.length;
  const delay = chunkDelay(currentChunkIndex);
  currentChunkIndex++;
  readingTimeout = setTimeout(tick, delay);
}

function startPlayback() {
  hidePauseInfo();
  closeModal();
  isReading = true;
  isPaused = false;
  startPauseButton.textContent = 'Pause';
  stopTimer();
  tick();
}

// Used by the GO button (button needs to prepare content first)
async function startReading() {
  const ready = await ensureContent();
  if (!ready) {
    textOutput.textContent = 'Please choose a PDF or enter text.';
    return;
  }
  startPlayback();
}

function pause() {
  isReading = false;
  isPaused = true;
  spaceHeld = false;
  stopTimer();
  startPauseButton.textContent = 'Start';
  showPauseView();
}

function finishReading() {
  isReading = false;
  stopTimer();
  startPauseButton.textContent = 'GO!';
  currentChunkIndex = 0;
  currentWordIndex = 0;
}

// Jump back roughly n words and show the landing chunk
function rewindWords(n) {
  if (!chunks.length) return;
  stopTimer();
  const target = Math.max(0, currentWordIndex - n);
  let idx = 0;
  while (idx < chunkStartWord.length - 1 && chunkStartWord[idx + 1] <= target) {
    idx++;
  }
  currentChunkIndex = idx;
  currentWordIndex = chunkStartWord[idx];
  showChunk(idx);

  if (isReading) {
    // resume the loop just past the chunk we just displayed
    currentWordIndex = chunkStartWord[idx] + chunks[idx].length;
    currentChunkIndex = idx + 1;
    readingTimeout = setTimeout(tick, chunkDelay(idx));
  }
}

function progressPercent() {
  if (!totalWords) return 0;
  return Math.round((currentWordIndex / totalWords) * 100);
}

// Show where we are on pause: progress readout + (if a PDF) the real page
function showPauseView() {
  const percent = progressPercent();
  if (pauseInfo) {
    pauseInfo.textContent = currentPage
      ? `${percent}% · page ${currentPage} of ${numPages}`
      : `${percent}% read`;
    pauseInfo.style.display = 'block';
  }
  if (pdfDoc && currentPage) {
    renderPageModal(currentPage, `${percent}% · page ${currentPage} of ${numPages}`);
  }
}

function hidePauseInfo() {
  if (pauseInfo) pauseInfo.style.display = 'none';
}
// END of playback
//-------------------------------------

//-------------------------------------
// START of image banner + page modal

function updateImageBanner(pageNum) {
  if (!imageBanner) return;
  // Only touch the DOM when the page actually changes — otherwise reassigning
  // textContent/display every word forces a layout reflow and causes hitches.
  if (pageNum === lastBannerPage) return;
  lastBannerPage = pageNum;

  const count = pageNum ? (pageImageCounts[pageNum] || 0) : 0;
  if (count > 0) {
    imageBanner.textContent = `📷 ${count > 1 ? count + ' images' : 'An image'} on this page — press V or click to view`;
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

  const canvas = document.createElement('canvas');
  canvas.className = 'pdfModalCanvas';

  const caption = document.createElement('div');
  caption.className = 'pdfModalCaption';

  content.appendChild(closeBtn);
  content.appendChild(canvas);
  content.appendChild(caption);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
  });

  modalEls = { overlay, canvas, caption };
  return modalEls;
}

function closeModal() {
  if (modalEls) modalEls.overlay.style.display = 'none';
}

// Render a full PDF page to a canvas in a modal/lightbox
async function renderPageModal(pageNum, caption) {
  if (!pdfDoc || !pageNum) return;
  const { overlay, canvas, caption: captionEl } = ensureModal();

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
    const maxW = Math.min(window.innerWidth * 0.9, 900);
    const maxH = window.innerHeight * 0.82;
    const scale = Math.min(maxW / base.width, maxH / base.height);
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    currentRenderTask = page.render({ canvasContext: ctx, viewport });
    await currentRenderTask.promise;
    currentRenderTask = null;

    captionEl.textContent = caption || `Page ${pageNum}`;
    overlay.style.display = 'flex';
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
