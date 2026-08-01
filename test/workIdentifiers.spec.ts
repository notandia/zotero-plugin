// @ts-nocheck -- This file runs inside Zotero's embedded Mocha runtime.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertArray(
  actual: unknown[],
  expected: unknown[],
  message: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function api(): any {
  return (Zotero as any).MDPIFilter.api;
}

describe("Notandia work identifier mapper", function () {
  it("normalizes DOI, PMID, PMCID, and arXiv identifiers", function () {
    assertEqual(
      api().normalizeDOI(
        "https://doi.org/10.1016%2Fj.ijantimicag.2020.105949.",
      ),
      "10.1016/j.ijantimicag.2020.105949",
      "encoded DOI URL was not normalized",
    );
    assertEqual(
      api().normalizePMID("https://pubmed.ncbi.nlm.nih.gov/33408014/"),
      "33408014",
      "PubMed URL was not normalized",
    );
    assertEqual(
      api().normalizePMCID(
        "https://pmc.ncbi.nlm.nih.gov/articles/PMC7779265/",
      ),
      "PMC7779265",
      "PMC URL was not normalized",
    );
    assertEqual(
      api().normalizeArxiv("https://arxiv.org/pdf/2301.10140v2.pdf"),
      "2301.10140",
      "arXiv URL was not normalized",
    );

    const parsed = api().parseArxiv("arXiv:hep-th/9901001v3");
    assertEqual(parsed.id, "hep-th/9901001", "legacy arXiv ID was lost");
    assertEqual(parsed.version, 3, "arXiv version was lost");
  });

  it("extracts exact IDs without treating unrelated numbers as PMIDs", function () {
    const identity = api().extractWorkIdentifiers(
      [
        "DOI: 10.1182/blood-2009-08-240044",
        "PMID: 20061557",
        "https://pmc.ncbi.nlm.nih.gov/articles/PMC7779265/",
        "arXiv:2301.10140v2",
        "Reference 14 was published in 2010",
      ],
      { source: "zotero-test", method: "structured-text" },
    );

    assertArray(
      identity.identifiers.doi,
      ["10.1182/blood-2009-08-240044"],
      "DOI extraction changed",
    );
    assertArray(
      identity.identifiers.pmid,
      ["20061557"],
      "PMID extraction changed",
    );
    assertArray(
      identity.identifiers.pmcid,
      ["PMC7779265"],
      "PMCID extraction changed",
    );
    assertArray(
      identity.identifiers.arxiv,
      ["2301.10140"],
      "arXiv extraction changed",
    );
    assertEqual(
      identity.canonicalKey,
      "doi:10.1182/blood-2009-08-240044",
      "canonical work key changed",
    );
    assert(
      identity.evidence.every(
        (entry: { source: string }) => entry.source === "zotero-test",
      ),
      "identifier provenance was not retained",
    );
  });

  it("requires an explicit type before a bare numeric value becomes a PMID", function () {
    const ambiguous = api().extractWorkIdentifiers("33408014", {
      source: "page-text",
      method: "unstructured-text",
    });
    assertArray(
      ambiguous.identifiers.pmid,
      [],
      "bare number was incorrectly inferred as a PMID",
    );
    assertEqual(
      ambiguous.canonicalKey,
      null,
      "ambiguous number received a canonical key",
    );

    const structured = api().extractWorkIdentifiers(
      { year: 2020, pmid: "33408014" },
      { source: "structured-metadata" },
    );
    assertArray(
      structured.identifiers.pmid,
      ["33408014"],
      "typed PMID metadata was not recognized",
    );
    assertArray(
      structured.identifiers.arxiv,
      [],
      "metadata year was incorrectly inferred as arXiv",
    );
    assertEqual(
      structured.canonicalKey,
      "pmid:33408014",
      "typed PMID canonical key changed",
    );
  });

  it("maps NCBI records through the shared identity model", function () {
    const records = [
      {
        versions: [
          {
            pmid: "32205204",
            pmcid: "PMC7102549",
            doi: "10.1016/j.ijantimicag.2020.105949",
          },
        ],
      },
    ];
    const maps = api().resolutionMapsFromNCBI(records);

    assertEqual(
      maps.pmidToDoi.get("32205204"),
      "10.1016/j.ijantimicag.2020.105949",
      "PMID-to-DOI mapping failed",
    );
    assertEqual(
      maps.pmcidToDoi.get("PMC7102549"),
      "10.1016/j.ijantimicag.2020.105949",
      "PMCID-to-DOI mapping failed",
    );
    assertEqual(
      api().resolvedDOI(api().extractWorkIdentifiers("PMID: 32205204"), maps),
      "10.1016/j.ijantimicag.2020.105949",
      "resolved DOI lookup failed",
    );
  });

  it("merges local and provider identities without losing provenance", function () {
    const local = api().extractWorkIdentifiers("PMID: 14699080", {
      source: "item-metadata",
      method: "extra-field",
      confidence: "exact",
    });
    const provider = api().identitiesFromNCBIRecords([
      {
        pmid: "14699080",
        pmcid: "PMC1193645",
        doi: "10.1084/jem.20020509",
      },
    ])[0];
    const merged = api().mergeWorkIdentities(local, provider);

    assertEqual(
      merged.canonicalKey,
      "doi:10.1084/jem.20020509",
      "resolved DOI did not become the canonical key",
    );
    assert(
      merged.evidence.some(
        (entry: { source: string; confidence: string }) =>
          entry.source === "ncbi-id-converter" &&
          entry.confidence === "resolved",
      ),
      "provider provenance was lost during merge",
    );
  });
});
