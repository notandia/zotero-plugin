import {
  FILTER_TAG,
  registerMDPIColumn,
  registerMDPINotifier,
  scanLibrary,
  syncItems,
  unregisterMDPINotifier,
} from "./modules/mdpiFilter";
import { createZToolkit } from "./utils/ztoolkit";

function logError(error: unknown): void {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
}

function getZoteroPane(win: _ZoteroTypes.MainWindow): any {
  return (win as any).ZoteroPane || ztoolkit.getGlobal("ZoteroPane");
}

function getSelectedLibraryID(win: _ZoteroTypes.MainWindow): number {
  const pane = getZoteroPane(win);
  const selectedLibraryID = Number(pane?.getSelectedLibraryID?.());
  return Number.isInteger(selectedLibraryID) && selectedLibraryID > 0
    ? selectedLibraryID
    : Zotero.Libraries.userLibraryID;
}

function resultMessage(
  result: Awaited<ReturnType<typeof scanLibrary>>,
): string {
  const changes = [
    `${result.matched} MDPI item${result.matched === 1 ? "" : "s"}`,
    `${result.added} tag${result.added === 1 ? "" : "s"} added`,
    `${result.removed} stale tag${result.removed === 1 ? "" : "s"} removed`,
  ];

  if (result.errors) {
    changes.push(`${result.errors} error${result.errors === 1 ? "" : "s"}`);
  }

  return `${changes.join(", ")}. Filter with the “${FILTER_TAG}” tag.`;
}

async function scanCurrentLibrary(win: _ZoteroTypes.MainWindow): Promise<void> {
  const progress = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: "Scanning the current Zotero library…",
      type: "default",
      progress: 0,
    })
    .show();

  try {
    const result = await scanLibrary(getSelectedLibraryID(win));
    progress.changeLine({
      text: resultMessage(result),
      progress: 100,
    });
  } catch (error) {
    logError(error);
    progress.changeLine({
      text: "The MDPI scan failed. Check Zotero’s debug output for details.",
      progress: 100,
    });
  }

  progress.startCloseTimer(7000);
}

async function scanSelectedItems(win: _ZoteroTypes.MainWindow): Promise<void> {
  const pane = getZoteroPane(win);
  const items = (pane?.getSelectedItems?.() || []) as Zotero.Item[];

  if (!items.length) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: "Select one or more Zotero items first.",
        type: "default",
        progress: 100,
      })
      .show();
    return;
  }

  const progress = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: "Checking selected items…",
      type: "default",
      progress: 0,
    })
    .show();

  try {
    const result = await syncItems(items);
    progress.changeLine({
      text: resultMessage(result),
      progress: 100,
    });
  } catch (error) {
    logError(error);
    progress.changeLine({
      text: "The selected-item check failed. Check Zotero’s debug output.",
      progress: 100,
    });
  }

  progress.startCloseTimer(7000);
}

function registerMenus(win: _ZoteroTypes.MainWindow): void {
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: `${addon.data.config.addonRef}-scan-library`,
    label: "MDPI Filter: Scan Current Library",
    commandListener: () => void scanCurrentLibrary(win),
  });

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: `${addon.data.config.addonRef}-scan-selected`,
    label: "MDPI Filter: Check Selected Items",
    commandListener: () => void scanSelectedItems(win),
  });
}

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  registerMDPINotifier();

  try {
    await registerMDPIColumn();
  } catch (error) {
    logError(error);
  }

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  registerMenus(win);
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  unregisterMDPINotifier();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-ignore - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
