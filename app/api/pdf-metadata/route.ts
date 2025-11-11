import { NextResponse } from "next/server";
import { z } from "zod";

import { extractPdfPages, PdfExtractionError } from "@/lib/pdf-extract";

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024; // 40MB cap

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const metadataRequestSchema = z.object({
  file: z.instanceof(File),
});

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    const parsed = metadataRequestSchema.safeParse({ file });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A PDF file upload is required under the `file` field." },
        { status: 400 },
      );
    }

    const pdfFile = parsed.data.file;

    if (pdfFile.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Uploaded file must be a PDF (application/pdf)." },
        { status: 400 },
      );
    }

    if (pdfFile.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `Uploaded file is too large. Maximum supported size is ${Math.round(
            MAX_UPLOAD_BYTES / (1024 * 1024),
          )}MB.`,
        },
        { status: 413 },
      );
    }

    const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());

    const pages = await extractPdfPages(pdfBuffer);

    if (pages.length === 0) {
      return NextResponse.json(
        {
          error:
            "No readable text was found in the PDF. Please upload a text-based document.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      pages: pages.map((page) => ({
        pageNumber: page.pageNumber,
        wordCount: page.wordCount,
        preview: page.text.slice(0, 200).replace(/\s+/g, " "),
      })),
    });
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

    console.error("[pdf-metadata] Unexpected error", error);
    return NextResponse.json(
      {
        error: "Failed to analyze the uploaded PDF.",
        message: (error as Error).message,
      },
      { status: 500 },
    );
  }
}


