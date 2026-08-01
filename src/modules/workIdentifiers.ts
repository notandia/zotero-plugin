export type WorkIdentifierType = "doi" | "pmid" | "pmcid" | "arxiv";
export type IdentifierConfidence = "exact" | "resolved" | "probable";

export type IdentifierEvidence = {
  type: WorkIdentifierType;
  value: string;
  source: string;
  method: string;
  confidence: IdentifierConfidence;
  version?: number;
};

export type WorkIdentity = {
  identifiers: Record<WorkIdentifierType, string[]>;
  evidence: IdentifierEvidence[];
  canonicalKey: string | null;
};

export type IdentifierExtractionOptions = {
  source?: string;
  method?: string;
  confidence?: IdentifierConfidence;
};

export type NCBIResolutionMaps = {
  pmidToDoi: Map<string, string>;
  pmcidToDoi: Map<string, string>;
};

const IDENTIFIER_TYPES: WorkIdentifierType[] = [
  "doi",
  "pmid",
  "pmcid",
  "arxiv",
];
const DOI_EXACT = /^10\.\d{4,9}\/[\w.()/:;+-]+$/i;
const DOI_SEARCH = /\b10\.\d{4,9}\/[A-Z0-9._;()/:+-]+/gi;
const PMID_EXACT = /^\d{1,12}$/;
const PMCID_EXACT = /^PMC\d{1,12}$/i;
const ARXIV_NEW = /^(\d{4}\.\d{4,5})(?:v(\d+))?$/i;
const ARXIV_OLD = /^([a-z][a-z0-9.-]+\/\d{7})(?:v(\d+))?$/i;

function isIdentifierType(value: string): value is WorkIdentifierType {
  return IDENTIFIER_TYPES.includes(value as WorkIdentifierType);
}

function safeDecode(value: unknown): string {
  const text = String(value ?? "").trim();
  try {
    return decodeURIComponent(text);
  } catch (_error) {
    return text;
  }
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[\s\u00a0),.;:\]}>'"`]+$/g, "");
}

export function normalizeDOI(value: unknown): string | undefined {
  let normalized = safeDecode(value)
    .replace(/^doi\s*:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[\s\u00a0]+/g, "");
  normalized = stripTrailingPunctuation(normalized).toLowerCase();
  return DOI_EXACT.test(normalized) ? normalized : undefined;
}

export function normalizePMID(value: unknown): string | undefined {
  let normalized = safeDecode(value)
    .replace(/^pmid\s*:\s*/i, "")
    .trim();

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "pubmed.ncbi.nlm.nih.gov") {
      normalized = url.pathname.match(/^\/(\d{1,12})\/?/)?.[1] || "";
    } else if (
      hostname === "ncbi.nlm.nih.gov" ||
      hostname.endsWith(".ncbi.nlm.nih.gov")
    ) {
      normalized =
        url.searchParams.get("list_uids") ||
        url.pathname.match(/\/pubmed\/(\d{1,12})(?:\D|$)/i)?.[1] ||
        "";
    }
  } catch (_error) {
    const explicit = normalized.match(
      /(?:^|\b)PMID\s*:?\s*(\d{1,12})(?:\b|$)/i,
    )?.[1];
    if (explicit) normalized = explicit;
  }

  return PMID_EXACT.test(normalized) ? normalized : undefined;
}

export function normalizePMCID(value: unknown): string | undefined {
  let normalized = safeDecode(value)
    .replace(/^pmcid\s*:\s*/i, "")
    .trim();

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      hostname === "pmc.ncbi.nlm.nih.gov" ||
      hostname === "ncbi.nlm.nih.gov" ||
      hostname.endsWith(".ncbi.nlm.nih.gov")
    ) {
      normalized =
        url.pathname.match(/\/(?:articles\/)?(PMC\d{1,12})(?:\D|$)/i)?.[1] ||
        "";
    }
  } catch (_error) {
    const explicit = normalized.match(/(?:^|\b)(PMC\d{1,12})(?:\b|$)/i)?.[1];
    if (explicit) normalized = explicit;
  }

  normalized = normalized.toUpperCase();
  return PMCID_EXACT.test(normalized) ? normalized : undefined;
}

export function parseArxiv(
  value: unknown,
): { id: string; version?: number } | undefined {
  let normalized = safeDecode(value)
    .replace(/^arxiv\s*:\s*/i, "")
    .trim();

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "arxiv.org" || hostname.endsWith(".arxiv.org")) {
      normalized = url.pathname
        .replace(/^\/(?:abs|pdf|html)\//i, "")
        .replace(/\.pdf$/i, "")
        .replace(/^\/+|\/+$/g, "");
    }
  } catch (_error) {
    // Prefix and bare-ID handling continues below.
  }

  normalized = stripTrailingPunctuation(normalized);
  const match = normalized.match(ARXIV_NEW) || normalized.match(ARXIV_OLD);
  if (!match) return undefined;
  return {
    id: match[1].toLowerCase(),
    version: match[2] ? Number(match[2]) : undefined,
  };
}

export function normalizeArxiv(value: unknown): string | undefined {
  return parseArxiv(value)?.id;
}

function emptyIdentity(): WorkIdentity {
  return {
    identifiers: { doi: [], pmid: [], pmcid: [], arxiv: [] },
    evidence: [],
    canonicalKey: null,
  };
}

function evidenceMetadata(
  options: IdentifierExtractionOptions,
): Required<IdentifierExtractionOptions> {
  return {
    source:
      String(options.source || "local")
        .trim()
        .slice(0, 80) || "local",
    method:
      String(options.method || "exact-value")
        .trim()
        .slice(0, 80) || "exact-value",
    confidence: options.confidence || "exact",
  };
}

export function canonicalWorkKey(identity: WorkIdentity): string | null {
  for (const type of IDENTIFIER_TYPES) {
    const first = [...(identity.identifiers[type] || [])].sort()[0];
    if (first) return `${type}:${first}`;
  }
  return null;
}

function finalize(identity: WorkIdentity): WorkIdentity {
  for (const type of IDENTIFIER_TYPES) {
    identity.identifiers[type] = Array.from(
      new Set(identity.identifiers[type]),
    ).sort();
  }

  const seenEvidence = new Set<string>();
  identity.evidence = identity.evidence.filter((entry) => {
    const key = [
      entry.type,
      entry.value,
      entry.source,
      entry.method,
      entry.confidence,
      entry.version || "",
    ].join("|");
    if (seenEvidence.has(key)) return false;
    seenEvidence.add(key);
    return true;
  });
  identity.canonicalKey = canonicalWorkKey(identity);
  return identity;
}

function addIdentifier(
  identity: WorkIdentity,
  type: WorkIdentifierType,
  value: unknown,
  options: IdentifierExtractionOptions,
): boolean {
  if (value === undefined || value === null || value === "") return false;
  const normalizers: Record<
    WorkIdentifierType,
    (candidate: unknown) => string | undefined
  > = {
    doi: normalizeDOI,
    pmid: normalizePMID,
    pmcid: normalizePMCID,
    arxiv: normalizeArxiv,
  };
  const normalized = normalizers[type](value);
  if (!normalized) return false;

  identity.identifiers[type].push(normalized);
  const metadata = evidenceMetadata(options);
  const evidence: IdentifierEvidence = {
    type,
    value: normalized,
    source: metadata.source,
    method: metadata.method,
    confidence: metadata.confidence,
  };
  const arxiv = type === "arxiv" ? parseArxiv(value) : undefined;
  if (arxiv?.version) evidence.version = arxiv.version;
  identity.evidence.push(evidence);
  return true;
}

function parseURL(
  value: unknown,
  identity: WorkIdentity,
  options: IdentifierExtractionOptions,
): void {
  let url: URL;
  try {
    url = new URL(safeDecode(value));
  } catch (_error) {
    return;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname === "doi.org" || hostname === "dx.doi.org") {
    addIdentifier(identity, "doi", url.href, {
      ...options,
      method: "doi-url",
    });
  }
  if (hostname === "pubmed.ncbi.nlm.nih.gov") {
    addIdentifier(identity, "pmid", url.href, {
      ...options,
      method: "pubmed-url",
    });
  }
  if (
    hostname === "pmc.ncbi.nlm.nih.gov" ||
    hostname.endsWith(".ncbi.nlm.nih.gov")
  ) {
    addIdentifier(identity, "pmcid", url.href, {
      ...options,
      method: "pmc-url",
    });
    addIdentifier(identity, "pmid", url.href, {
      ...options,
      method: "ncbi-url",
    });
  }
  if (hostname === "arxiv.org" || hostname.endsWith(".arxiv.org")) {
    addIdentifier(identity, "arxiv", url.href, {
      ...options,
      method: "arxiv-url",
    });
  }
}

function extractOne(
  value: unknown,
  identity: WorkIdentity,
  options: IdentifierExtractionOptions,
): void {
  const text = String(value ?? "").trim();
  if (!text) return;

  parseURL(text, identity, options);
  addIdentifier(identity, "doi", text, {
    ...options,
    method: options.method || "doi-value",
  });
  addIdentifier(identity, "pmcid", text, {
    ...options,
    method: options.method || "pmcid-value",
  });

  for (const found of text.matchAll(DOI_SEARCH)) {
    addIdentifier(identity, "doi", found[0], {
      ...options,
      method: "doi-text",
    });
  }
  for (const found of text.matchAll(/\bPMID\s*:?\s*(\d{1,12})\b/gi)) {
    addIdentifier(identity, "pmid", found[1], {
      ...options,
      method: "pmid-text",
    });
  }
  for (const found of text.matchAll(/\bPMC\d{1,12}\b/gi)) {
    addIdentifier(identity, "pmcid", found[0], {
      ...options,
      method: "pmcid-text",
    });
  }
  for (const found of text.matchAll(
    /\barXiv\s*:\s*((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]+\/\d{7})(?:v\d+)?)\b/gi,
  )) {
    addIdentifier(identity, "arxiv", found[1], {
      ...options,
      method: "arxiv-text",
    });
  }
}

function extractValues(
  values: unknown,
  identity: WorkIdentity,
  options: IdentifierExtractionOptions,
): void {
  if (values === undefined || values === null) return;
  if (Array.isArray(values)) {
    for (const value of values) extractValues(value, identity, options);
    return;
  }
  if (values instanceof Set) {
    for (const value of values) extractValues(value, identity, options);
    return;
  }
  if (typeof values === "object") {
    for (const [rawKey, value] of Object.entries(
      values as Record<string, unknown>,
    )) {
      const key = rawKey.toLowerCase();
      if (isIdentifierType(key)) {
        const candidates =
          Array.isArray(value) || value instanceof Set
            ? Array.from(value)
            : [value];
        for (const candidate of candidates) {
          addIdentifier(identity, key, candidate, {
            ...options,
            method: options.method || `structured-${key}`,
          });
        }
      } else {
        extractValues(value, identity, options);
      }
    }
    return;
  }
  extractOne(values, identity, options);
}

export function extractWorkIdentifiers(
  values: unknown,
  options: IdentifierExtractionOptions = {},
): WorkIdentity {
  const identity = emptyIdentity();
  extractValues(values, identity, options);
  return finalize(identity);
}

export function mergeWorkIdentities(
  ...identities: Array<WorkIdentity | WorkIdentity[] | undefined>
): WorkIdentity {
  const merged = emptyIdentity();
  for (const identity of identities.flat()) {
    if (!identity) continue;
    for (const type of IDENTIFIER_TYPES) {
      merged.identifiers[type].push(...(identity.identifiers[type] || []));
    }
    merged.evidence.push(...identity.evidence.map((entry) => ({ ...entry })));
  }
  return finalize(merged);
}

export function identitiesFromNCBIRecords(
  records: unknown,
  options: IdentifierExtractionOptions = {},
): WorkIdentity[] {
  const source = options.source || "ncbi-id-converter";
  const identities: WorkIdentity[] = [];
  for (const raw of Array.isArray(records) ? records : []) {
    const record = raw as Record<string, any>;
    const candidates = [
      record,
      ...(Array.isArray(record.versions) ? record.versions : []),
    ];
    const identity = emptyIdentity();
    for (const candidate of candidates) {
      const metadata = {
        source,
        method: "provider-record",
        confidence: "resolved" as const,
      };
      addIdentifier(identity, "doi", candidate?.doi, metadata);
      addIdentifier(identity, "pmid", candidate?.pmid, metadata);
      addIdentifier(identity, "pmcid", candidate?.pmcid, metadata);
    }
    const finalized = finalize(identity);
    if (finalized.canonicalKey) identities.push(finalized);
  }
  return identities;
}

export function resolutionMapsFromNCBI(records: unknown): NCBIResolutionMaps {
  const pmidToDoi = new Map<string, string>();
  const pmcidToDoi = new Map<string, string>();
  for (const identity of identitiesFromNCBIRecords(records)) {
    const doi = identity.identifiers.doi[0];
    if (!doi) continue;
    for (const pmid of identity.identifiers.pmid) pmidToDoi.set(pmid, doi);
    for (const pmcid of identity.identifiers.pmcid) pmcidToDoi.set(pmcid, doi);
  }
  return { pmidToDoi, pmcidToDoi };
}

export function resolvedDOI(
  identityOrValues: WorkIdentity | unknown,
  maps: NCBIResolutionMaps,
): string | undefined {
  const identity =
    typeof identityOrValues === "object" &&
    identityOrValues !== null &&
    "identifiers" in identityOrValues
      ? (identityOrValues as WorkIdentity)
      : extractWorkIdentifiers(identityOrValues);

  for (const pmid of identity.identifiers.pmid || []) {
    const doi = maps.pmidToDoi.get(pmid);
    if (doi) return doi;
  }
  for (const pmcid of identity.identifiers.pmcid || []) {
    const doi = maps.pmcidToDoi.get(pmcid);
    if (doi) return doi;
  }
  return identity.identifiers.doi[0];
}
