/**
 * Book Export Service
 * Merges selected papers' PDFs into a single combined PDF with table of contents
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');

/**
 * Export selected papers as a merged PDF book
 * @param {Object} options
 * @param {Array} options.papers - Papers to include with pdfPath, title, authors, year, abstract, bibtex
 * @param {string} options.bookTitle - Title for the book
 * @param {Function} options.onProgress - Progress callback (phase, current, total)
 * @returns {Promise<Uint8Array>} The merged PDF as bytes
 */
async function exportBook(options) {
  const { papers, bookTitle, onProgress } = options;

  // Create temp document to merge PDFs first
  const contentPdf = await PDFDocument.create();
  const tocEntries = [];
  let currentPage = 1;

  // Phase 1: Merge all PDFs and track page counts
  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    onProgress?.('merging', i + 1, papers.length);

    const tocEntry = {
      title: paper.title || 'Untitled',
      authors: formatAuthors(paper.authors),
      year: paper.year,
      startPage: currentPage,
      hasPdf: false
    };

    if (paper.pdfPath && fs.existsSync(paper.pdfPath)) {
      // Merge existing PDF
      try {
        const pdfBytes = fs.readFileSync(paper.pdfPath);
        const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const copiedPages = await contentPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        copiedPages.forEach(page => contentPdf.addPage(page));
        currentPage += copiedPages.length;
        tocEntry.hasPdf = true;
      } catch (err) {
        console.error(`Failed to merge PDF for ${paper.title}:`, err.message);
        // Fall through to create placeholder page
        const pagesAdded = await createPlaceholderPage(contentPdf, paper);
        currentPage += pagesAdded;
      }
    } else {
      // Create placeholder page with abstract and BibTeX
      const pagesAdded = await createPlaceholderPage(contentPdf, paper);
      currentPage += pagesAdded;
    }

    tocEntries.push(tocEntry);
  }

  // Phase 2: Create TOC pages (we need to know how many pages first)
  onProgress?.('toc', 0, 1);
  const tocPdf = await PDFDocument.create();
  await createTableOfContents(tocPdf, tocEntries, bookTitle);
  const tocPageCount = tocPdf.getPageCount();

  // Adjust all page numbers by TOC page count
  tocEntries.forEach(entry => {
    entry.startPage += tocPageCount;
  });

  // Phase 3: Recreate TOC with correct page numbers
  const finalTocPdf = await PDFDocument.create();
  await createTableOfContents(finalTocPdf, tocEntries, bookTitle);

  // Phase 4: Combine TOC + Content into final PDF
  onProgress?.('finalizing', 0, 1);
  const finalPdf = await PDFDocument.create();

  // Copy TOC pages
  const tocPages = await finalPdf.copyPages(finalTocPdf, finalTocPdf.getPageIndices());
  tocPages.forEach(page => finalPdf.addPage(page));

  // Copy content pages
  const contentPages = await finalPdf.copyPages(contentPdf, contentPdf.getPageIndices());
  contentPages.forEach(page => finalPdf.addPage(page));

  onProgress?.('saving', 0, 1);
  return await finalPdf.save();
}

/**
 * Create a placeholder page for papers without PDFs
 */
async function createPlaceholderPage(pdfDoc, paper) {
  const page = pdfDoc.addPage([612, 792]); // US Letter size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const monoFont = await pdfDoc.embedFont(StandardFonts.Courier);

  const { width, height } = page.getSize();
  const margin = 72; // 1-inch margin
  const maxWidth = width - margin * 2;
  let y = height - margin;

  // Title
  const titleLines = wrapText(paper.title || 'Untitled', boldFont, 18, maxWidth);
  for (const line of titleLines) {
    page.drawText(line, { x: margin, y, size: 18, font: boldFont, color: rgb(0, 0, 0) });
    y -= 24;
  }
  y -= 12;

  // Authors
  const authorText = formatAuthors(paper.authors);
  if (authorText) {
    const authorLines = wrapText(authorText, font, 12, maxWidth);
    for (const line of authorLines) {
      page.drawText(line, { x: margin, y, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
      y -= 16;
    }
    y -= 8;
  }

  // Year
  if (paper.year) {
    page.drawText(`Year: ${paper.year}`, { x: margin, y, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 24;
  }

  // "No PDF available" note
  y -= 8;
  page.drawText('[No PDF available for this paper]', {
    x: margin, y, size: 11, font, color: rgb(0.6, 0.4, 0.4)
  });
  y -= 28;

  // Abstract
  if (paper.abstract) {
    page.drawText('Abstract', { x: margin, y, size: 14, font: boldFont, color: rgb(0, 0, 0) });
    y -= 20;

    const abstractLines = wrapText(paper.abstract, font, 11, maxWidth);
    for (const line of abstractLines.slice(0, 25)) { // Limit lines
      page.drawText(line, { x: margin, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 14;
      if (y < 200) break;
    }
  }

  // BibTeX at bottom
  if (paper.bibtex && y > 150) {
    y = Math.min(y - 24, 280);
    page.drawText('BibTeX', { x: margin, y, size: 12, font: boldFont, color: rgb(0, 0, 0) });
    y -= 16;

    const bibtexLines = paper.bibtex.split('\n').slice(0, 12);
    for (const line of bibtexLines) {
      if (y < margin) break;
      const cleanLine = line.substring(0, 75);
      page.drawText(cleanLine, { x: margin, y, size: 8, font: monoFont, color: rgb(0.3, 0.3, 0.3) });
      y -= 10;
    }
  }

  return 1; // Added 1 page
}

/**
 * Create table of contents pages
 */
async function createTableOfContents(pdfDoc, entries, bookTitle) {
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 72;
  const maxWidth = pageWidth - margin * 2;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // TOC Title
  page.drawText('Table of Contents', { x: margin, y, size: 24, font: boldFont, color: rgb(0, 0, 0) });
  y -= 36;

  if (bookTitle) {
    page.drawText(bookTitle, { x: margin, y, size: 14, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 32;
  }

  y -= 12; // Extra spacing before entries

  // Entries
  for (const entry of entries) {
    if (y < 120) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    // Title with page number
    const titleText = truncateText(entry.title, 55);
    const pageNum = `p. ${entry.startPage}`;
    const pageNumWidth = font.widthOfTextAtSize(pageNum, 11);

    page.drawText(titleText, { x: margin, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    page.drawText(pageNum, { x: pageWidth - margin - pageNumWidth, y, size: 11, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 16;

    // Authors and year
    let metaText = entry.authors;
    if (entry.year) metaText += ` (${entry.year})`;
    if (!entry.hasPdf) metaText += ' [No PDF]';

    page.drawText(truncateText(metaText, 65), { x: margin, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
    y -= 22;
  }
}

// Helper functions
function formatAuthors(authors) {
  if (!authors || authors.length === 0) return '';
  if (typeof authors === 'string') {
    try {
      authors = JSON.parse(authors);
    } catch {
      return authors;
    }
  }
  if (!Array.isArray(authors)) return '';
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return authors.join(' & ');
  return `${authors[0]} et al.`;
}

function wrapText(text, font, size, maxWidth) {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, size);

    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

module.exports = { exportBook };
