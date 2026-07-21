# MDPI Filter for Zotero

[![Zotero 7–9](https://img.shields.io/badge/Zotero-7%20to%209-CC2936?logo=zotero&logoColor=white)](https://www.zotero.org/)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)

MDPI Filter identifies MDPI publications in Zotero libraries and detects verified MDPI references while you read PDFs or saved HTML articles.

The plugin adapts the portable logic from [MDPI Filter for Chrome](https://github.com/mdpi-filter/mdpi-filter-chrome). For PubMed Central papers, it also uses the article's structured JATS XML so references remain detectable when Zotero's extracted PDF bibliography omits DOI and PubMed links.

## Features

- Detects MDPI library items from:
  - DOI prefix `10.3390/`
  - genuine `mdpi.com` and `mdpi.org` hosts
  - publisher metadata
  - structured Zotero journal fields
  - PMID and PMCID metadata resolved through the NCBI ID Converter
- Adds and maintains the tag `mdpi-filter:MDPI`.
- Adds a sortable **MDPI** item-table column.
- Adds library and selected-item scan commands.
- Adds an **MDPI References** section in Zotero's reader.
- For PMC papers, retrieves structured references through NCBI EFetch and identifies MDPI references from exact DOI, domain, PMID, or PMCID evidence.
- Creates red Zotero highlights for citation markers only when they can be mapped exactly to a verified structured PMC reference.
- In grouped citations such as `[123, 124]`, highlights only the verified number `124`.
- Deliberately skips ambiguous bare numbers when their position cannot be proven safely.
- Never classifies a reference merely because a journal name, title, or capitalization resembles an MDPI publication.

## Installation

1. Open the repository's **Releases** page.
2. Download the latest `.xpi`.
3. In Zotero, open **Tools → Plugins**.
4. Use the gear menu and choose **Install Plugin From File…**
5. Select the `.xpi` and restart Zotero if requested.

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

**Tools → MDPI Filter: Scan Current Library**

Then use Zotero's tag selector to select `mdpi-filter:MDPI`.

### Check selected items

Select one or more items, right-click, and choose:

**MDPI Filter: Check Selected Items**

### Show the MDPI column

Right-click the item-table header and enable **MDPI**.

## Precision policy

False positives are treated as worse than missed highlights.

The reader scanner uses these signals:

1. Structured `10.3390/` DOI.
2. Genuine MDPI domain.
3. PMID or PMCID that resolves to an MDPI DOI.

Journal-title text alone is never sufficient for a reader-reference match. Citation highlighting additionally requires an exact structured reference label and an exact PDF search rectangle. Ambiguous unbracketed citation numbers are skipped rather than guessed.

## Privacy

Local DOI, domain, publisher, journal, and PDF-text checks stay on the computer.

When identifiers need resolution, the plugin sends only public PMID or PMCID values to NCBI. For a PMC reader document, the plugin sends its public PMCID to NCBI EFetch to retrieve the article's public JATS XML. It does not upload the PDF, title, authors, notes, collections, annotations, or other Zotero data.

NCBI identifier lookups can be disabled in Zotero's Advanced Config Editor by setting:

`extensions.zotero.mdpifilter.ncbiApiEnabled` to `false`.

Disabling that preference also prevents structured PMC retrieval.

## Tests

CI builds the `.xpi`, runs formatting and TypeScript checks, and launches the plugin in Zotero 9. Runtime tests cover:

- startup and menus
- item detection and spoofed-domain rejection
- bibliography-only local scanning
- exact JATS parsing without journal-title inference
- live ID Converter resolution
- live `PMC5469049` recognition of reference 124 as `10.3390/nu4091171`
- grouped-citation geometry and unrelated-number rejection
- tag synchronization, notifier behavior, and library scanning

## Development

```bash
npm install
npm run build
npm test
```

The production `.xpi` is generated in `.scaffold/build`.

## License

GNU Affero General Public License, version 3 or later.
