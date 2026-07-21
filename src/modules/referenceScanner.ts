import { config } from "../../package.json";

const MDPI_DOI_PREFIX = "10.3390/";
const MDPI_DOMAINS = ["mdpi.com", "mdpi.org"];
const NCBI_ID_CONVERTER =
  "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/";
const NCBI_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const NCBI_TIMEOUT_MS = 30000;
const CONTEXT_RADIUS = 260;
const READER_PANE_ID = `${config.addonRef}-reader-references`;
const HIGHLIGHT_COLOR = "#e2211c";
const HIGHLIGHT_COMMENT_PREFIX = "MDPI Filter citation";

export type CitationMarker = {
  text: string;
  safe: boolean;
};

export type MDPIReferenceMatch = {
  key: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  referenceId?: string;
  referenceLabel?: string;
  citationMarkers?: CitationMarker[];
  snippet: string;
  source: "doi" | "domain" | "ncbi" | "pmc-jats";
};

export type CitationHighlightResult = {
  created: number;
  existing: number;
  skippedUnsafe: number;
  errors: number;
};

type StructuredReferenceCandidate = {
  referenceId: string;
  referenceLabel?: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  snippet: string;
  citationMarkers: CitationMarker[];
  domainMatch: boolean;
};

type PDFPosition = {
  pageIndex: number;
  rects: number[][];
};

const pmcReferenceCache = new Map<
  string,
  Promise<MDPIReferenceMatch[] | undefined>
>();

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getField(item: Zotero.Item | undefined, field: string): string {
  if (!item) return "";
  try {
    const value = item.getField(field as any);
    return typeof value === "string"
      ? value.trim()
      : String(value || "").trim();
  } catch (_error) {
    return "";
  }
}

function cleanDOI(value: string): string {
  return value
    .replace(/[),.;:\]}]+$/g, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .toLowerCase();
}

function containsMDPIDOI(value: string): boolean {
  return cleanDOI(value).startsWith(MDPI_DOI_PREFIX);
}

function extractReferenceSection(text: string): string {
  const headings = Array.from(
    text.matchAll(
      /(?:^|\n)\s*(?:references|bibliography|literature cited)\s*(?:\n|$)/gim,
    ),
  );
  const heading = headings.at(-1);
  if (heading?.index !== undefined) {
    return text.slice(heading.index + heading[0].length);
  }
  return text.length > 4000 ? text.slice(Math.floor(text.length * 0.55)) : text;
}

function contextSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - CONTEXT_RADIUS);
  const end = Math.min(text.length, index + length + CONTEXT_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${normalizeWhitespace(text.slice(start, end))}${suffix}`;
}

function isMDPIHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return MDPI_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function containsMDPIURL(value: string): boolean {
  for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    try {
      const url = new URL(match[0].replace(/[),.;:\]}]+$/g, ""));
      if (isMDPIHostname(url.hostname)) return true;
    } catch (_error) {
      // Ignore malformed links in extracted text or XML.
    }
  }
  return false;
}

function addMatch(
  matches: Map<string, MDPIReferenceMatch>,
  match: MDPIReferenceMatch,
): void {
  const existing = matches.get(match.key);
  if (!existing) {
    matches.set(match.key, match);
    return;
  }
  if (match.citationMarkers?.length) {
    const markers = new Map(
      (existing.citationMarkers || []).map((entry) => [
        `${entry.safe}:${entry.text}`,
        entry,
      ]),
    );
    for (const marker of match.citationMarkers) {
      markers.set(`${marker.safe}:${marker.text}`, marker);
    }
    existing.citationMarkers = Array.from(markers.values());
  }
}

function extractLocalMatches(text: string): Map<string, MDPIReferenceMatch> {
  const matches = new Map<string, MDPIReferenceMatch>();
  const doiPattern = /\b10\.3390\/[A-Z0-9._;()/:+-]+/gi;
  for (const found of text.matchAll(doiPattern)) {
    if (found.index === undefined) continue;
    const doi = cleanDOI(found[0]);
    addMatch(matches, {
      key: `doi:${doi}`,
      doi,
      snippet: contextSnippet(text, found.index, found[0].length),
      source: "doi",
    });
  }

  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  for (const found of text.matchAll(urlPattern)) {
    if (found.index === undefined) continue;
    try {
      const url = new URL(found[0].replace(/[),.;:\]}]+$/g, ""));
      if (!isMDPIHostname(url.hostname)) continue;
      const key = `url:${url.origin}${url.pathname}`;
      addMatch(matches, {
        key,
        snippet: contextSnippet(text, found.index, found[0].length),
        source: "domain",
      });
    } catch (_error) {
      // Ignore malformed URLs extracted from PDF text.
    }
  }
  return matches;
}

function extractIdentifiers(text: string): {
  pmids: Array<{ id: string; index: number; length: number }>;
  pmcids: Array<{ id: string; index: number; length: number }>;
} {
  const pmids: Array<{ id: string; index: number; length: number }> = [];
  const pmcids: Array<{ id: string; index: number; length: number }> = [];

  for (const found of text.matchAll(/\bPMID\s*:?\s*(\d{1,20})\b/gi)) {
    if (found.index === undefined || !found[1]) continue;
    pmids.push({ id: found[1], index: found.index, length: found[0].length });
  }
  for (const found of text.matchAll(/\bPMC\d{1,20}\b/gi)) {
    if (found.index === undefined) continue;
    pmcids.push({
      id: found[0].toUpperCase(),
      index: found.index,
      length: found[0].length,
    });
  }
  return { pmids, pmcids };
}

async function resolveNCBI(
  ids: string[],
  idType: "pmid" | "pmcid",
): Promise<Map<string, boolean>> {
  const normalized = Array.from(
    new Set(
      ids
        .map((id) => (idType === "pmcid" ? id.toUpperCase().trim() : id.trim()))
        .filter(Boolean),
    ),
  );
  const result = new Map(normalized.map((id) => [id, false]));
  if (!normalized.length) return result;

  const url = new URL(NCBI_ID_CONVERTER);
  url.searchParams.set("ids", normalized.join(","));
  url.searchParams.set("idtype", idType);
  url.searchParams.set("format", "json");
  url.searchParams.set("versions", "no");
  url.searchParams.set("tool", "MDPIFilterZotero");

  try {
    const response = await (Zotero.HTTP as any).request("GET", url.toString(), {
      anon: true,
      errorDelayMax: 0,
      responseType: "json",
      successCodes: [200],
      timeout: NCBI_TIMEOUT_MS,
    });
    const data =
      response.response ||
      (response.responseText ? JSON.parse(response.responseText) : undefined);
    const records = Array.isArray(data?.records) ? data.records : [];
    for (const record of records) {
      const doi = String(record?.doi || "").toLowerCase();
      const isMDPI = doi.startsWith(MDPI_DOI_PREFIX);
      const recordPMID = record?.pmid ? String(record.pmid) : undefined;
      const recordPMCID = record?.pmcid
        ? String(record.pmcid).toUpperCase()
        : undefined;
      if (recordPMID && result.has(recordPMID)) result.set(recordPMID, isMDPI);
      if (recordPMCID && result.has(recordPMCID))
        result.set(recordPMCID, isMDPI);
    }
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  }
  return result;
}

function directChildText(element: Element, localName: string): string {
  const child = Array.from(element.children).find(
    (candidate) => candidate.localName.toLowerCase() === localName,
  );
  return normalizeWhitespace(child?.textContent || "");
}

function firstText(element: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const value = normalizeWhitespace(
      element.querySelector(selector)?.textContent || "",
    );
    if (value) return value;
  }
  return "";
}

function elementHref(element: Element): string {
  return (
    element.getAttribute("href") ||
    element.getAttribute("xlink:href") ||
    element.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
    ""
  );
}

function referenceDOI(reference: Element): string | undefined {
  const selectors = [
    "pub-id[pub-id-type='doi']",
    "article-id[pub-id-type='doi']",
    "object-id[pub-id-type='doi']",
  ];
  const structured = firstText(reference, selectors);
  if (structured) return cleanDOI(structured);

  for (const link of Array.from<Element>(
    reference.querySelectorAll("ext-link, uri") as any,
  )) {
    const candidate = `${link.textContent || ""} ${elementHref(link)}`;
    const match = candidate.match(/\b10\.\d{4,9}\/[^\s<>"']+/i);
    if (match) return cleanDOI(match[0]);
  }
  const fallback = normalizeWhitespace(reference.textContent || "").match(
    /\b10\.\d{4,9}\/[A-Z0-9._;()/:+-]+/i,
  );
  return fallback ? cleanDOI(fallback[0]) : undefined;
}

function referenceIdentifier(
  reference: Element,
  type: "pmid" | "pmcid",
): string | undefined {
  const selectors =
    type === "pmid"
      ? ["pub-id[pub-id-type='pmid']", "article-id[pub-id-type='pmid']"]
      : ["pub-id[pub-id-type='pmcid']", "article-id[pub-id-type='pmcid']"];
  const value = firstText(reference, selectors);
  if (!value) return undefined;
  return type === "pmcid" ? value.toUpperCase() : value;
}

function citationGroupAround(xref: Element): CitationMarker {
  const ownText = normalizeWhitespace(xref.textContent || "");
  const previous = String(xref.previousSibling?.textContent || "").slice(-32);
  const next = String(xref.nextSibling?.textContent || "").slice(0, 32);
  const combined = `${previous}${xref.textContent || ""}${next}`;
  const ownStart = previous.length;
  const ownEnd = ownStart + String(xref.textContent || "").length;
  const groupPattern =
    /(?:\[|\()\s*\d+(?:\s*(?:[,;]|\u2013|\u2014|-)\s*\d+)*\s*(?:\]|\))/g;
  for (const found of combined.matchAll(groupPattern)) {
    const start = found.index || 0;
    const end = start + found[0].length;
    if (start <= ownStart && end >= ownEnd) {
      return { text: normalizeWhitespace(found[0]), safe: true };
    }
  }

  const directGroup = ownText.match(
    /^(?:\[|\()\s*\d+(?:\s*(?:[,;]|\u2013|\u2014|-)\s*\d+)*\s*(?:\]|\))$/,
  );
  if (directGroup) {
    return { text: directGroup[0], safe: true };
  }

  return { text: ownText, safe: false };
}

function citationMarkersForReference(
  document: Document,
  referenceId: string,
): CitationMarker[] {
  const markers = new Map<string, CitationMarker>();
  for (const xref of Array.from<Element>(
    document.querySelectorAll("xref[ref-type='bibr'][rid]") as any,
  )) {
    const ids = String(xref.getAttribute("rid") || "")
      .trim()
      .split(/\s+/);
    if (!ids.includes(referenceId)) continue;
    const marker = citationGroupAround(xref);
    if (!marker.text || !/\d/.test(marker.text)) continue;
    markers.set(`${marker.safe}:${marker.text}`, marker);
  }
  return Array.from(markers.values());
}

function parseXML(xmlText: string): Document | undefined {
  const parser = new DOMParser();
  const document = parser.parseFromString(xmlText, "application/xml");
  if (document.querySelector("parsererror")) return undefined;
  return document;
}

function parsePMCReferenceCandidates(
  xmlText: string,
): StructuredReferenceCandidate[] {
  const document = parseXML(xmlText);
  if (!document) return [];

  const candidates: StructuredReferenceCandidate[] = [];
  for (const reference of Array.from<Element>(
    document.querySelectorAll("ref-list ref[id]") as any,
  )) {
    const referenceId = reference.getAttribute("id") || "";
    if (!referenceId) continue;
    const doi = referenceDOI(reference);
    const pmid = referenceIdentifier(reference, "pmid");
    const pmcid = referenceIdentifier(reference, "pmcid");
    const rawText = normalizeWhitespace(reference.textContent || "");
    const links = Array.from<Element>(
      reference.querySelectorAll("ext-link, uri") as any,
    )
      .map((entry) => `${entry.textContent || ""} ${elementHref(entry)}`)
      .join(" ");
    candidates.push({
      referenceId,
      referenceLabel: directChildText(reference, "label") || undefined,
      doi,
      pmid,
      pmcid,
      snippet: rawText,
      citationMarkers: citationMarkersForReference(document, referenceId),
      domainMatch: containsMDPIURL(`${rawText} ${links}`),
    });
  }
  return candidates;
}

export async function parsePMCReferenceXML(
  xmlText: string,
): Promise<MDPIReferenceMatch[]> {
  const candidates = parsePMCReferenceCandidates(xmlText);
  const unresolvedPMIDs = candidates
    .filter(
      (entry) =>
        !containsMDPIDOI(entry.doi || "") && !entry.domainMatch && entry.pmid,
    )
    .map((entry) => entry.pmid as string);
  const unresolvedPMCIDs = candidates
    .filter(
      (entry) =>
        !containsMDPIDOI(entry.doi || "") && !entry.domainMatch && entry.pmcid,
    )
    .map((entry) => entry.pmcid as string);
  const [pmidResults, pmcidResults] = await Promise.all([
    resolveNCBI(unresolvedPMIDs, "pmid"),
    resolveNCBI(unresolvedPMCIDs, "pmcid"),
  ]);

  return candidates
    .filter(
      (entry) =>
        containsMDPIDOI(entry.doi || "") ||
        entry.domainMatch ||
        (entry.pmid ? pmidResults.get(entry.pmid) === true : false) ||
        (entry.pmcid
          ? pmcidResults.get(entry.pmcid.toUpperCase()) === true
          : false),
    )
    .map((entry) => ({
      key: `pmc-ref:${entry.referenceId}`,
      doi: entry.doi,
      pmid: entry.pmid,
      pmcid: entry.pmcid,
      referenceId: entry.referenceId,
      referenceLabel: entry.referenceLabel,
      citationMarkers: entry.citationMarkers,
      snippet: entry.snippet,
      source: "pmc-jats" as const,
    }));
}

function extractPMCIDFromText(value: string): string | undefined {
  const explicit = value.match(/\bPMCID\s*:\s*(PMC\d{1,20})\b/i);
  if (explicit) return explicit[1].toUpperCase();
  const url = value.match(
    /(?:pmc\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pmc)\/articles\/(PMC\d{1,20})\b/i,
  );
  if (url) return url[1].toUpperCase();
  const standalone = value.match(/\bPMC\d{4,20}\b/i);
  return standalone?.[0].toUpperCase();
}

export function getItemPMCID(item: Zotero.Item): string | undefined {
  let parent: Zotero.Item | undefined;
  try {
    parent = item.parentID
      ? (Zotero.Items.get(item.parentID) as Zotero.Item | undefined)
      : undefined;
  } catch (_error) {
    parent = undefined;
  }
  const values = [
    getField(item, "extra"),
    getField(item, "url"),
    getField(parent, "extra"),
    getField(parent, "url"),
  ];
  for (const value of values) {
    const pmcid = extractPMCIDFromText(value);
    if (pmcid) return pmcid;
  }
  return undefined;
}

export async function fetchPMCReferenceMatches(
  pmcid: string,
): Promise<MDPIReferenceMatch[] | undefined> {
  const normalized = extractPMCIDFromText(pmcid);
  if (!normalized) return undefined;
  const cached = pmcReferenceCache.get(normalized);
  if (cached) return cached;

  const promise = (async () => {
    const url = new URL(NCBI_EFETCH);
    url.searchParams.set("db", "pmc");
    url.searchParams.set("id", normalized);
    url.searchParams.set("retmode", "xml");
    url.searchParams.set("tool", "MDPIFilterZotero");
    try {
      const response = await (Zotero.HTTP as any).request(
        "GET",
        url.toString(),
        {
          anon: true,
          errorDelayMax: 0,
          responseType: "text",
          successCodes: [200],
          timeout: NCBI_TIMEOUT_MS,
        },
      );
      const xmlText = String(response.responseText || response.response || "");
      if (!xmlText.trim()) return undefined;
      return await parsePMCReferenceXML(xmlText);
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      return undefined;
    }
  })();
  pmcReferenceCache.set(normalized, promise);
  return promise;
}

export async function findMDPIReferences(
  text: string,
): Promise<MDPIReferenceMatch[]> {
  const referenceText = extractReferenceSection(String(text || ""));
  const matches = extractLocalMatches(referenceText);
  const identifiers = extractIdentifiers(referenceText);
  const [pmidResults, pmcidResults] = await Promise.all([
    resolveNCBI(
      identifiers.pmids.map((entry) => entry.id),
      "pmid",
    ),
    resolveNCBI(
      identifiers.pmcids.map((entry) => entry.id),
      "pmcid",
    ),
  ]);

  for (const entry of identifiers.pmids) {
    if (pmidResults.get(entry.id) !== true) continue;
    addMatch(matches, {
      key: `pmid:${entry.id}`,
      pmid: entry.id,
      snippet: contextSnippet(referenceText, entry.index, entry.length),
      source: "ncbi",
    });
  }
  for (const entry of identifiers.pmcids) {
    if (pmcidResults.get(entry.id) !== true) continue;
    addMatch(matches, {
      key: `pmcid:${entry.id}`,
      pmcid: entry.id,
      snippet: contextSnippet(referenceText, entry.index, entry.length),
      source: "ncbi",
    });
  }

  return Array.from(matches.values());
}

export async function findMDPIReferencesForItem(
  item: Zotero.Item,
  text: string,
): Promise<MDPIReferenceMatch[]> {
  const localMatches = await findMDPIReferences(text);
  const pmcid = getItemPMCID(item);
  if (!pmcid) return localMatches;
  const structured = await fetchPMCReferenceMatches(pmcid);
  if (!structured) return localMatches;

  const matches = new Map<string, MDPIReferenceMatch>();
  for (const entry of structured) addMatch(matches, entry);
  for (const entry of localMatches) {
    const duplicate = Array.from(matches.values()).some(
      (candidate) =>
        (entry.doi &&
          candidate.doi &&
          cleanDOI(entry.doi) === cleanDOI(candidate.doi)) ||
        (entry.pmid && candidate.pmid === entry.pmid) ||
        (entry.pmcid &&
          candidate.pmcid?.toUpperCase() === entry.pmcid.toUpperCase()),
    );
    if (!duplicate) addMatch(matches, entry);
  }
  return Array.from(matches.values());
}

async function getAttachmentText(item: Zotero.Item): Promise<string> {
  if (!item?.isAttachment?.()) return "";
  try {
    return String((await (item as any).attachmentText) || "");
  } catch (_error) {
    return "";
  }
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

function getOpenReader(item: Zotero.Item): any {
  const readers = ((Zotero.Reader as any)?._readers || []) as any[];
  return readers.find(
    (reader) =>
      Number(reader?.itemID) === Number(item.id) ||
      Number(reader?._item?.id) === Number(item.id),
  );
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
    caseSensitive: true,
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

function positionContains(
  outer: PDFPosition,
  inner: PDFPosition,
  tolerance = 2,
): boolean {
  if (outer.pageIndex !== inner.pageIndex) return false;
  const outerBox = boundingBox(outer);
  const innerBox = boundingBox(inner);
  if (!outerBox || !innerBox) return false;
  const centerX = (innerBox[0] + innerBox[2]) / 2;
  const centerY = (innerBox[1] + innerBox[3]) / 2;
  return (
    centerX >= outerBox[0] - tolerance &&
    centerX <= outerBox[2] + tolerance &&
    centerY >= outerBox[1] - tolerance &&
    centerY <= outerBox[3] + tolerance
  );
}

function normalizedMarker(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\s+/g, "");
}

function markerContainsOnlyLabel(marker: string, label: string): boolean {
  const normalized = normalizedMarker(marker);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[\\[(]${escaped}[\\])]$`).test(normalized);
}

function positionKey(position: PDFPosition): string {
  const rects = position.rects
    .map((rect) => rect.map((value) => Math.round(value * 10) / 10).join(","))
    .join(";");
  return `${position.pageIndex}:${rects}`;
}

function existingHighlightKeys(item: Zotero.Item): Set<string> {
  const keys = new Set<string>();
  try {
    for (const annotation of (item as any).getAnnotations?.() || []) {
      const comment = String(annotation.annotationComment || "");
      const match = comment.match(/\nKey: ([^\n]+)/);
      if (comment.startsWith(HIGHLIGHT_COMMENT_PREFIX) && match?.[1]) {
        keys.add(match[1]);
      }
    }
  } catch (_error) {
    // The attachment may not expose annotations in tests.
  }
  return keys;
}

function sortIndex(position: PDFPosition): string {
  const box = boundingBox(position) || [0, 0, 0, 0];
  const page = String(position.pageIndex).padStart(5, "0");
  const vertical = String(
    Math.max(0, Math.round(100000 - box[1] * 100)),
  ).padStart(6, "0");
  return `${page}|${vertical}|00000`;
}

async function addHighlight(
  reader: any,
  position: PDFPosition,
  match: MDPIReferenceMatch,
  marker: string,
  key: string,
): Promise<void> {
  const manager = reader?._internalReader?._annotationManager;
  if (!manager?.addAnnotation) {
    throw new Error("Zotero annotation manager is unavailable");
  }
  const identifier = match.doi || match.pmcid || match.pmid || match.key;
  const payload = {
    type: "highlight",
    color: HIGHLIGHT_COLOR,
    sortIndex: sortIndex(position),
    position,
    text: marker,
    comment: `${HIGHLIGHT_COMMENT_PREFIX}\nReference: ${
      match.referenceLabel || match.referenceId || "unknown"
    }\nIdentifier: ${identifier}\nKey: ${key}`,
  };
  let cloned = payload;
  try {
    cloned = Components.utils.cloneInto(payload, reader._iframeWindow) as any;
  } catch (_error) {
    // Test doubles and future Zotero versions may accept the plain object.
  }
  await Promise.resolve(manager.addAnnotation(cloned));
}

export async function highlightMDPICitations(
  item: Zotero.Item,
  matches: MDPIReferenceMatch[],
  readerOverride?: any,
): Promise<CitationHighlightResult> {
  const result: CitationHighlightResult = {
    created: 0,
    existing: 0,
    skippedUnsafe: 0,
    errors: 0,
  };
  if (!item?.isAttachment?.() || item.attachmentReaderType !== "pdf") {
    return result;
  }
  const reader = readerOverride || getOpenReader(item);
  if (!reader) return result;
  await reader._initPromise;

  const existing = existingHighlightKeys(item);
  const createdThisRun = new Set<string>();
  const searchCache = new Map<string, Promise<PDFPosition[]>>();
  const search = (query: string, entireWord: boolean) => {
    const key = `${entireWord}:${query}`;
    let promise = searchCache.get(key);
    if (!promise) {
      promise = searchPDF(reader, query, entireWord);
      searchCache.set(key, promise);
    }
    return promise;
  };

  for (const match of matches) {
    const label = normalizeWhitespace(match.referenceLabel || "");
    if (!label || !/^\d+[A-Za-z]?$/.test(label)) continue;
    for (const marker of match.citationMarkers || []) {
      if (!marker.safe) {
        result.skippedUnsafe += 1;
        continue;
      }
      try {
        const groupPositions = await search(marker.text, false);
        let targetPositions = groupPositions;
        if (!markerContainsOnlyLabel(marker.text, label)) {
          const labelPositions = await search(label, true);
          targetPositions = labelPositions.filter((position) =>
            groupPositions.some((group) => positionContains(group, position)),
          );
        }
        for (const position of targetPositions) {
          const key = `${match.referenceId || match.key}:${normalizedMarker(
            marker.text,
          )}:${positionKey(position)}`;
          if (existing.has(key) || createdThisRun.has(key)) {
            result.existing += 1;
            continue;
          }
          await addHighlight(reader, position, match, marker.text, key);
          createdThisRun.add(key);
          result.created += 1;
        }
      } catch (error) {
        result.errors += 1;
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
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

function renderMatches(
  body: Element,
  matches: MDPIReferenceMatch[],
  highlights?: CitationHighlightResult,
): void {
  body.replaceChildren();
  const document = body.ownerDocument!;
  const intro = document.createElement("p");
  const highlightMessage = highlights
    ? ` ${highlights.created} new citation highlight${
        highlights.created === 1 ? "" : "s"
      }; ${highlights.existing} already present${
        highlights.skippedUnsafe
          ? `; ${highlights.skippedUnsafe} ambiguous bare marker${
              highlights.skippedUnsafe === 1 ? "" : "s"
            } deliberately skipped`
          : ""
      }.`
    : "";
  intro.textContent = `${matches.length} MDPI reference${
    matches.length === 1 ? "" : "s"
  } detected in the bibliography.${highlightMessage}`;
  intro.style.margin = "8px 0";
  body.appendChild(intro);

  const list = document.createElement("ol");
  list.style.paddingInlineStart = "24px";
  for (const match of matches) {
    const item = document.createElement("li");
    item.style.marginBottom = "10px";
    const heading = [
      match.referenceLabel ? `Reference ${match.referenceLabel}` : "",
      match.doi || match.pmcid || match.pmid || "",
    ]
      .filter(Boolean)
      .join(" — ");
    if (heading) {
      const strong = document.createElement("strong");
      strong.textContent = heading;
      item.appendChild(strong);
      item.appendChild(document.createElement("br"));
    }
    const snippet = document.createElement("span");
    snippet.textContent = match.snippet;
    item.appendChild(snippet);
    list.appendChild(item);
  }
  body.appendChild(list);
}

export function registerReferenceReaderSection(): void {
  const manager = Zotero.ItemPaneManager as any;
  if (typeof manager?.registerSection !== "function") return;

  manager.registerSection({
    paneID: READER_PANE_ID,
    pluginID: config.addonID,
    header: {
      l10nID: `${config.addonRef}-reader-references-header`,
      icon: `chrome://${config.addonRef}/content/icons/favicon.png`,
    },
    sidenav: {
      l10nID: `${config.addonRef}-reader-references-sidenav`,
      icon: `chrome://${config.addonRef}/content/icons/favicon.png`,
    },
    onItemChange: ({ item, setEnabled, tabType }: any) => {
      setEnabled(tabType === "reader" && item?.isAttachment?.());
      return true;
    },
    onRender: ({ body, setSectionSummary }: any) => {
      renderMessage(
        body,
        "Scanning structured PMC references and indexed text…",
      );
      setSectionSummary("Scanning…");
    },
    onAsyncRender: async ({ body, item, setSectionSummary }: any) => {
      const text = await getAttachmentText(item);
      if (!text.trim()) {
        renderMessage(
          body,
          "No indexed text is available yet. In Zotero, right-click the PDF or HTML attachment and choose Reindex Item, then reopen this section.",
        );
        setSectionSummary("No indexed text");
        return;
      }
      const matches = await findMDPIReferencesForItem(item, text);
      if (!matches.length) {
        renderMessage(
          body,
          "No MDPI references were found. Journal-title capitalization is intentionally not used as evidence.",
        );
        setSectionSummary("0 found");
        return;
      }
      const highlights = await highlightMDPICitations(item, matches);
      renderMatches(body, matches, highlights);
      setSectionSummary(
        `${matches.length} found, ${highlights.created} highlighted`,
      );
    },
  });
}

export function unregisterReferenceReaderSection(): void {
  const manager = Zotero.ItemPaneManager as any;
  if (typeof manager?.unregisterSection === "function") {
    manager.unregisterSection(READER_PANE_ID);
  }
}
