# NCBI provider registration

Notandia's local work-identifier mapper is the primary identity layer. NCBI is an optional biomedical resolver and is disabled by default.

## Public XPI boundary

An XPI can be unpacked and inspected. Never embed a personal e-mail address, NCBI username, or NCBI API key in the add-on, repository, build variables, update manifest, or release assets.

The current code contains no personal NCBI credential. Before the provider is enabled by default in a public release, create a public project contact address, register the Notandia tool labels and that address with NCBI, and confirm whether any previous IP or account restriction must be cleared.

## Required follow-up hardening

The Zotero NCBI clients should be consolidated behind one provider governor that:

- uses the current documented PMC ID Converter endpoint;
- uses a Notandia-specific public tool label;
- batches and deduplicates identifiers;
- starts no more than one request per second;
- caches successful results;
- honors `Retry-After`;
- stops during 403/429 cooldowns;
- exposes unavailable or throttled states without treating them as negative publication evidence.

Until that work and NCBI registration are complete, users may explicitly enable NCBI lookups for testing, but releases must not silently activate them.
