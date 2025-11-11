import { promises as fs } from "fs";
import path from "path";

type SummarizerDebugEntry = {
  timestamp: string;
  pageNumber: number;
  summaryDensity: number;
  quoteDensity: number;
  originalWordCount: number;
  targetSummaryWords: number;
  targetQuoteWords: number;
  actualSummaryWords: number;
  actualQuotedWords: number;
  calculationSteps: string;
  prompt: string;
  response: string;
};

const DEBUG_DIR = path.join(process.cwd(), "debug");
const DEBUG_FILE = path.join(DEBUG_DIR, "summarizer.log");

async function ensureDebugDir() {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
}

function formatEntry(entry: SummarizerDebugEntry): string {
  const header = [
    `=== Summarizer Debug Entry :: Page ${entry.pageNumber} :: ${entry.timestamp} ===`,
    `Summary density: ${entry.summaryDensity}% | Quote density: ${entry.quoteDensity}%`,
    `Original words: ${entry.originalWordCount}`,
    `Target summary words: ${entry.targetSummaryWords}`,
    `Target quoted words: ${entry.targetQuoteWords}`,
    `Actual summary words: ${entry.actualSummaryWords}`,
    `Actual quoted words: ${entry.actualQuotedWords}`,
    `Calculations: ${entry.calculationSteps}`,
    "",
    "--- Prompt ---",
    entry.prompt,
    "",
    "--- Response ---",
    entry.response,
    "",
    "============================================================",
  ];

  return header.join("\n");
}

export async function writeSummarizerDebugEntry(
  entry: SummarizerDebugEntry,
): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  await ensureDebugDir();
  const formatted = formatEntry(entry);
  await fs.appendFile(DEBUG_FILE, `${formatted}\n`);
}


