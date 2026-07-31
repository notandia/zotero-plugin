# Notandia for Zotero

[![Zotero 7–9](https://img.shields.io/badge/Zotero-7%20to%209-CC2936?logo=zotero&logoColor=white)](https://www.zotero.org/)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)

**Notandia** identifies MDPI publications in Zotero libraries and detects verified MDPI references while you read PDFs or saved HTML articles.

The plugin adapts portable detection logic from the canonical [Notandia browser extension](https://github.com/notandia/browser-extension). For PubMed Central papers, it also uses the article's structured JATS XML so references remain detectable when Zotero's extracted PDF bibliography omits DOI and PubMed links.

> **Independent project:** Notandia is not affiliated with, authorized by, or endorsed by MDPI AG, Zotero, NCBI, Europe PMC, or any publisher or data provider.

## Features

- Detects MDPI library items from DOI prefix `10.3390/`, genuine MDPI hosts, publisher metadata, structured Zotero fields, and optional PMID/PMCID resolution.
- Adds and maintains the compatibility tag `mdpi-filter:MDPI`.
- Adds a sortable **MDPI** item-table column.
- Adds library and selected-item scan commands under the Notandia name.
- Adds an **MDPI References** section in Zotero's reader.
- For PMC papers, retrieves public JATS XML from Europe PMC and identifies MDPI references from exact DOI, domain, PMID, or PMCID evidence.
- Normalizes structured reference labels such as `124.` to the exact citation number `124`.
- Creates red Zotero highlights only when a verified structured reference can be mapped to an exact PDF citation marker.
- In grouped citations such as `[123, 124]`, highlights only the verified number `124`.
- Deliberately skips ambiguous bare numbers when their position cannot be proven safely.
- Never classifies a reader reference merely because a journal name, title, or capitalization resembles an MDPI publication.

## Installation and updates

1. Open the repository's **Releases** page.
2. Download the latest `notandia-zotero-….xpi` file.
3. In Zotero, open **Tools → Plugins**.
4. Use the gear menu and choose **Install Plugin From File…**
5. Select the `.xpi` and restart Zotero if requested.

Version `0.2.0` starts the public Notandia add-on identity:

```text
zotero-plugin@notandia.github.io
```

An older local installation using `mdpi-filter@mdpi-filter.github.io` is a different add-on identity and must be removed or replaced manually once. After Notandia `0.2.0` is installed, Zotero can obtain subsequent releases automatically through the update URL embedded in the XPI. You can also use the plugin manager's **Check for Updates** action. Future updates do not require extracting files or repeatedly installing each XPI by hand.

The plugin targets Zotero 7, 8, and 9.

## Reader usage

1. Open a PDF or saved HTML attachment in Zotero.
2. Open the right-hand context pane.
3. Select **MDPI References**.

The panel lists every verified MDPI reference and reports how many citation highlights were created. Highlights are standard Zotero annotations and therefore remain visible after the panel closes.

For PMC imports, the parent Zotero item must retain its PMCID or PMC URL. PubMed Central imports normally place the PMCID in the item's **Extra** field.

If the panel reports that no indexed text is available, return to the library, right-click the attachment, choose **Reindex Item**, and reopen the reader.

## Library usage

### Scan a library

Choose:

**Tools → Notandia: Scan Current Library**

Then use Zotero's tag selector to select `mdpi-filter:MDPI`.

### Check selected items

Select one or more items, right-click, and choose:

**Notandia: Check Selected Items**

### Show the MDPI column

Right-click the item-table header and enable **MDPI**.

## Identity and compatibility

Notandia `0.2.0` uses add-on ID `zotero-plugin@notandia.github.io`. The historical MDPI Filter release was effectively private and is not used as the active update identity.

These internal identifiers remain temporarily so preferences, tags, and runtime behavior can be migrated deliberately rather than cosmetically renamed:

```text
Runtime reference: mdpifilter
Global instance: MDPIFilter
Preference prefix: extensions.zotero.mdpifilter
Library tag: mdpi-filter:MDPI
Build package name: mdpi-filter-zotero
```

See [Identity status during the Notandia rebrand](docs/IDENTITY_COMPATIBILITY.md).

## Precision policy

False positives are treated as worse than missed highlights.

The reader scanner uses these signals:

1. Structured `10.3390/` DOI.
2. Genuine MDPI domain.
3. PMID or PMCID that resolves to an MDPI DOI.

Journal-title text alone is never sufficient for a reader-reference match. Citation highlighting additionally requires an exact structured reference label and an exact PDF search rectangle. Ambiguous unbracketed citation numbers are skipped rather than guessed. Ordered reference-list APIs that do not preserve the article's bibliography labels are not used for highlighting.

## Privacy

Local DOI, domain, publisher, journal, and PDF-text checks stay on the computer.

When identifiers need resolution, the plugin sends only public PMID or PMCID values to NCBI. For a PMC reader document, it sends only the public PMCID to Europe PMC to retrieve the article's public JATS XML. It does not upload the PDF, title, authors, notes, collections, annotations, or other Zotero data.

All network-assisted detection can be disabled in Zotero's Advanced Config Editor by setting:

`extensions.zotero.mdpifilter.ncbiApiEnabled` to `false`.

The preference is checked before identifier resolution, before structured PMC retrieval, and before cached structured results are used.

## Tests and supply-chain controls

CI uses read-only repository permissions, pinned GitHub Action revisions, Node.js 24, deterministic `npm ci` installs, dependency auditing, TypeScript validation, XPI ZIP-integrity checks, CodeQL, and Zotero runtime tests. The downloaded Zotero test runtime is verified against a pinned SHA-256 checksum.

Versioned release tags create non-overwriting XPI assets, SHA-256 checksum files, a Zotero update manifest containing the XPI hash, and a GitHub artifact provenance attestation.

## Development

Use Node.js 22.8 or later. Node.js 24 is used in CI.

```bash
npm ci
npm run lint:check
npm audit --audit-level=high
npm run build
npm test
```

The production `.xpi` is generated in `.scaffold/build`.

## Security

Please report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

GNU Affero General Public License, version 3 or later.
