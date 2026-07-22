import { config } from "../../package.json";

export const FILTER_TAG = "mdpi-filter:MDPI";
export const COLUMN_DATA_KEY = "mdpiFilterStatus";

const MDPI_DOI_PREFIX = "10.3390/";
const MDPI_DOMAINS = ["mdpi.com", "mdpi.org"];
const NCBI_ID_CONVERTER = "https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/";
const NCBI_BATCH_SIZE = 200;
const NCBI_TIMEOUT_MS = 15000;
const STRONG_MDPI_JOURNALS = [
  "Int J Mol Sci",
  "IJMS",
  "International Journal of Molecular Sciences",
];
const WEAK_MDPI_JOURNALS = ["Nutrients", "Molecules", "Toxins"];

export type ScanResult = {
  examined: number;
  matched: number;
  added: number;
  removed: number;
  errors: number;
};

type NCBIIdType = "pmid" | "pmcid";
type ItemIdentifiers = {
  pmids: string[];
  pmcids: string[];
};

let notifierID: string | undefined;
let notifierDrainPromise: Promise<void> | undefined;
const pendingItemIDs = new Set<number>();
const ncbiResultCache = new Map<string, boolean>();

function getField(item: Zotero.Item, field: string): string {
  try {
    const value = item.getField(field as any);
    return typeof value === "string"
      ? value.trim()
      : String(value || "").trim();
  } catch (_error) {
    return "";
  }
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function containsMDPIDOI(value: string): boolean {
  let candidate = value;
  try {
    candidate = decodeURIComponent(value);
  } catch (_error) {
    // Keep the original value when malformed percent-encoding is present.
  }
  return /(?:^|[^0-9])10\.3390\//i.test(candidate);
}

function isMDPIHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return MDPI_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function candidateURLs(value: string): string[] {
  const matches: string[] = value.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const trimmed = value.trim();
  if (trimmed && !matches.includes(trimmed)) {
    matches.unshift(trimmed);
  }
  return matches;
}

function containsMDPIURL(value: string): boolean {
  for (const candidate of candidateURLs(value)) {
    try {
      const parsed = new URL(
        /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
          ? candidate
          : `https://${candidate}`,
      );
      if (isMDPIHostname(parsed.hostname)) {
        return true;
      }
    } catch (_error) {
      // Ignore text that is not a valid absolute or host-like URL.
    }
  }
  return false;
}

function containsMDPIPublisher(value: string): boolean {
  return /\bMDPI\b|Multidisciplinary Digital Publishing Institute/i.test(value);
}

function matchesKnownMDPIJournal(item: Zotero.Item): boolean {
  const journalValues = [
    getField(item, "publicationTitle"),
    getField(item, "journalAbbreviation"),
  ]
    .map(normalizedText)
    .filter(Boolean);

  const knownNames = [...STRONG_MDPI_JOURNALS, ...WEAK_MDPI_JOURNALS].map(
    normalizedText,
  );
  return journalValues.some((value) => knownNames.includes(value));
}

export function isMDPIItem(item: Zotero.Item): boolean {
  if (!item?.isRegularItem?.()) {
    return false;
  }

  const doi = getField(item, "DOI");
  const url = getField(item, "url");
  const publisher = getField(item, "publisher");
  const extra = getField(item, "extra");

  return (
    containsMDPIDOI(doi) ||
    containsMDPIDOI(url) ||
    containsMDPIDOI(extra) ||
    containsMDPIURL(url) ||
    containsMDPIURL(extra) ||
    containsMDPIPublisher(publisher) ||
    /(?:^|\n)Publisher:\s*(?:MDPI|Multidisciplinary Digital Publishing Institute)\b/im.test(
      extra,
    ) ||
    matchesKnownMDPIJournal(item)
  );
}

function uniqueMatches(value: string, patterns: RegExp[]): string[] {
  const results = new Set<string>();
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      if (match[1]) {
        results.add(match[1]);
      }
    }
  }
  return Array.from(results);
}

function extractItemIdentifiers(item: Zotero.Item): ItemIdentifiers {
  const value = `${getField(item, "url")}\n${getField(item, "extra")}`;
  const pmids = uniqueMatches(value, [
    /(?:^|\n)\s*(?:PMID|PubMed ID)\s*:\s*(\d{1,20})\b/gim,
    /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,20})(?:[/?#]|$)/gi,
    /ncbi\.nlm\.nih\.gov\/pubmed\/(\d{1,20})(?:[/?#]|$)/gi,
    /europepmc\.org\/article\/MED\/(\d{1,20})(?:[/?#]|$)/gi,
  ]);
  const pmcids = uniqueMatches(value, [
    /(?:^|\n)\s*PMCID\s*:\s*(PMC\d{1,20})\b/gim,
    /pmc\.ncbi\.nlm\.nih\.gov\/articles\/(PMC\d{1,20})(?:[/?#]|$)/gi,
    /ncbi\.nlm\.nih\.gov\/pmc\/articles\/(PMC\d{1,20})(?:[/?#]|$)/gi,
    /europepmc\.org\/article\/PMC\/(PMC\d{1,20})(?:[/?#]|$)/gi,
  ]).map((value) => value.toUpperCase());

  return { pmids, pmcids };
}

function normalizeNCBIId(id: string, idType: NCBIIdType): string | undefined {
  const value = id.trim();
  if (idType === "pmid") {
    return /^\d{1,20}$/.test(value) ? value : undefined;
  }
  return /^PMC\d{1,20}$/i.test(value) ? value.toUpperCase() : undefined;
}

function recordIdentifiers(record: any): Set<string> {
  const identifiers = new Set<string>();
  const versions = Array.isArray(record?.versions) ? record.versions : [];
  for (const candidate of [record, ...versions]) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    if (candidate.pmid) {
      identifiers.add(String(candidate.pmid));
    }
    if (candidate.pmcid) {
      identifiers.add(String(candidate.pmcid).toUpperCase());
    }
  }
  return identifiers;
}

function recordIsMDPI(record: any): boolean {
  const versions = Array.isArray(record?.versions) ? record.versions : [];
  return [record, ...versions].some((candidate) =>
    String(candidate?.doi || "")
      .toLowerCase()
      .startsWith(MDPI_DOI_PREFIX),
  );
}

export function ncbiLookupEnabled(): boolean {
  try {
    return (
      Zotero.Prefs.get(`${config.prefsPrefix}.ncbiApiEnabled`, true) !== false
    );
  } catch (_error) {
    return true;
  }
}

async function fetchNCBIBatch(
  ids: string[],
  idType: NCBIIdType,
): Promise<any[] | undefined> {
  const url = new URL(NCBI_ID_CONVERTER);
  url.searchParams.set("ids", ids.join(","));
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
    return Array.isArray(data?.records) ? data.records : [];
  } catch (error) {
    logError(error);
    return undefined;
  }
}

async function resolveNCBIIds(
  ids: string[],
  idType: NCBIIdType,
): Promise<Map<string, boolean>> {
  const normalizedIds = Array.from(
    new Set(
      ids
        .map((id) => normalizeNCBIId(id, idType))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const results = new Map<string, boolean>();
  const uncached: string[] = [];

  for (const id of normalizedIds) {
    const cacheKey = `${idType}:${id}`;
    if (ncbiResultCache.has(cacheKey)) {
      results.set(id, ncbiResultCache.get(cacheKey) === true);
    } else {
      uncached.push(id);
    }
  }

  if (!ncbiLookupEnabled()) {
    return results;
  }

  for (let offset = 0; offset < uncached.length; offset += NCBI_BATCH_SIZE) {
    const batch = uncached.slice(offset, offset + NCBI_BATCH_SIZE);
    const records = await fetchNCBIBatch(batch, idType);
    if (!records) {
      continue;
    }

    const batchResults = new Map(batch.map((id) => [id, false]));
    for (const record of records) {
      const isMDPI = recordIsMDPI(record);
      for (const identifier of recordIdentifiers(record)) {
        if (batchResults.has(identifier)) {
          batchResults.set(identifier, isMDPI);
        }
      }
    }

    for (const [id, isMDPI] of batchResults) {
      results.set(id, isMDPI);
      ncbiResultCache.set(`${idType}:${id}`, isMDPI);
    }
  }

  return results;
}

export async function detectMDPIItem(item: Zotero.Item): Promise<boolean> {
  if (isMDPIItem(item)) {
    return true;
  }

  const identifiers = extractItemIdentifiers(item);
  const [pmidResults, pmcidResults] = await Promise.all([
    resolveNCBIIds(identifiers.pmids, "pmid"),
    resolveNCBIIds(identifiers.pmcids, "pmcid"),
  ]);
  return (
    identifiers.pmids.some((id) => pmidResults.get(id) === true) ||
    identifiers.pmcids.some((id) => pmcidResults.get(id.toUpperCase()) === true)
  );
}

function hasFilterTag(item: Zotero.Item): boolean {
  return item
    .getTags()
    .some((entry: { tag: string }) => entry.tag === FILTER_TAG);
}

function logError(error: unknown): void {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
}

export async function syncItems(items: Zotero.Item[]): Promise<ScanResult> {
  const result: ScanResult = {
    examined: 0,
    matched: 0,
    added: 0,
    removed: 0,
    errors: 0,
  };
  const regularItems = items.filter((item) => item?.isRegularItem?.());
  const localMatches = new Map<Zotero.Item, boolean>();
  const identifiersByItem = new Map<Zotero.Item, ItemIdentifiers>();
  const allPMIDs: string[] = [];
  const allPMCIDs: string[] = [];

  for (const item of regularItems) {
    const localMatch = isMDPIItem(item);
    localMatches.set(item, localMatch);
    if (!localMatch) {
      const identifiers = extractItemIdentifiers(item);
      identifiersByItem.set(item, identifiers);
      allPMIDs.push(...identifiers.pmids);
      allPMCIDs.push(...identifiers.pmcids);
    }
  }

  const [pmidResults, pmcidResults] = await Promise.all([
    resolveNCBIIds(allPMIDs, "pmid"),
    resolveNCBIIds(allPMCIDs, "pmcid"),
  ]);

  for (const item of regularItems) {
    result.examined += 1;
    const identifiers = identifiersByItem.get(item) || {
      pmids: [],
      pmcids: [],
    };
    const matches =
      localMatches.get(item) === true ||
      identifiers.pmids.some((id) => pmidResults.get(id) === true) ||
      identifiers.pmcids.some(
        (id) => pmcidResults.get(id.toUpperCase()) === true,
      );
    const tagged = hasFilterTag(item);

    if (matches) {
      result.matched += 1;
    }
    if (matches === tagged) {
      continue;
    }

    try {
      if (matches) {
        item.addTag(FILTER_TAG, 0);
        result.added += 1;
      } else {
        item.removeTag(FILTER_TAG);
        result.removed += 1;
      }
      await item.saveTx();
    } catch (error) {
      result.errors += 1;
      logError(error);
    }
  }

  return result;
}

export async function scanLibrary(libraryID: number): Promise<ScanResult> {
  const search = Object.assign(new Zotero.Search(), { libraryID });
  search.addCondition("itemType", "isNot", "attachment");
  search.addCondition("itemType", "isNot", "note");

  const ids = (await search.search()) as number[];
  if (!ids.length) {
    return {
      examined: 0,
      matched: 0,
      added: 0,
      removed: 0,
      errors: 0,
    };
  }

  const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
  return syncItems(items);
}

export async function registerMDPIColumn(): Promise<void> {
  const manager = Zotero.ItemTreeManager as any;
  const options = {
    pluginID: config.addonID,
    dataKey: COLUMN_DATA_KEY,
    label: "MDPI",
    dataProvider: (item: Zotero.Item) =>
      hasFilterTag(item) || isMDPIItem(item) ? "MDPI" : "",
  };

  if (typeof manager.registerColumn === "function") {
    await manager.registerColumn(options);
    return;
  }
  if (typeof manager.registerColumns === "function") {
    await manager.registerColumns(options);
    return;
  }
  throw new Error(
    "Zotero ItemTreeManager column registration API is unavailable",
  );
}

async function drainNotifierQueue(): Promise<void> {
  while (pendingItemIDs.size) {
    const ids = Array.from(pendingItemIDs);
    pendingItemIDs.clear();

    try {
      const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
      await syncItems(items);
    } catch (error) {
      logError(error);
    }
  }
}

function scheduleNotifierDrain(): void {
  if (notifierDrainPromise) {
    return;
  }

  notifierDrainPromise = Zotero.Promise.delay(0)
    .then(() => drainNotifierQueue())
    .catch(logError)
    .finally(() => {
      notifierDrainPromise = undefined;
      if (pendingItemIDs.size) {
        scheduleNotifierDrain();
      }
    });
}

function enqueueNotifierItems(ids: Array<string | number>): void {
  for (const id of ids) {
    const numericID = Number(id);
    if (Number.isInteger(numericID) && numericID > 0) {
      pendingItemIDs.add(numericID);
    }
  }
  scheduleNotifierDrain();
}

export function registerMDPINotifier(): void {
  if (notifierID) {
    return;
  }

  const observer = {
    notify: (event: string, type: string, ids: Array<string | number>) => {
      if (
        addon.data.alive &&
        type === "item" &&
        (event === "add" || event === "modify")
      ) {
        enqueueNotifierItems(ids);
      }
    },
  };

  notifierID = Zotero.Notifier.registerObserver(observer, ["item"]);
}

export function unregisterMDPINotifier(): void {
  if (!notifierID) {
    return;
  }

  Zotero.Notifier.unregisterObserver(notifierID);
  notifierID = undefined;
  pendingItemIDs.clear();
}
