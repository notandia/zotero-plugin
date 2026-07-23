# Identity status during the Notandia rebrand

A GitHub release of the Zotero plugin existed under **MDPI Filter for Zotero**, but the maintainer was its only downloader. It is therefore being treated as an effectively private pre-public release rather than as a compatibility commitment to external users.

## Public identity

Use **Notandia** in:

- the Zotero plugin manager;
- menu commands and progress-window titles;
- repository descriptions and documentation;
- release titles and XPI filenames;
- support, security, and update links.

Use **MDPI** only when describing the specific MDPI-detection feature, MDPI references, MDPI domains, or MDPI publication identifiers.

## Add-on identity

The next release uses:

```text
zotero-plugin@notandia.github.io
```

The earlier ID `mdpi-filter@mdpi-filter.github.io` is not retained as the active update identity. The maintainer's old local installation will not automatically become the new add-on identity and should be removed or replaced when testing the new XPI.

Do not overwrite the historical release or reuse an existing version tag. Increment `package.json` before creating the next tag.

## Internal identifiers still present

```text
Runtime reference: mdpifilter
Global instance: MDPIFilter
Preference prefix: extensions.zotero.mdpifilter
Library tag: mdpi-filter:MDPI
Build package name: mdpi-filter-zotero
```

These are currently internal or data-level identifiers, not the add-on's public installation identity. They remain temporarily to avoid coupling an ID correction to a broad runtime and library-data migration. A separate tested migration may replace them with neutral names while recognizing old preferences and tags.

## Release requirements

- New XPI assets use the `notandia-zotero-` filename prefix.
- Release titles use **Notandia for Zotero**.
- `update.json` uses `zotero-plugin@notandia.github.io`.
- Update links point to `notandia/zotero-plugin`.
- Existing releases and tags are never overwritten.
- The package version must be incremented before the next release tag.
