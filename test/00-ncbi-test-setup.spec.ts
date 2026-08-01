// @ts-nocheck -- This file runs inside Zotero's embedded Mocha runtime.

const NCBI_PREF = "extensions.zotero.mdpifilter.ncbiApiEnabled";

before(function () {
  Zotero.Prefs.set(NCBI_PREF, true, true);
});

after(function () {
  Zotero.Prefs.set(NCBI_PREF, false, true);
});
