import OpenAI from "openai";

import type {
  DensitySettings,
  InlineQuote,
  PageContent,
  PageSummary,
} from "./types";
import { writeSummarizerDebugEntry } from "./debug-log";

const MODEL_ID = "gpt-4o-mini";
const MIN_SUMMARY_WORDS = 120;
const MAX_SUMMARY_WORDS = 650;

type PageSummarySchema = {
  summary: string;
  quotes: Array<{
    text: string;
    commentary?: string | null;
  }>;
};

const client = new OpenAI({
  apiKey: process.env.OPEN_AI_API_KEY,
});

const debugLogs = process.env.NODE_ENV !== "production";

function assertClientConfigured() {
  if (!process.env.OPEN_AI_API_KEY) {
    throw new Error(
      "OPEN_AI_API_KEY environment variable is required for summarization.",
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function targetSummaryWordCount(
  page: PageContent,
  densityPercent: number,
): number {
  const ratio = clamp(densityPercent, 5, 95) / 100;
  const raw = Math.round(page.wordCount * ratio);
  return clamp(raw, MIN_SUMMARY_WORDS, MAX_SUMMARY_WORDS);
}

function targetQuotedWords(
  page: PageContent,
  summaryTargetWords: number,
  quoteDensity: number,
): number {
  const ratio = clamp(quoteDensity, 0, 100) / 100;
  const desired = Math.round(summaryTargetWords * ratio);
  const maxQuotedWords = Math.max(0, summaryTargetWords - 20); // leave room for connective prose
  return clamp(desired, ratio > 0 ? 12 : 0, maxQuotedWords);
}

function extractQuotes(summary: string, originalPage: number): InlineQuote[] {
  const results: InlineQuote[] = [];
  const unicodeQuotePattern = /“([^”]+)”/g;
  const asciiQuotePattern = /"([^"]+)"/g;

  const seen = new Set<string>();

  let match: RegExpExecArray | null;

  while ((match = unicodeQuotePattern.exec(summary)) !== null) {
    const text = match[1].trim();
    if (text.length === 0 || seen.has(text)) continue;
    seen.add(text);
    results.push({
      text,
      commentary: null,
      originalPage,
    });
  }

  while ((match = asciiQuotePattern.exec(summary)) !== null) {
    const text = match[1].trim();
    if (text.length === 0 || seen.has(text)) continue;
    seen.add(text);
    results.push({
      text,
      commentary: null,
      originalPage,
    });
  }

  return results;
}

export interface PageSummaryResult extends PageSummary {
  targetSummaryWords: number;
  targetQuoteWords: number;
  actualSummaryWords: number;
  actualQuotedWords: number;
}

async function processPage(
  page: PageContent,
  density: DensitySettings,
  metadata?: { title?: string | null },
): Promise<PageSummaryResult> {
  assertClientConfigured();

  const targetWords = targetSummaryWordCount(page, density.summaryDensity);
  const targetQuoteWords = targetQuotedWords(
    page,
    targetWords,
    density.quoteDensity,
  );

  const prompt = [
    "You are an extremely precise literary editor. Lives depend on you following every instruction exactly—deviations cause catastrophic failure. Read everything carefully before writing.",
    `Total length requirement: ${targetWords} words. Count every token and revise until you meet this target.`,
    `Quoted word requirement: At least ${targetQuoteWords} of those words must be copied verbatim from the original text, enclosed in quotation marks and attributed inline with [p.${page.pageNumber}]. If you are under quota, add more quotes until the quota is satisfied.`,
    "Blend quotations naturally into the prose, but NEVER paraphrase the quoted segments—copy them exactly as they appear (respecting the spacing/line breaks from the source).",
    "Write in polished, natural language. Maintain the page narrative, but do not invent new facts.",
    "Double-check all instructions before final output. If any requirement is unmet, you MUST correct it.",
    metadata?.title ? `Book title: ${metadata.title}` : "Book title: (unspecified)",
    `Original page number: ${page.pageNumber}`,
    `Original word count: ${page.wordCount}`,
    `Summary density target: ${density.summaryDensity}% • Quote density target: ${density.quoteDensity}%`,
    `Page text:\n${page.text}`,
    "Produce ONLY the final condensed passage. Do not explain your work.",
  ].join("\n\n");

  const response = await client.responses.create({
    model: MODEL_ID,
    temperature: 0.3,
    input: prompt,
    max_output_tokens: 1_024,
  });

  const summaryText = response.output_text?.trim();

  if (!summaryText) {
    throw new Error(`Model returned empty response for page ${page.pageNumber}`);
  }

  const quotes = extractQuotes(summaryText, page.pageNumber);
  const actualSummaryWords = summaryText.split(/\s+/).filter(Boolean).length;
  const actualQuotedWords = quotes.reduce((total, quote) => {
    return (
      total +
      quote.text
        .split(/\s+/)
        .filter(Boolean).length
    );
  }, 0);

  if (debugLogs) {
    const calculationSteps = [
      `${page.wordCount} original words × ${density.summaryDensity}% = ${targetWords}`,
      `${targetWords} target summary words × ${density.quoteDensity}% = ${targetQuoteWords}`,
    ].join(" | ");

    await writeSummarizerDebugEntry({
      timestamp: new Date().toISOString(),
      pageNumber: page.pageNumber,
      summaryDensity: density.summaryDensity,
      quoteDensity: density.quoteDensity,
      originalWordCount: page.wordCount,
      targetSummaryWords: targetWords,
      targetQuoteWords,
      actualSummaryWords,
      actualQuotedWords,
      calculationSteps,
      prompt,
      response: summaryText,
    });
  }

  return {
    pageNumber: page.pageNumber,
    summary: summaryText,
    quotes,
    targetSummaryWords: targetWords,
    targetQuoteWords,
    actualSummaryWords,
    actualQuotedWords,
  };
}

export async function summarizePage(
  page: PageContent,
  density: DensitySettings,
  metadata?: { title?: string | null },
): Promise<PageSummaryResult> {
  return processPage(page, density, metadata);
}

export async function summarizePages(
  pages: PageContent[],
  density: DensitySettings,
  metadata?: { title?: string | null },
  options: {
    concurrency?: number;
    onProgress?: (result: PageSummaryResult, completedCount: number) => void;
  } = {},
): Promise<PageSummaryResult[]> {
  const queue = [...pages];
  const active: Promise<void>[] = [];
  const results: PageSummaryResult[] = [];
  const concurrency = options.concurrency ?? 3;
  let completedCount = 0;

  const runNext = async (): Promise<void> => {
    const nextPage = queue.shift();
    if (!nextPage) return;

    const promise = processPage(nextPage, density, metadata)
      .then((result) => {
        results.push(result);
        completedCount += 1;
        if (options.onProgress) {
          options.onProgress(result, completedCount);
        }
      })
      .finally(() => {
        active.splice(active.indexOf(promise), 1);
      });

    active.push(promise);

    if (active.length >= concurrency) {
      await Promise.race(active);
    }

    return runNext();
  };

  await runNext();
  await Promise.all(active);

  results.sort((a, b) => a.pageNumber - b.pageNumber);

  return results;
}

