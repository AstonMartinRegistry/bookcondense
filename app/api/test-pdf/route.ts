import { NextResponse } from "next/server";

import { renderCondensedPdf } from "@/lib/pdf-renderer";
import type { PageSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const samplePages: PageSummary[] = [
    {
      pageNumber: 1,
      summary:
        'This sample page includes special symbols like “quotation marks”, dashes — and the notorious black square ■ to ensure sanitization works. The pipeline should gracefully replace them while preserving readability.',
      quotes: [],
    },
    {
      pageNumber: 2,
      summary:
        "Another page uses ellipses… and various bullets • ● ▪ □ ♦ alongside non-breaking spaces to verify that every replacement path is exercised within the renderer.",
      quotes: [],
    },
    {
      pageNumber: 3,
      summary:
        "This page stands in for a corrupted scan and should be skipped entirely.",
      quotes: [],
    },
    {
      pageNumber: 4,
      summary:
        "Finally, a fully readable page to prove the pipeline continues after encountering an unreadable page.",
      quotes: [],
    },
  ];

  const pdfBuffer = await renderCondensedPdf(
    samplePages.filter((page) => page.pageNumber !== 3),
    {
      summaryDensity: 70,
      quoteDensity: 30,
      title: "Bad Character Test ■",
      author: "Sanitizer “Beta”",
    },
  );

  const pdfArrayBuffer = pdfBuffer.buffer.slice(
    pdfBuffer.byteOffset,
    pdfBuffer.byteOffset + pdfBuffer.byteLength,
  );

  return new NextResponse(pdfArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="bad-character-test.pdf"',
      "Cache-Control": "no-store",
    },
  });
}


