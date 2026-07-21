import { config } from "../../package.json";

export const FILTER_TAG = "mdpi-filter:MDPI";
export const COLUMN_DATA_KEY = "mdpiFilterStatus";

export type ScanResult = {
  examined: number;
  matched: number;
  added: number;
  removed: number;
  errors: number;
};

let notifierID: string | undefined;
let notifierDrainPromise: Promise<void> | undefined;
const pendingItemIDs = new Set<number>();

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

function containsMDPIDOI(value: string): boolean {
  return /(?:^|[^0-9])10\.3390\//i.test(value);
}

function containsMDPIURL(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) {
    return false;
  }

  try {
    const parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate}`,
    );
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return hostname === "mdpi.com" || hostname.endsWith(".mdpi.com");
  } catch (_error) {
    return false;
  }
}

function containsMDPIPublisher(value: string): boolean {
  return /\bMDPI\b|Multidisciplinary Digital Publishing Institute/i.test(value);
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
    containsMDPIPublisher(publisher) ||
    /(?:^|\n)Publisher:\s*(?:MDPI|Multidisciplinary Digital Publishing Institute)\b/im.test(
      extra,
    )
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

  for (const item of items) {
    if (!item?.isRegularItem?.()) {
      continue;
    }

    result.examined += 1;
    const matches = isMDPIItem(item);
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
    dataProvider: (item: Zotero.Item) => (isMDPIItem(item) ? "MDPI" : ""),
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
    notify: (
      event: string,
      type: string,
      ids: Array<string | number>,
    ) => {
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
