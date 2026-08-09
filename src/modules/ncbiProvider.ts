import { config } from "../../package.json";
import { normalizeDOI, normalizePMCID, normalizePMID } from "./workIdentifiers";

export type NCBIIdType = "pmid" | "pmcid" | "doi";
export type NCBIProviderStatus =
  "ok" | "disabled" | "invalid" | "blocked" | "throttled" | "unavailable";

export type NCBIRecord = {
  pmid?: string;
  pmcid?: string;
  doi?: string;
  versions?: NCBIRecord[];
};

export type NCBIProviderResult = {
  status: NCBIProviderStatus;
  records: NCBIRecord[];
  retryAfterMs: number;
};

export const NCBI_ID_CONVERTER =
  "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/";
export const NCBI_TOOL = "NotandiaZotero";
export const NCBI_EMAIL = "mario.marcolongo.dev@gmail.com";
export const NCBI_MAX_IDS = 50;

const NCBI_TIMEOUT_MS = 15000;
const NCBI_MIN_REQUEST_INTERVAL_MS = 1100;
const NCBI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NCBI_MAX_CACHE_ENTRIES = 200;
const NCBI_DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const NCBI_BLOCKED_COOLDOWN_MS = 30 * 60 * 1000;

const cache = new Map<
  string,
  { storedAt: number; result: NCBIProviderResult }
>();
const inflight = new Map<string, Promise<NCBIProviderResult>>();
let requestTail: Promise<void> = Promise.resolve();
let nextRequestAt = 0;
let blockedUntil = 0;
let blockedStatus: "blocked" | "throttled" | "unavailable" = "unavailable";

export function ncbiLookupEnabled(): boolean {
  try {
    return (
      Zotero.Prefs.get(`${config.prefsPrefix}.ncbiApiEnabled`, true) === true
    );
  } catch (_error) {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, milliseconds)),
  );
}

function normalizeIdentifier(
  value: unknown,
  idType: NCBIIdType,
): string | undefined {
  if (idType === "pmid") return normalizePMID(value);
  if (idType === "pmcid") return normalizePMCID(value);
  return normalizeDOI(value);
}

function requestKey(ids: string[], idType: NCBIIdType): string {
  return `${idType}:${[...ids].sort().join(",")}`;
}

function readCache(key: string): NCBIProviderResult | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > NCBI_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
}

function writeCache(key: string, result: NCBIProviderResult): void {
  cache.set(key, { storedAt: Date.now(), result });
  while (cache.size > NCBI_MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function cooldownResult(): NCBIProviderResult {
  return {
    status: blockedStatus,
    records: [],
    retryAfterMs: Math.max(0, blockedUntil - Date.now()),
  };
}

function headerValue(response: any, name: string): string {
  try {
    return String(response?.getResponseHeader?.(name) || "").trim();
  } catch (_error) {
    return "";
  }
}

function retryAfterMilliseconds(response: any): number {
  const raw = headerValue(response, "Retry-After");
  if (!raw) return NCBI_DEFAULT_COOLDOWN_MS;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(
      Math.max(seconds * 1000, 60 * 1000),
      NCBI_BLOCKED_COOLDOWN_MS,
    );
  }
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.min(
      Math.max(date - Date.now(), 60 * 1000),
      NCBI_BLOCKED_COOLDOWN_MS,
    );
  }
  return NCBI_DEFAULT_COOLDOWN_MS;
}

function sanitizeCandidate(candidate: any): NCBIRecord | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const output: NCBIRecord = {};
  const pmid = normalizePMID(candidate.pmid);
  const pmcid = normalizePMCID(candidate.pmcid);
  const doi = normalizeDOI(candidate.doi);
  if (pmid) output.pmid = pmid;
  if (pmcid) output.pmcid = pmcid;
  if (doi) output.doi = doi;
  const versions = Array.isArray(candidate.versions)
    ? candidate.versions
        .slice(0, 20)
        .map(sanitizeCandidate)
        .filter((entry: NCBIRecord | undefined): entry is NCBIRecord =>
          Boolean(entry),
        )
    : [];
  if (versions.length) output.versions = versions;
  return Object.keys(output).length ? output : undefined;
}

async function performRequest(
  ids: string[],
  idType: NCBIIdType,
): Promise<NCBIProviderResult> {
  if (Date.now() < blockedUntil) return cooldownResult();

  const url = new URL(NCBI_ID_CONVERTER);
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("idtype", idType);
  url.searchParams.set("format", "json");
  url.searchParams.set("versions", "no");
  url.searchParams.set("tool", NCBI_TOOL);
  url.searchParams.set("email", NCBI_EMAIL);

  try {
    const response = await (Zotero.HTTP as any).request("GET", url.toString(), {
      anon: true,
      errorDelayMax: 0,
      responseType: "json",
      successCodes: [200, 403, 429],
      timeout: NCBI_TIMEOUT_MS,
    });
    const status = Number(response?.status || 200);

    if (status === 403 || status === 429) {
      const cooldown =
        status === 429
          ? retryAfterMilliseconds(response)
          : NCBI_BLOCKED_COOLDOWN_MS;
      blockedUntil = Date.now() + cooldown;
      blockedStatus = status === 429 ? "throttled" : "blocked";
      return cooldownResult();
    }

    if (status !== 200) {
      blockedUntil = Date.now() + 60 * 1000;
      blockedStatus = "unavailable";
      return cooldownResult();
    }

    const data =
      response?.response ||
      (response?.responseText
        ? JSON.parse(String(response.responseText))
        : undefined);
    const records = Array.isArray(data?.records)
      ? data.records
          .slice(0, NCBI_MAX_IDS * 2)
          .map(sanitizeCandidate)
          .filter((entry: NCBIRecord | undefined): entry is NCBIRecord =>
            Boolean(entry),
          )
      : [];
    return { status: "ok", records, retryAfterMs: 0 };
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    return { status: "unavailable", records: [], retryAfterMs: 0 };
  }
}

function enqueueRequest(
  ids: string[],
  idType: NCBIIdType,
): Promise<NCBIProviderResult> {
  const queued = requestTail.then(async () => {
    if (Date.now() < blockedUntil) return cooldownResult();
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await delay(wait);
    if (Date.now() < blockedUntil) return cooldownResult();
    nextRequestAt = Date.now() + NCBI_MIN_REQUEST_INTERVAL_MS;
    return performRequest(ids, idType);
  });
  requestTail = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

export async function fetchNCBIRecords(
  values: unknown[],
  idType: NCBIIdType,
): Promise<NCBIProviderResult> {
  if (!ncbiLookupEnabled()) {
    return { status: "disabled", records: [], retryAfterMs: 0 };
  }

  const ids = Array.from(
    new Set(
      values
        .map((value) => normalizeIdentifier(value, idType))
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, NCBI_MAX_IDS);
  if (!ids.length) {
    return { status: "invalid", records: [], retryAfterMs: 0 };
  }

  const key = requestKey(ids, idType);
  const cached = readCache(key);
  if (cached) return cached;
  const active = inflight.get(key);
  if (active) return active;

  const request = enqueueRequest(ids, idType)
    .then((result) => {
      if (result.status === "ok") writeCache(key, result);
      return result;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}
