# NCBI provider identification

Notandia's local work-identifier mapper is the primary identity layer. NCBI is an optional biomedical resolver and remains independently user-controlled.

## Public XPI boundary

An XPI can be unpacked and inspected. Never embed an NCBI username, private API key, or other secret credential in the add-on, repository, build variables, update manifest, or release assets.

The PMC Help Desk confirmed on 7 August 2026 that programmatic PMC ID Converter requests should include both `tool` and `email` parameters. Notandia therefore identifies the Zotero client with:

- `tool=NotandiaZotero`
- `email=mario.marcolongo.dev@gmail.com`

The e-mail address is Notandia's public maintainer contact. It identifies the application maintainer, not an end user, and must be treated as public rather than secret.

## Request policy

The PMC Help Desk also requested no more than three requests per second and no concurrent requests. The Zotero provider uses a stricter shared governor for every PMC ID Converter caller:

- use the current documented PMC ID Converter endpoint;
- send only validated DOI, PMID, or PMCID identifiers;
- batch at most 50 identifiers and deduplicate them;
- serialize all requests globally so only one request is in flight at a time;
- start at most approximately one request per second;
- cache successful results in memory;
- deduplicate identical in-flight requests;
- honor `Retry-After` and stop during 403/429 cooldowns;
- expose unavailable or throttled states without treating them as negative publication evidence.

Default CI/runtime tests must not make live PMC ID Converter requests. Provider behavior is tested with deterministic HTTP fixtures so development activity cannot generate repeated unidentified or surprising traffic toward NCBI.

NCBI lookups remain disabled by default in the current Zotero release line until the updated provider has been manually smoke-tested. No NCBI API key is required or packaged for this integration.
