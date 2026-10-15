# Zenodo release archiving

Use Zenodo's native GitHub integration for `notandia/zotero-plugin`. It archives published GitHub releases; normal commits and pull-request merges do not create a DOI. No additional GitHub Actions workflow or Zenodo API secret is needed.

## One-time setup

1. In Zenodo's GitHub settings, sync repositories and enable only `notandia/zotero-plugin`.
2. Retain the project's own DOI series. Do not create a parallel manual archive for the same releases.
3. Existing releases are not automatically backfilled when the switch is enabled. Do not delete or recreate old releases or tags to force ingestion.

## Release checklist

1. Complete the repository's normal validation and review. Check the citation title, creator, ORCID and licence references against the released source.
2. Publish an intentional versioned GitHub release containing `CITATION.cff`. Do not make a release merely to claim a DOI.
3. Confirm that Zenodo reports successful processing. Inspect the public record, archived files, version, author metadata and licence before using the DOI.
4. Use the all-version DOI for the evolving project and the version DOI when identifying exact software used. Add badges only after the record exists.
5. Preserve third-party notices in the archive. Citation authorship does not replace source attribution or confer peer-review status.

## Zotero identity transition

The current main branch prepares version `0.2.0` with add-on ID `zotero-plugin@notandia.github.io`; the historical published `v0.1.2` predates that transition. Follow [identity compatibility requirements](IDENTITY_COMPATIBILITY.md) and the existing tag-triggered release workflow. Do not overwrite historical assets or change the browser extension's release/DOI series.

## Documentation

- [Enable a repository](https://help.zenodo.org/docs/github/enable-repository/)
- [Archive a software release](https://help.zenodo.org/docs/github/archive-software/github-upload/)
- [Describe software with CITATION.cff](https://help.zenodo.org/docs/github/describe-software/citation-file/)
