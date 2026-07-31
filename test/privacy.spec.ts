// @ts-nocheck -- This file runs inside Zotero's embedded Mocha runtime.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function getPlugin(): any {
  return (Zotero as any).MDPIFilter;
}

function itemWithPMID(pmid: string): Zotero.Item {
  const item = new Zotero.Item("journalArticle");
  item.setField("extra", `PMID: ${pmid}`);
  return item;
}

describe("Notandia NCBI privacy controls", function () {
  it("fails closed when the lookup preference cannot be read", async function () {
    const originalGet = Zotero.Prefs.get;
    const originalRequest = Zotero.HTTP.request;
    let requests = 0;

    try {
      Zotero.Prefs.get = () => {
        throw new Error("preference service unavailable");
      };
      Zotero.HTTP.request = async () => {
        requests += 1;
        throw new Error("network request should have been blocked");
      };

      const matched = await getPlugin().api.detectMDPIItem(
        itemWithPMID("99999997"),
      );
      assert(matched === false, "preference failure enabled remote detection");
      assert(requests === 0, "preference failure allowed an HTTP request");
    } finally {
      Zotero.Prefs.get = originalGet;
      Zotero.HTTP.request = originalRequest;
    }
  });

  it("does not use remote-derived cache while lookups are disabled", async function () {
    const pref = "extensions.zotero.mdpifilter.ncbiApiEnabled";
    const originalRequest = Zotero.HTTP.request;
    let blockedRequests = 0;

    try {
      Zotero.Prefs.set(pref, true, true);
      Zotero.HTTP.request = async () => ({
        response: {
          records: [
            {
              pmid: "99999998",
              doi: "10.3390/notandia-cache-privacy-test",
            },
          ],
        },
      });

      const enabledResult = await getPlugin().api.detectMDPIItem(
        itemWithPMID("99999998"),
      );
      assert(
        enabledResult === true,
        "test did not warm the remote-result cache",
      );

      Zotero.Prefs.set(pref, false, true);
      Zotero.HTTP.request = async () => {
        blockedRequests += 1;
        throw new Error("network request should have been blocked");
      };

      const disabledResult = await getPlugin().api.detectMDPIItem(
        itemWithPMID("99999998"),
      );
      assert(
        disabledResult === false,
        "disabled lookups reused remote-derived cached data",
      );
      assert(blockedRequests === 0, "disabled lookups allowed an HTTP request");
    } finally {
      Zotero.HTTP.request = originalRequest;
      Zotero.Prefs.set(pref, true, true);
    }
  });
});
