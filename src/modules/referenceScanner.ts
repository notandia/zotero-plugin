import { config } from "../../package.json";

const MDPI_DOI_PREFIX = "10.3390/";
const MDPI_DOMAINS = ["mdpi.com", "mdpi.org"];
const NCBI_ID_CONVERTER =
  "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/";
const NCBI_TIMEOUT_MS = 15000;
const CONTEXT_RADIUS = 260;
const READER_PANE_ID = `${config.addonRef}-reader-references`;

export type MDPIReferenceMatch = {
  key: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  snippet: string;
  source: "doi" | "domain" | "ncbi";
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanDOI(value: string): string {
  return value
    .replace(/[),.;:\]}]+$/g, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .toLowerCase();
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

function addMatch(
  matches: Map<string, MDPIReferenceMatch>,
  match: MDPIReferenceMatch,
): void {
  if (!matches.has(match.key)) {
    matches.set(match.key, match);
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
  const normalized = Array.from(new Set(ids));
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
      if (recordPMCID && result.has(recordPMCID)) result.set(recordPMCID, isMDPI);
    }
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  }
  return result;
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

async function getAttachmentText(item: Zotero.Item): Promise<string> {
  if (!item?.isAttachment?.()) return "";
  try {
    return String((await (item as any).attachmentText) || "");
  } catch (_error) {
    return "";
  }
}

function renderMessage(body: Element, message: string): void {
  body.replaceChildren();
  const paragraph = body.ownerDocument.createElement("p");
  paragraph.textContent = message;
  paragraph.style.margin = "8px 0";
  body.appendChild(paragraph);
}

function renderMatches(body: Element, matches: MDPIReferenceMatch[]): void {
  body.replaceChildren();
  const document = body.ownerDocument;
  const intro = document.createElement("p");
  intro.textContent = `${matches.length} MDPI reference${matches.length === 1 ? "" : "s"} detected in the bibliography.`;
  intro.style.margin = "8px 0";
  body.appendChild(intro);

  const list = document.createElement("ol");
  list.style.paddingInlineStart = "24px";
  for (const match of matches) {
    const item = document.createElement("li");
    item.style.marginBottom = "10px";
    const identifier = match.doi || match.pmcid || match.pmid;
    if (identifier) {
      const strong = document.createElement("strong");
      strong.textContent = identifier;
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
      renderMessage(body, "Scanning indexed bibliography text…");
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
      const matches = await findMDPIReferences(text);
      if (!matches.length) {
        renderMessage(body, "No MDPI references were found in the bibliography.");
        setSectionSummary("0 found");
        return;
      }
      renderMatches(body, matches);
      setSectionSummary(`${matches.length} found`);
    },
  });
}

export function unregisterReferenceReaderSection(): void {
  const manager = Zotero.ItemPaneManager as any;
  if (typeof manager?.unregisterSection === "function") {
    manager.unregisterSection(READER_PANE_ID);
  }
}
