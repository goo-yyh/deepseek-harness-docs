# Japanese and Korean translation rules

Japanese and Korean are configured but unpublished in the first version.

When explicitly enabled:

- Translate only from the reviewed official English source.
- Persist the exact `reviewed_source_sha256` beside each locale page.
- Bootstrap with an explicit full-page scope. Incremental runs translate only
  changed/new page IDs.
- Reuse an old translated block only when its old English block is uniquely
  aligned and its reviewed source hash matches. Any ambiguity falls back to a
  full-page translation.
- Keep frontmatter keys, heading levels/order, code fences, inline code,
  commands, identifiers, URLs, link/image destinations, tables, lists, Mermaid,
  HTML, and Vue syntax structurally identical.
- Translate prose, titles, captions, alt text, table prose, and meaningful link
  labels naturally. Never translate commands, API members, package names,
  configuration keys, file paths, or protocol literals.
- Audit the complete locale tree after scoped translation.
- Publish a locale only after structure, language, search, SEO, route, desktop,
  mobile, light, and dark checks pass. No English fallback pages are allowed.
