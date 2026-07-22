// @ts-nocheck -- This file runs inside Zotero's embedded Mocha runtime.

const createdItemIDs: number[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function getPlugin(): any {
  return (Zotero as any).MDPIFilter;
}

function hasFilterTag(item: Zotero.Item): boolean {
  const tag = getPlugin().api.FILTER_TAG;
  return item.getTags().some((entry: { tag: string }) => entry.tag === tag);
}

async function createItem(
  fields: Record<string, string> = {},
): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.setField("title", `MDPI Filter test ${Zotero.Utilities.randomString()}`);
  for (const [field, value] of Object.entries(fields)) {
    item.setField(field, value);
  }
  await item.saveTx();
  createdItemIDs.push(item.id);
  return item;
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeout = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) {
      return;
    }
    await Zotero.Promise.delay(50);
  }
  throw new Error(message);
}

afterEach(async function () {
  for (const id of createdItemIDs.splice(0)) {
    const item = await Zotero.Items.getAsync(id);
    if (item) {
      await item.eraseTx();
    }
  }
});

describe("MDPI Filter Zotero runtime", function () {
  it("starts and registers its Tools menu command", function () {
    const plugin = getPlugin();
    assert(plugin, "plugin instance was not created");
    assert(plugin.data.initialized, "plugin did not finish startup");
    assert(plugin.api.isMDPIItem, "plugin API was not exposed");
    assert(plugin.api.detectMDPIItem, "async detection API was not exposed");
    assert(
      plugin.api.findMDPIReferences,
      "reader reference scanner API was not exposed",
    );
    assert(
      plugin.api.parsePMCReferenceXML,
      "structured PMC parser API was not exposed",
    );
    assert(
      plugin.api.highlightMDPICitations,
      "citation highlighter API was not exposed",
    );

    const win = Zotero.getMainWindow();
    assert(win, "Zotero main window is unavailable");
    assert(
      win.document.getElementById("mdpifilter-scan-library"),
      "Tools menu command was not registered",
    );
  });

  it("adapts Chrome DOI, domain, journal, publisher, and NCBI checks", async function () {
    const { detectMDPIItem, isMDPIItem } = getPlugin().api;

    const doiItem = new Zotero.Item("journalArticle");
    doiItem.setField("DOI", "10.3390/ijerph20031681");
    assert(isMDPIItem(doiItem), "10.3390 DOI was not detected");

    const hostItem = new Zotero.Item("journalArticle");
    hostItem.setField("url", "https://www.mdpi.com/1660-4601/20/3/1681");
    assert(isMDPIItem(hostItem), "mdpi.com URL was not detected");

    const orgItem = new Zotero.Item("journalArticle");
    orgItem.setField("url", "https://www.mdpi.org/about");
    assert(isMDPIItem(orgItem), "mdpi.org URL was not detected");

    const subdomainItem = new Zotero.Item("journalArticle");
    subdomainItem.setField("url", "https://susy.mdpi.com/user/manuscripts");
    assert(isMDPIItem(subdomainItem), "MDPI subdomain was not detected");

    const publisherItem = new Zotero.Item("journalArticle");
    publisherItem.setField("publisher", "MDPI");
    assert(isMDPIItem(publisherItem), "MDPI publisher was not detected");

    const journalItem = new Zotero.Item("journalArticle");
    journalItem.setField(
      "publicationTitle",
      "International Journal of Molecular Sciences",
    );
    assert(isMDPIItem(journalItem), "known MDPI journal was not detected");

    const originalRequest = Zotero.HTTP.request;
    try {
      Zotero.HTTP.request = async () => ({
        response: {
          records: [
            {
              pmid: "99999991",
              pmcid: "PMC99999991",
              doi: "10.3390/mock-ncbi-result",
            },
          ],
        },
      });
      const ncbiItem = new Zotero.Item("journalArticle");
      ncbiItem.setField("extra", "PMID: 99999991");
      assert(
        await detectMDPIItem(ncbiItem),
        "NCBI PMID-to-MDPI resolution failed",
      );
    } finally {
      Zotero.HTTP.request = originalRequest;
    }
  });

  it("scans the bibliography instead of the paper's own metadata", async function () {
    const { findMDPIReferences } = getPlugin().api;
    const text = `
      Article title
      DOI: 10.3390/own-paper-doi
      Body text
      References
      1. Example non-MDPI paper. doi:10.1038/example
      2. Example MDPI paper. https://doi.org/10.3390/ijerph20010042.
      3. Another MDPI source. https://www.mdpi.com/2076-3417/13/1/1
    `;
    const matches = await findMDPIReferences(text);
    assert(
      !matches.some((entry: any) => entry.doi === "10.3390/own-paper-doi"),
      "the paper's own DOI was incorrectly treated as a reference",
    );
    assert(
      matches.some((entry: any) => entry.doi === "10.3390/ijerph20010042"),
      "MDPI DOI in bibliography was not detected",
    );
    assert(
      matches.some((entry: any) => entry.source === "domain"),
      "MDPI domain in bibliography was not detected",
    );
  });

  it("parses exact JATS references and never infers MDPI from journal capitalization", async function () {
    const xml = `<?xml version="1.0"?>
      <article xmlns:xlink="http://www.w3.org/1999/xlink">
        <body>
          <p>Prior work <sup>[<xref ref-type="bibr" rid="R124">124</xref>]</sup>
          and grouped work [<xref ref-type="bibr" rid="R123">123</xref>,
          <xref ref-type="bibr" rid="R124">124</xref>].</p>
        </body>
        <back>
          <ref-list>
            <ref id="R123">
              <label>123</label>
              <element-citation>
                <article-title>A non-MDPI Nutrients-looking title</article-title>
                <source>NUTRIENTS</source>
              </element-citation>
            </ref>
            <ref id="R124">
              <label>124.</label>
              <element-citation>
                <article-title>Effects of glycerol and creatine hyperhydration</article-title>
                <source>Nutrients</source>
                <pub-id pub-id-type="doi">10.3390/nu4091171</pub-id>
              </element-citation>
            </ref>
          </ref-list>
        </back>
      </article>`;
    const matches = await getPlugin().api.parsePMCReferenceXML(xml);
    assert(
      matches.length === 1,
      "journal capitalization caused a false positive",
    );
    assert(matches[0].referenceLabel === "124", "reference label was lost");
    assert(matches[0].doi === "10.3390/nu4091171", "structured DOI was lost");
    assert(
      matches[0].citationMarkers.some(
        (marker: any) => marker.safe && marker.text === "[124]",
      ),
      "exact single citation marker was not extracted",
    );
    assert(
      matches[0].citationMarkers.some(
        (marker: any) => marker.safe && marker.text === "[123, 124]",
      ),
      "exact grouped citation marker was not extracted",
    );
  });

  it("honors the network lookup opt-out for reader scans", async function () {
    const pref = "extensions.zotero.mdpifilter.ncbiApiEnabled";
    const originalRequest = Zotero.HTTP.request;
    let requestCount = 0;
    try {
      Zotero.Prefs.set(pref, false);
      Zotero.HTTP.request = async () => {
        requestCount += 1;
        throw new Error("network request should have been blocked");
      };
      const local = await getPlugin().api.findMDPIReferences(
        "References\n1. Example. PMCID: PMC11172733",
      );
      assert(local.length === 0, "disabled lookup returned a remote match");
      const structured =
        await getPlugin().api.fetchPMCReferenceMatches("PMC5469049");
      assert(
        structured === undefined,
        "disabled structured lookup returned remote data",
      );
      assert(
        requestCount === 0,
        "network opt-out still allowed an HTTP request",
      );
    } finally {
      Zotero.HTTP.request = originalRequest;
      Zotero.Prefs.set(pref, true);
    }
  });

  it("resolves a real PMC reference through the current NCBI endpoint", async function () {
    this.timeout(30000);
    const matches = await getPlugin().api.findMDPIReferences(
      "References\n1. Rapid determination study. PMCID: PMC11172733",
    );
    assert(
      matches.some((entry: any) => entry.pmcid === "PMC11172733"),
      "live PMCID-to-MDPI resolution failed",
    );
  });

  it("finds reference 124 in the real PMC5469049 JATS document", async function () {
    this.timeout(60000);
    const matches =
      await getPlugin().api.fetchPMCReferenceMatches("PMC5469049");
    assert(matches, "PMC EFetch returned no structured references");
    const reference = matches.find(
      (entry: any) =>
        entry.referenceLabel === "124" && entry.doi === "10.3390/nu4091171",
    );
    assert(
      reference,
      "structured PMC reference 124 was not recognized as MDPI",
    );
  });

  it("highlights only geometrically verified citation markers", async function () {
    const positions: Record<string, any[]> = {
      "[124]": [{ pageIndex: 0, rects: [[10, 10, 35, 20]] }],
      "[123, 124]": [{ pageIndex: 0, rects: [[50, 10, 110, 20]] }],
      "124": [
        { pageIndex: 0, rects: [[90, 10, 110, 20]] },
        { pageIndex: 0, rects: [[200, 200, 220, 210]] },
      ],
    };
    let currentQuery = "";
    const created: any[] = [];
    const controller = {
      _pdfDocument: { numPages: 1 },
      _visitedPagesCount: 1,
      _pendingFindMatches: new Set(),
      _findTimeout: null,
      pageMatches: [[]],
      find(state: any) {
        currentQuery = state.query;
        this._visitedPagesCount = 1;
        this.pageMatches = [new Array((positions[currentQuery] || []).length)];
      },
      async getMatchPositionsAsync() {
        return positions[currentQuery] || [];
      },
    };
    const reader = {
      _initPromise: Promise.resolve(),
      _iframeWindow: {},
      _internalReader: {
        _primaryView: { _findController: controller },
        _annotationManager: {
          addAnnotation(annotation: any) {
            created.push(annotation);
            return annotation;
          },
        },
      },
    };
    const attachment = {
      id: 999,
      attachmentReaderType: "pdf",
      isAttachment: () => true,
      getAnnotations: () => [],
    };
    const result = await getPlugin().api.highlightMDPICitations(
      attachment,
      [
        {
          key: "pmc-ref:R124",
          referenceId: "R124",
          referenceLabel: "124",
          doi: "10.3390/nu4091171",
          snippet: "Reference 124",
          source: "pmc-jats",
          citationMarkers: [
            { text: "[124]", safe: true },
            { text: "[123, 124]", safe: true },
            { text: "124", safe: false },
          ],
        },
      ],
      reader,
    );
    assert(
      result.created === 2,
      "verified citation highlights were not created",
    );
    assert(result.skippedUnsafe === 1, "ambiguous bare marker was not skipped");
    assert(
      created.length === 2,
      "an unrelated occurrence of 124 was highlighted",
    );
    assert(
      created.every((annotation) => annotation.color === "#e2211c"),
      "citation highlights did not use MDPI red",
    );
  });

  it("rejects lookalike and embedded MDPI hostnames", function () {
    const { isMDPIItem } = getPlugin().api;

    const suffixSpoof = new Zotero.Item("journalArticle");
    suffixSpoof.setField("url", "https://mdpi.com.evil.example/article");
    assert(!isMDPIItem(suffixSpoof), "suffix-spoofed hostname was accepted");

    const pathSpoof = new Zotero.Item("journalArticle");
    pathSpoof.setField("url", "https://example.org/mdpi.com/article");
    assert(!isMDPIItem(pathSpoof), "MDPI text in a URL path was accepted");

    const unrelated = new Zotero.Item("journalArticle");
    unrelated.setField("DOI", "10.1038/s41586-024-00000-0");
    assert(!isMDPIItem(unrelated), "unrelated DOI was classified as MDPI");
  });

  it("adds and removes the filter tag through an explicit sync", async function () {
    const { syncItems } = getPlugin().api;
    const item = await createItem();

    item.setField("DOI", "10.3390/test-doi");
    const added = await syncItems([item]);
    assert(added.examined === 1, "sync did not examine the item");
    assert(added.matched === 1, "sync did not classify the MDPI item");
    assert(added.added === 1, "sync did not add the filter tag");
    assert(hasFilterTag(item), "filter tag is absent after sync");

    item.setField("DOI", "");
    const removed = await syncItems([item]);
    assert(removed.removed === 1, "sync did not remove the stale tag");
    assert(!hasFilterTag(item), "stale filter tag remains after sync");
  });

  it("automatically tracks added and modified Zotero items", async function () {
    const item = await createItem({ DOI: "10.3390/notifier-test" });

    await waitFor(
      () => hasFilterTag(item),
      "notifier did not add the MDPI filter tag",
    );

    item.setField("DOI", "10.1038/not-mdpi");
    await item.saveTx();
    await waitFor(
      () => !hasFilterTag(item),
      "notifier did not remove the stale MDPI filter tag",
    );
  });

  it("scans the active Zotero library without errors", async function () {
    await createItem({ DOI: "10.3390/library-scan-test" });
    const result = await getPlugin().api.scanLibrary(
      Zotero.Libraries.userLibraryID,
    );

    assert(result.examined >= 1, "library scan examined no regular items");
    assert(result.matched >= 1, "library scan found no MDPI items");
    assert(result.errors === 0, "library scan reported an error");
  });
});
