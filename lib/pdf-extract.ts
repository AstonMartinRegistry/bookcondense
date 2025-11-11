import pdfParse from "pdf-parse";

import type { PageContent } from "./types";

export class PdfExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

const DEFAULT_MIN_CHAR_THRESHOLD = 12;
const SPACE_GAP_THRESHOLD = 5; // points difference on X-axis to imply space

const PUNCTUATION_START = /[\s.,;:!?'"’”)\]\}«»]/;
const PUNCTUATION_END = /[\s\-–—({[\<'"“‘]/;

type TextItemLike = {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

function normalizeWhitespace(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\s+\n/g, "\n").trim();
}

function shouldInsertSpace(
  previousChar: string | undefined,
  nextFragment: string,
): boolean {
  if (!previousChar) return false;
  if (/\s/.test(previousChar)) return false;
  if (PUNCTUATION_END.test(previousChar)) return false;

  const trimmed = nextFragment.trim();
  if (trimmed.length === 0) return false;

  const firstChar = trimmed[0];
  if (PUNCTUATION_START.test(firstChar)) return false;

  // Avoid inserting space when the fragment is hyphenated continuation.
  if (previousChar === "-" || previousChar === "‐" || previousChar === "‑") {
    return false;
  }

  return true;
}

export async function extractPdfPages(buffer: Buffer): Promise<PageContent[]> {
  const pages: PageContent[] = [];

  let pageIndex = 0;
  let hadPageError = false;

  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;

  try {
    const suppressIfNoise = (
      message?: unknown,
      printer?: (...args: unknown[]) => void,
      ...optionalParams: unknown[]
    ) => {
      if (
        typeof message === "string" &&
        message.includes("FormatError: Unknown compression method in flate stream")
      ) {
        return;
      }
      printer?.(message, ...optionalParams);
    };

    console.warn = (message?: unknown, ...optionalParams: unknown[]) => {
      suppressIfNoise(message, originalConsoleWarn, ...optionalParams);
    };
    console.error = (message?: unknown, ...optionalParams: unknown[]) => {
      suppressIfNoise(message, originalConsoleError, ...optionalParams);
    };
    console.log = (message?: unknown, ...optionalParams: unknown[]) => {
      suppressIfNoise(message, originalConsoleLog, ...optionalParams);
    };

    await pdfParse(buffer, {
      pagerender: async (pageData) => {
        try {
          const textContent = await pageData.getTextContent({
            disableCombineTextItems: false,
            normalizeWhitespace: false,
          });

          let assembled = "";
          let lastY: number | null = null;

          let lastX: number | null = null;

          for (const item of textContent.items) {
            const textItem = item as unknown as TextItemLike;
            const transform = Array.isArray(textItem.transform)
              ? textItem.transform
              : null;
            const currentX = transform ? transform[4] : null;
            const currentY = transform ? transform[5] : null;
            const hasEOL = Boolean((textItem as TextItemLike).hasEOL);

            const previousChar = assembled.slice(-1);

            if (
              lastY !== null &&
              currentY !== null &&
              Math.abs(currentY - lastY) > 1
            ) {
              assembled = assembled.trimEnd();
              assembled += "\n";
              lastX = null;
            } else if (
              lastX !== null &&
              currentX !== null &&
              currentX - lastX > SPACE_GAP_THRESHOLD
            ) {
              assembled += " ";
            } else if (shouldInsertSpace(previousChar, textItem.str)) {
              assembled += " ";
            }

            assembled += textItem.str;
            lastY = currentY ?? lastY;
            lastX =
              currentX !== null && textItem.width !== undefined
                ? currentX + textItem.width
                : currentX;

            if (hasEOL) {
              assembled = assembled.trimEnd();
              assembled += "\n";
              lastX = null;
            }
          }

          const cleaned = normalizeWhitespace(assembled);

          if (cleaned.length >= DEFAULT_MIN_CHAR_THRESHOLD) {
            pageIndex += 1;
            const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
            pages.push({
              pageNumber: pageIndex,
              text: cleaned,
              wordCount,
            });
          }
        } catch (pageError) {
          hadPageError = true;
          console.warn(
            "[extractPdfPages] Skipping unreadable page:",
            (pageError as Error).message,
          );
        }

        return "";
      },
    });

  } catch (error) {
    throw new PdfExtractionError(
      "Unable to read text from the PDF. The file may be scanned, encrypted, or corrupted.",
    );
  } finally {
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
  }

  if (pages.length === 0) {
    throw new PdfExtractionError(
      "Unable to read text from the PDF. The file may be scanned, encrypted, or corrupted.",
    );
  }

  if (hadPageError) {
    console.warn(
      "[extractPdfPages] One or more pages could not be read and were skipped.",
    );
  }

  return pages;
}

