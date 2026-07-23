# Security Policy

## Supported versions

Security fixes are provided for the latest released version of Notandia for Zotero, including installations originally distributed as MDPI Filter.

## Reporting a vulnerability

Please do not disclose a suspected vulnerability in a public issue.

Use GitHub's **Report a vulnerability** form in the repository's **Security** tab. Include:

- the affected version or commit;
- clear reproduction steps;
- the security impact;
- any proof-of-concept files or logs that are safe to share;
- whether the issue involves Zotero data, network requests, release artifacts, or GitHub Actions.

If private vulnerability reporting is temporarily unavailable, contact the repository maintainers through the Notandia organization profile without including exploit details in the initial message.

We will acknowledge a complete report as soon as practical, investigate it privately, and coordinate disclosure after a fix is available. Please avoid accessing data that is not yours, disrupting third-party services, or publishing exploit details before remediation.

## Security and compatibility boundaries

The plugin processes local Zotero metadata, indexed attachment text, and public scholarly identifiers. Network-assisted detection is optional and must honor the legacy compatibility preference `extensions.zotero.mdpifilter.ncbiApiEnabled`. The plugin must not upload PDFs, notes, annotations, collections, titles, authors, or other private Zotero library content.

The released add-on ID, runtime reference, preference prefix, and library tag are retained so existing installations, settings, and libraries remain compatible. They must not be renamed without a tested migration and update-path review.

Release artifacts are built by GitHub Actions from version tags. Published XPI files include SHA-256 checksums and provenance attestations.
