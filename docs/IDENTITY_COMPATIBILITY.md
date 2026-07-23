# Identity compatibility during the Notandia rebrand

Notandia for Zotero was previously distributed as **MDPI Filter for Zotero**. The public name and repository have changed, but released identifiers and persistent namespaces remain stable so existing installations continue to update and existing library state remains usable.

## Public identity

Use **Notandia** in:

- the Zotero plugin manager;
- menu commands and progress-window titles;
- repository descriptions and documentation;
- release titles and XPI filenames;
- support, security, and update links.

Use **MDPI** only when describing the specific MDPI-detection feature, MDPI references, MDPI domains, or MDPI publication identifiers.

## Released identifiers retained

```text
Add-on ID: mdpi-filter@mdpi-filter.github.io
Runtime reference: mdpifilter
Global instance: MDPIFilter
Preference prefix: extensions.zotero.mdpifilter
Library tag: mdpi-filter:MDPI
Build package name: mdpi-filter-zotero
```

These are compatibility identifiers, not the current product name.

Changing them without a migration could create a second add-on identity, interrupt updates, reset user preferences, duplicate tags, or leave existing library state unmanaged. A future change requires an explicit migration design, tests against an upgraded released installation, rollback instructions, and verification of the generated update manifest.

## Release requirements

- New XPI assets use the `notandia-zotero-` filename prefix.
- Release titles use **Notandia for Zotero**.
- `update.json` continues to use the released add-on ID.
- Update links point to `notandia/zotero-plugin`.
- Existing version numbers and signed tags must never be overwritten.
