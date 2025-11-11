import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import type { CondenseMetadata, PageSummary } from "./types";

const PAGE_WIDTH = 612; // Letter width (8.5in * 72)
const PAGE_HEIGHT = 792; // Letter height (11in * 72)
const PAGE_MARGIN = 72; // 1 inch
const LINE_HEIGHT = 18;

type WrappedLine = {
  text: string;
  x: number;
  y: number;
};

const REPLACEMENTS: Record<string, string> = {
  "“": '"',
  "”": '"',
  "„": '"',
  "«": '"',
  "»": '"',
  "‘": "'",
  "’": "'",
  "‚": "'",
  "—": "-",
  "–": "-",
  "‑": "-",
  "‒": "-",
  "…": "...",
  "•": "*",
  "◦": "*",
  "·": "*",
  "●": "*",
  "▪": "*",
  "■": "*",
  "□": "*",
  "♦": "*",
  "▲": "*",
  "△": "*",
  "▴": "*",
  "▵": "*",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "\u00a0": " ",
};

function sanitizeForPdf(text: string): string {
  return text
    .split("")
    .map((char) => {
      if (char <= "\u00ff") {
        return char;
      }
      return REPLACEMENTS[char] ?? "";
    })
    .join("");
}

function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
  startX: number,
  startY: number,
  lineHeight = LINE_HEIGHT,
): WrappedLine[] {
  const sanitized = sanitizeForPdf(text);
  const words = sanitized
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const lines: WrappedLine[] = [];
  let currentLine = "";
  let x = startX;
  let y = startY;

  words.forEach((word, index) => {
    const candidate = currentLine.length === 0 ? word : `${currentLine} ${word}`;
    const width = font.widthOfTextAtSize(candidate, fontSize);

    if (width <= maxWidth) {
      currentLine = candidate;
      if (index === words.length - 1) {
        lines.push({ text: currentLine, x, y });
        y -= lineHeight;
      }
    } else {
      if (currentLine.length > 0) {
        lines.push({ text: currentLine, x, y });
        y -= lineHeight;
      }

      // If the single word is longer than max width, hard break
      if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
        const characters = word.split("");
        let chunk = "";
        characters.forEach((char, charIndex) => {
          const test = `${chunk}${char}`;
          const testWidth = font.widthOfTextAtSize(test, fontSize);
          if (testWidth <= maxWidth) {
            chunk = test;
            if (charIndex === characters.length - 1) {
              lines.push({ text: chunk, x, y });
              y -= lineHeight;
              chunk = "";
            }
          } else {
            lines.push({ text: chunk, x, y });
            y -= lineHeight;
            chunk = char;
            if (charIndex === characters.length - 1) {
              lines.push({ text: chunk, x, y });
              y -= lineHeight;
            }
          }
        });
        currentLine = "";
      } else {
        currentLine = word;
        if (index === words.length - 1) {
          lines.push({ text: currentLine, x, y });
          y -= lineHeight;
        }
      }
    }
  });

  return lines;
}

function addParagraph(
  page: PDFPage,
  text: string,
  font: PDFFont,
  fontSize: number,
  options: {
    x: number;
    y: number;
    maxWidth: number;
    lineHeight?: number;
  },
): number {
  const { x, y, maxWidth, lineHeight = LINE_HEIGHT } = options;
  const lines = wrapText(text, font, fontSize, maxWidth, x, y, lineHeight);

  lines.forEach((line) => {
    page.drawText(line.text, {
      x: line.x,
      y: line.y,
      size: fontSize,
      font,
      color: rgb(0.15, 0.2, 0.3),
    });
  });

  if (lines.length === 0) {
    return y - lineHeight;
  }

  const lastLine = lines[lines.length - 1];
  return lastLine.y - lineHeight;
}

export async function renderCondensedPdf(
  pages: PageSummary[],
  metadata: CondenseMetadata,
): Promise<Buffer> {
  if (pages.length === 0) {
    throw new Error("No summarized pages provided for PDF rendering.");
  }

  const pdfDoc = await PDFDocument.create();
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  let timesRomanBold;
  let timesItalic;
  try {
    timesRomanBold = await pdfDoc.embedFont(StandardFonts.TimesBold);
  } catch {
    timesRomanBold = timesRoman;
  }

  try {
    timesItalic = await pdfDoc.embedFont(StandardFonts.TimesItalic);
  } catch {
    timesItalic = timesRoman;
  }

  // Cover page
  const coverPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  coverPage.drawText(sanitizeForPdf(metadata.title ?? "Condensed Book"), {
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - PAGE_MARGIN * 2,
    size: 28,
    font: timesRomanBold,
    color: rgb(0.08, 0.13, 0.22),
  });

  let cursorY = PAGE_HEIGHT - PAGE_MARGIN * 2.8;

  if (metadata.author) {
    const authorText = sanitizeForPdf(metadata.author);
    cursorY = addParagraph(
      coverPage,
      `Author: ${authorText}`,
      timesRoman,
      16,
      {
        x: PAGE_MARGIN,
        y: cursorY,
        maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
        lineHeight: 22,
      },
    );
  }

  cursorY = addParagraph(
    coverPage,
    sanitizeForPdf(
      `Summary density: ${metadata.summaryDensity}%  |  Quote density: ${metadata.quoteDensity}%`,
    ),
    timesRoman,
    14,
    {
      x: PAGE_MARGIN,
      y: cursorY - 12,
      maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
    },
  );

  cursorY = addParagraph(
    coverPage,
    "This edition condenses the original manuscript while preserving narrative structure and notable quotations.",
    timesRoman,
    12,
    {
      x: PAGE_MARGIN,
      y: cursorY - 24,
      maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
    },
  );

  // Content pages
  pages.forEach((summaryPage, index) => {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - PAGE_MARGIN;

    y = addParagraph(
      page,
      sanitizeForPdf(`Condensed Page ${index + 1}`),
      timesRomanBold,
      18,
      {
        x: PAGE_MARGIN,
        y,
        maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
        lineHeight: 26,
      },
    );

    y = addParagraph(
      page,
      sanitizeForPdf(summaryPage.summary),
      timesRoman,
      12,
      {
        x: PAGE_MARGIN,
        y: y - 12,
        maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
        lineHeight: 16,
      },
    );

    page.drawText(
      sanitizeForPdf(
        `Condensed edition page ${index + 1} • Sourced from original page ${summaryPage.pageNumber}`,
      ),
      {
        x: PAGE_MARGIN,
        y: PAGE_MARGIN / 2,
        size: 10,
        font: timesItalic,
        color: rgb(0.4, 0.44, 0.55),
      },
    );
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}



