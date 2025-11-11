import { NextResponse } from "next/server";
import { z } from "zod";

import { renderCondensedPdf } from "@/lib/pdf-renderer";
import { PdfExtractionError, extractPdfPages } from "@/lib/pdf-extract";
import { summarizePages } from "@/lib/summarizer";
import type { PageSummaryResult } from "@/lib/summarizer";

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024; // 40MB safety cap

const percentSchema = (min: number, max: number, fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    if (typeof value === "string") {
      const numeric = Number(value);
      return Number.isNaN(numeric) ? value : numeric;
    }

    if (typeof value === "number") {
      return value;
    }

    throw new Error("Value must be numeric.");
  }, z.number().min(min).max(max));

const selectedPagesSchema = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return undefined;
      return parsed
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry > 0);
    } catch {
      return undefined;
    }
  });

const requestSchema = z.object({
  summaryDensity: percentSchema(10, 100, 70),
  quoteDensity: percentSchema(0, 100, 30),
  selectedPages: selectedPagesSchema,
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const fileEntry = formData.get("file");

    if (!fileEntry || !(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: "A PDF file upload is required under the `file` field." },
        { status: 400 },
      );
    }

    if (fileEntry.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Uploaded file must be a PDF (application/pdf)." },
        { status: 400 },
      );
    }

    if (fileEntry.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `Uploaded file is too large. Maximum supported size is ${Math.round(
            MAX_UPLOAD_BYTES / (1024 * 1024),
          )}MB.`,
        },
        { status: 413 },
      );
    }

    const parsed = requestSchema.safeParse({
      summaryDensity: formData.get("summaryDensity"),
      quoteDensity: formData.get("quoteDensity"),
      selectedPages: formData.get("selectedPages"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid density or metadata values.",
          details: parsed.error.issues,
        },
        { status: 400 },
      );
    }

    const { summaryDensity, quoteDensity, selectedPages } = parsed.data;

    const pdfBuffer = Buffer.from(await fileEntry.arrayBuffer());

    let pages: Awaited<ReturnType<typeof extractPdfPages>>;
    try {
      pages = await extractPdfPages(pdfBuffer);
    } catch (error) {
      if (error instanceof PdfExtractionError) {
        return NextResponse.json(
          {
            error:
              "We couldn't read text from that PDF. Try a text-based or OCR'd document.",
          },
          { status: 422 },
        );
      }
      throw error;
    }

    if (pages.length === 0) {
      return NextResponse.json(
        {
          error:
            "No readable text was found in the PDF. Please upload a text-based document.",
        },
        { status: 422 },
      );
    }

    if (selectedPages && selectedPages.length > 0) {
      const selection = new Set(selectedPages);
      pages = pages.filter((page) => selection.has(page.pageNumber));

      if (pages.length === 0) {
        return NextResponse.json(
          {
            error:
              "None of the selected pages contained readable text. Try choosing different pages.",
          },
          { status: 400 },
        );
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        };

        send("meta", { totalPages: pages.length });

        try {
          const processedPages: PageSummaryResult[] = [];

          const results = await summarizePages(
            pages,
            { summaryDensity, quoteDensity },
            undefined,
            {
              concurrency: 20,
              onProgress: (processed, completedCount) => {
                processedPages.push(processed);
                send("progress", {
                  processedPages: completedCount,
                  totalPages: pages.length,
                  pageNumber: processed.pageNumber,
                  targetSummaryWords: processed.targetSummaryWords,
                  targetQuoteWords: processed.targetQuoteWords,
                  actualSummaryWords: processed.actualSummaryWords,
                  actualQuotedWords: processed.actualQuotedWords,
                });
              },
            },
          );

          const condensedPdf = await renderCondensedPdf(
            results.map(({ pageNumber, summary, quotes }) => ({
              pageNumber,
              summary,
              quotes,
            })),
            {
            summaryDensity,
            quoteDensity,
          },
          );

          const filename = "condensed-book.pdf";
          const base64Pdf = condensedPdf.toString("base64");

          send("result", {
            filename,
            base64Pdf,
          });
        } catch (error) {
          console.error("[condense-api] Unexpected error", error);
          send("error", {
            message: (error as Error).message ?? "Failed to condense PDF.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[condense-api] Unexpected error", error);
    return NextResponse.json(
      {
        error: "Failed to condense the uploaded PDF.",
        message: (error as Error).message,
      },
      { status: 500 },
    );
  }
}


