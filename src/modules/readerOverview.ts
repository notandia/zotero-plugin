import { config } from "../../package.json";
import {
  type CitationHighlightResult,
  type MDPIReferenceMatch,
  findMDPIReferencesForItem,
  highlightMDPICitations,
} from "./referenceScanner";

const READER_PANE_ID = `${config.addonRef}-reader-overview`;
const SOURCE_HIGHLIGHT_COLOR = "#e2211c";
const SOURCE_COMMENT_PREFIX = "Notandia bibliography source";

type PDFPosition = {
  pageIndex: number;
  rects: number[][];
};

export type SourceHighlightResult = {
  created: number;
  existing: number;
  notLocatable: number;
  errors: number;
};

function normalizeWhitespace(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDOI(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^doi\s*:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[),.;:\]}]+$/g, "")
    .toLowerCase();
}

async function getAttachmentText(item: Zotero.Item): Promise<string> {
  if (!item?.isAttachment?.()) return "";
  try {
    return String((await (item as any).attachmentText) || "");
  } catch (_error) {
    return "";
  }
}

function getOpenReader(item: Zotero.Item): any {
  const readers = ((Zotero.Reader as any)?._readers || []) as any[];
  return readers.find(
    (reader) =>
      Number(reader?.itemID) === Number(item.id) ||
      Number(reader?._item?.id) === Number(item.id),
  );
}

function waitFor(
  predicate: () => boolean,
  timeout = 15000,
  interval = 50,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() - started >= timeout) {
        reject(new Error("Timed out waiting for Zotero PDF search"));
      } else {
        setTimeout(check, interval);
      }
    };
    check();
  });
}

async function searchPDF(
  reader: any,
  query: string,
  entireWord: boolean,
): Promise<PDFPosition[]> {
  const view =
    reader?._internalReader?._primaryView ||
    reader?._internalReader?._view?._primaryView;
  const controller = view?._findController;
  if (!controller?.find || !controller?.getMatchPositionsAsync) return [];

  const pageCount = Number(
    view?._iframeWindow?.PDFViewerApplication?.pdfDocument?.numPages ||
      controller?._pdfDocument?.numPages ||
      0,
  );
  controller.find({
    query,
    type: "again",
    caseSensitive: false,
    entireWord,
    highlightAll: false,
    matchDiacritics: true,
    findPrevious: false,
  });
  await waitFor(
    () =>
      !controller._findTimeout &&
      (!controller._pendingFindMatches ||
        controller._pendingFindMatches.size === 0) &&
      (!pageCount || controller._visitedPagesCount >= pageCount),
  );

  const positions: PDFPosition[] = [];
  const matches = controller.pageMatches || controller._pageMatches || [];
  for (let pageIndex = 0; pageIndex < matches.length; pageIndex += 1) {
    if (!matches[pageIndex]?.length) continue;
    positions.push(...(await controller.getMatchPositionsAsync(pageIndex)));
  }
  return positions;
}

function boundingBox(position: PDFPosition): number[] | undefined {
  if (!position.rects?.length) return undefined;
  return [
    Math.min(...position.rects.map((rect) => rect[0])),
    Math.min(...position.rects.map((rect) => rect[1])),
    Math.max(...position.rects.map((rect) => rect[2])),
    Math.max(...position.rects.map((rect) => rect[3])),
  ];
}

function sortIndex(position: PDFPosition): string {
  const box = boundingBox(position) || [0, 0, 0, 0];
  const page = String(position.pageIndex).padStart(5, "0");
  const vertical = String(
    Math.max(0, Math.round(100000 - box[1] * 100)),
  ).padStart(6, "0");
  return `${page}|${vertical}|00000`;
}

function positionKey(position: PDFPosition): string {
  const rects = position.rects
    .map((rect) => rect.map((value) => Math.round(value * 10) / 10).join(","))
    .join(";");
  return `${position.pageIndex}:${rects}`;
}

function existingSourceKeys(item: Zotero.Item): Set<string> {
  const keys = new Set<string>();
  try {
    for (const annotation of (item as any).getAnnotations?.() || []) {
      const comment = String(annotation.annotationComment || "");
      const match = comment.match(/\nKey: ([^\n]+)/);
      if (comment.startsWith(SOURCE_COMMENT_PREFIX) && match?.[1]) {
        keys.add(match[1]);
      }
    }
  } catch (_error) {
    // The attachment may not expose annotations in tests.
  }
  return keys;
}

function sourceQueries(
  match: MDPIReferenceMatch,
): Array<{ text: string; entireWord: boolean; kind: string }> {
  const queries: Array<{ text: string; entireWord: boolean; kind: string }> =
    [];
  if (match.doi) {
    const doi = cleanDOI(match.doi);
    if (doi) {
      queries.push({ text: doi, entireWord: false, kind: "DOI" });
      queries.push({
        text: `https://doi.org/${doi}`,
        entireWord: false,
        kind: "DOI URL",
      });
    }
  }
  if (match.pmcid) {
    const pmcid = String(match.pmcid).toUpperCase().trim();
    queries.push({ text: pmcid, entireWord: true, kind: "PMCID" });
  }
  if (match.pmid) {
    const pmid = String(match.pmid).trim();
    queries.push({ text: `PMID: ${pmid}`, entireWord: false, kind: "PMID" });
    queries.push({ text: pmid, entireWord: true, kind: "PMID" });
  }

  const unique = new Map<string, (typeof queries)[number]>();
  for (const query of queries) {
    if (query.text) unique.set(`${query.entireWord}:${query.text}`, query);
  }
  return Array.from(unique.values());
}

async function addSourceHighlight(
  reader: any,
  position: PDFPosition,
  match: MDPIReferenceMatch,
  query: { text: string; kind: string },
  key: string,
): Promise<void> {
  const manager = reader?._internalReader?._annotationManager;
  if (!manager?.addAnnotation) {
    throw new Error("Zotero annotation manager is unavailable");
  }

  const identifier = match.doi || match.pmcid || match.pmid || match.key;
  const payload = {
    type: "highlight",
    color: SOURCE_HIGHLIGHT_COLOR,
    sortIndex: sortIndex(position),
    position,
    text: query.text,
    comment: `${SOURCE_COMMENT_PREFIX}\nReference: ${
      match.referenceLabel || match.referenceId || "unknown"
    }\nIdentifier: ${identifier}\nMatched by: ${query.kind}\nKey: ${key}`,
  };
  let cloned = payload;
  try {
    cloned = Components.utils.cloneInto(payload, reader._iframeWindow) as any;
  } catch (_error) {
    // Test doubles and future Zotero versions may accept the plain object.
  }
  await Promise.resolve(manager.addAnnotation(cloned));
}

export async function highlightMDPIReferenceSources(
  item: Zotero.Item,
  matches: MDPIReferenceMatch[],
  readerOverride?: any,
): Promise<SourceHighlightResult> {
  const result: SourceHighlightResult = {
    created: 0,
    existing: 0,
    notLocatable: 0,
    errors: 0,
  };
  if (!item?.isAttachment?.() || item.attachmentReaderType !== "pdf") {
    result.notLocatable = matches.length;
    return result;
  }

  const reader = readerOverride || getOpenReader(item);
  if (!reader) {
    result.notLocatable = matches.length;
    return result;
  }
  await reader._initPromise;

  const existing = existingSourceKeys(item);
  const createdThisRun = new Set<string>();
  const searchCache = new Map<string, Promise<PDFPosition[]>>();
  const search = (text: string, entireWord: boolean) => {
    const key = `${entireWord}:${text.toLowerCase()}`;
    let promise = searchCache.get(key);
    if (!promise) {
      promise = searchPDF(reader, text, entireWord);
      searchCache.set(key, promise);
    }
    return promise;
  };

  for (const match of matches) {
    const queries = sourceQueries(match);
    if (!queries.length) {
      result.notLocatable += 1;
      continue;
    }

    let located = false;
    for (const query of queries) {
      try {
        const positions = await search(query.text, query.entireWord);
        if (!positions.length) continue;
        located = true;
        for (const position of positions) {
          const key = `${match.referenceId || match.key}:${query.kind}:${positionKey(
            position,
          )}`;
          if (existing.has(key) || createdThisRun.has(key)) {
            result.existing += 1;
            continue;
          }
          await addSourceHighlight(reader, position, match, query, key);
          createdThisRun.add(key);
          result.created += 1;
        }
        break;
      } catch (error) {
        result.errors += 1;
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    if (!located) result.notLocatable += 1;
  }
  return result;
}

function renderMessage(body: Element, message: string): void {
  body.replaceChildren();
  const paragraph = body.ownerDocument!.createElement("p");
  paragraph.textContent = message;
  paragraph.style.margin = "8px 0";
  body.appendChild(paragraph);
}

function appendMetric(
  container: Element,
  label: string,
  value: string,
  detail: string,
): void {
  const document = container.ownerDocument!;
  const card = document.createElement("div");
  card.style.border =
    "1px solid color-mix(in srgb, currentColor 18%, transparent)";
  card.style.borderRadius = "8px";
  card.style.padding = "8px";
  card.style.minWidth = "118px";
  card.style.flex = "1 1 118px";

  const heading = document.createElement("div");
  heading.textContent = label;
  heading.style.fontSize = "11px";
  heading.style.opacity = "0.75";

  const number = document.createElement("strong");
  number.textContent = value;
  number.style.display = "block";
  number.style.fontSize = "18px";
  number.style.margin = "2px 0";

  const description = document.createElement("div");
  description.textContent = detail;
  description.style.fontSize = "11px";
  description.style.opacity = "0.75";

  card.append(heading, number, description);
  container.appendChild(card);
}

const EVIDENCE_LABELS: Record<MDPIReferenceMatch["source"], string> = {
  doi: "MDPI DOI",
  domain: "MDPI domain",
  ncbi: "NCBI resolution",
  "pmc-jats": "Structured PMC/JATS",
};

function renderOverview(
  body: Element,
  matches: MDPIReferenceMatch[],
  citations: CitationHighlightResult,
  sources: SourceHighlightResult,
): void {
  body.replaceChildren();
  const document = body.ownerDocument!;

  const metrics = document.createElement("div");
  metrics.style.display = "flex";
  metrics.style.flexWrap = "wrap";
  metrics.style.gap = "6px";
  metrics.style.margin = "8px 0 10px";
  appendMetric(
    metrics,
    "Publisher matches",
    String(matches.length),
    "MDPI references",
  );
  appendMetric(
    metrics,
    "In-text citations",
    String(citations.created + citations.existing),
    `${citations.created} new · ${citations.existing} existing`,
  );
  appendMetric(
    metrics,
    "Bibliography sources",
    String(sources.created + sources.existing),
    `${sources.created} new · ${sources.existing} existing`,
  );
  body.appendChild(metrics);

  const note = document.createElement("p");
  note.textContent =
    "This panel reports publisher-context evidence. Formal retraction, correction, withdrawal, and expression-of-concern checks are not yet available in the Zotero plugin.";
  note.style.margin = "8px 0";
  note.style.fontSize = "12px";
  body.appendChild(note);

  const evidenceCounts = new Map<string, number>();
  for (const match of matches) {
    const label = EVIDENCE_LABELS[match.source] || match.source;
    evidenceCounts.set(label, (evidenceCounts.get(label) || 0) + 1);
  }
  const evidence = document.createElement("p");
  evidence.textContent = `Evidence: ${Array.from(evidenceCounts.entries())
    .map(([label, count]) => `${count} ${label}`)
    .join(" · ")}.`;
  evidence.style.margin = "8px 0";
  evidence.style.fontSize = "12px";
  body.appendChild(evidence);

  if (
    citations.skippedUnsafe ||
    sources.notLocatable ||
    citations.errors ||
    sources.errors
  ) {
    const limitations = document.createElement("p");
    const parts = [];
    if (citations.skippedUnsafe) {
      parts.push(
        `${citations.skippedUnsafe} ambiguous citation marker${
          citations.skippedUnsafe === 1 ? "" : "s"
        } skipped`,
      );
    }
    if (sources.notLocatable) {
      parts.push(
        `${sources.notLocatable} bibliography source${
          sources.notLocatable === 1 ? "" : "s"
        } not safely locatable`,
      );
    }
    const errors = citations.errors + sources.errors;
    if (errors)
      parts.push(`${errors} highlighting error${errors === 1 ? "" : "s"}`);
    limitations.textContent = parts.join(" · ");
    limitations.style.margin = "8px 0";
    limitations.style.fontSize = "12px";
    body.appendChild(limitations);
  }

  const list = document.createElement("ol");
  list.style.paddingInlineStart = "24px";
  for (const match of matches) {
    const item = document.createElement("li");
    item.style.marginBottom = "10px";

    const heading = document.createElement("strong");
    heading.textContent = [
      match.referenceLabel ? `Reference ${match.referenceLabel}` : "Reference",
      match.doi || match.pmcid || match.pmid || "",
    ]
      .filter(Boolean)
      .join(" — ");
    item.appendChild(heading);

    const evidenceLabel = document.createElement("div");
    evidenceLabel.textContent = EVIDENCE_LABELS[match.source] || match.source;
    evidenceLabel.style.fontSize = "11px";
    evidenceLabel.style.fontWeight = "600";
    evidenceLabel.style.margin = "2px 0";
    evidenceLabel.style.opacity = "0.75";
    item.appendChild(evidenceLabel);

    const snippet = document.createElement("span");
    snippet.textContent = normalizeWhitespace(match.snippet);
    item.appendChild(snippet);
    list.appendChild(item);
  }
  body.appendChild(list);
}

export function registerReaderOverviewSection(): void {
  const manager = Zotero.ItemPaneManager as any;
  if (typeof manager?.registerSection !== "function") return;

  manager.registerSection({
    paneID: READER_PANE_ID,
    pluginID: config.addonID,
    header: {
      l10nID: `${config.addonRef}-reader-overview-header`,
      icon: `chrome://${config.addonRef}/content/icons/favicon.png`,
    },
    sidenav: {
      l10nID: `${config.addonRef}-reader-overview-sidenav`,
      icon: `chrome://${config.addonRef}/content/icons/favicon.png`,
    },
    onItemChange: ({ item, setEnabled, tabType }: any) => {
      setEnabled(tabType === "reader" && item?.isAttachment?.());
      return true;
    },
    onRender: ({ body, setSectionSummary }: any) => {
      renderMessage(body, "Scanning references and citation markers…");
      setSectionSummary("Scanning…");
    },
    onAsyncRender: async ({ body, item, setSectionSummary }: any) => {
      const text = await getAttachmentText(item);
      if (!text.trim()) {
        renderMessage(
          body,
          "No indexed text is available yet. Right-click the attachment, choose Reindex Item, and reopen this section.",
        );
        setSectionSummary("No indexed text");
        return;
      }

      const matches = await findMDPIReferencesForItem(item, text);
      if (!matches.length) {
        renderMessage(
          body,
          "No MDPI publisher-context references were found. Journal-title resemblance is intentionally not treated as evidence.",
        );
        setSectionSummary("0 publisher matches");
        return;
      }

      const citations = await highlightMDPICitations(item, matches);
      const sources = await highlightMDPIReferenceSources(item, matches);
      renderOverview(body, matches, citations, sources);
      setSectionSummary(
        `${matches.length} matches · ${
          citations.created + citations.existing
        } citations · ${sources.created + sources.existing} sources`,
      );
    },
  });
}

export function unregisterReaderOverviewSection(): void {
  const manager = Zotero.ItemPaneManager as any;
  if (typeof manager?.unregisterSection === "function") {
    manager.unregisterSection(READER_PANE_ID);
  }
}
