export interface DensitySettings {
  summaryDensity: number; // target percent of original length (0-100)
  quoteDensity: number; // relative weighting for number of quotes (0-100)
}

export interface PageContent {
  pageNumber: number;
  text: string;
  wordCount: number;
}

export interface PageSummary {
  pageNumber: number;
  summary: string;
  quotes: InlineQuote[];
}

export interface InlineQuote {
  text: string;
  commentary: string | null;
  originalPage: number;
}

export interface CondenseMetadata extends DensitySettings {
  title?: string | null;
  author?: string | null;
}


