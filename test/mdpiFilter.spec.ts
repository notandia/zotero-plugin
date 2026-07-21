// @ts-nocheck

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

    const win = Zotero.getMainWindow();
    assert(win, "Zotero main window is unavailable");
    assert(
      win.document.getElementById("mdpifilter-scan-library"),
      "Tools menu command was not registered",
    );
  });

  it("detects DOI, genuine MDPI hosts, and publisher metadata", function () {
    const { isMDPIItem } = getPlugin().api;

    const doiItem = new Zotero.Item("journalArticle");
    doiItem.setField("DOI", "10.3390/ijerph20031681");
    assert(isMDPIItem(doiItem), "10.3390 DOI was not detected");

    const hostItem = new Zotero.Item("journalArticle");
    hostItem.setField("url", "https://www.mdpi.com/1660-4601/20/3/1681");
    assert(isMDPIItem(hostItem), "mdpi.com URL was not detected");

    const subdomainItem = new Zotero.Item("journalArticle");
    subdomainItem.setField("url", "https://susy.mdpi.com/user/manuscripts");
    assert(isMDPIItem(subdomainItem), "MDPI subdomain was not detected");

    const publisherItem = new Zotero.Item("journalArticle");
    publisherItem.setField("publisher", "MDPI");
    assert(isMDPIItem(publisherItem), "MDPI publisher was not detected");
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
