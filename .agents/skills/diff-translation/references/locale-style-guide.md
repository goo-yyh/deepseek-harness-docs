# DeepSeek Harness Japanese and Korean style guide

## Shared source and structure contract

- Translate only the normalized, reviewed official English page bound to the
  current upstream lock. Never translate from Chinese or from the other target
  locale.
- Keep `DeepSeek`, `DeepSeek Harness`, `dsh`, `Cordis`, `Typert`, commands,
  flags, package names, paths, configuration keys, types, events, API members,
  protocol values, and version strings unchanged.
- Preserve frontmatter keys and values, heading levels/order, code fences and
  code bytes, inline code, link/image destinations, list/table structure,
  Mermaid source, controlled HTML, and explicit anchors exactly.
- Treat every protected table pipe as a cell-ownership boundary. Keep the
  visible text and protected literals of each source cell inside that same
  pair of table pipes. Keep link, strong/emphasis, and other formatting groups
  in source order, with the same nesting and Markdown AST ownership.
- Translate titles, prose, meaningful link labels, captions, alt text, table
  prose, callouts, and navigation labels naturally. Do not add explanations or
  omit source meaning.
- Capitalization does not protect generic architecture prose. Translate terms
  such as Service Definition, Service Provider, Consumer, Owner scope, and
  abstract seam unless the text is inside a protected code/API literal.
- Preserve a type or API name only when it is inline code, an API signature, a
  path/package token, or otherwise clearly code-shaped. Ordinary word
  headings/navigation such as `Core`, `Effect`, `Disposable`, and `Fiber` must
  be localized. In a mixed product-plus-noun heading, protect the product token
  and translate the generic noun.
- Exact package names, filenames, URLs, events, API symbols, and source-declared
  identifier/keyword/operation/provider/tool/family/example lists may remain
  Latin (for example `bash`, `fs`, `web`, `subagent`, and `todo`). Their
  surrounding explanatory prose must still be translated.
- Navigation labels are target-language UI. Translate them in a dedicated
  structured unit; a natural English label must not be copied unchanged.
- SEO is locale-owned. A Japanese or Korean page must derive its title and
  description from that locale's translated H1 and prose, and must emit its own
  language, self-canonical URL, Open Graph, Twitter, JSON-LD, reciprocal
  hreflang, and sitemap record. English SEO text is never a fallback.
- The current full bootstrap contains 83 pages per locale. Translate every page
  and every navigation label; never pad a missing target with English or another
  locale. A product name or protected literal may remain English, but surrounding
  headings and descriptions must read naturally in the target language.

## Closed required-terminology map

The runner may normalize only this closed, hash-bound map after schema
validation. Case variants of `registry`/`consumer` use the same target. Every
replacement is recorded in the immutable bundle receipt; adding an entry is a
new translation workflow and requires a recovery run.

| English source | Japanese | Korean |
|---|---|---|
| Add a custom provider | カスタムプロバイダーを追加 | 사용자 지정 제공자 추가 |
| Bash Executor | Bash 実行エンジン | Bash 실행기 |
| Typert registry | Typert レジストリ | Typert 레지스트리 |
| Host Gateway | Host ゲートウェイ | Host 게이트웨이 |
| Consumer Remote | コンシューマー Remote | 소비자 Remote |
| Remote contribution | Remote コントリビューション | Remote 기여 |
| lookup provider | ルックアッププロバイダー | 조회 제공자 |
| registry / The registry | レジストリ | 레지스트리 |
| consumer / Consumers | コンシューマー | 소비자 |
| Source: | ソース： | 출처: |
| Types: | 型： | 타입: |
| Service Definition | サービス定義 | 서비스 정의 |
| Service Provider | サービスプロバイダー | 서비스 제공자 |
| Owner scope | 所有者スコープ | 소유자 범위 |
| abstract seam | 抽象境界 | 추상 경계 |
| Effect (heading) | エフェクト | 이펙트 |
| Disposable (heading) | 破棄可能オブジェクト | 폐기 가능 객체 |
| Fiber (navigation label) | ファイバー | 파이버 |

The Subsystems index opening paragraph has an additional source-order
constraint: the complete `architecture.md` link group remains before the
`behavior` emphasis group. Translate the grammar around them; do not swap the
groups for Japanese or Korean word order.

## Japanese

- Use concise modern developer-documentation Japanese. Body prose uses a
  consistent polite `です・ます` style; headings may use short nominal forms.
- Prefer established Japanese software terminology while retaining protected
  product and code terms. Examples: configuration → `設定`, session →
  `セッション`, workspace → `ワークスペース`, persistence → `永続化`,
  sandbox → `サンドボックス`.
- Localize navigation, search, copy, appearance, accessibility, previous/next,
  and language-switching labels.
- Do not leave Korean or paragraphs of Simplified Chinese. Kanji is valid
  Japanese and must not be rejected merely because it belongs to the Han
  script; audit likely Chinese phrases together with the presence of Japanese
  kana.

## Korean

- Use natural formal Korean technical prose with consistent spacing and
  explanatory endings such as `합니다`, `됩니다`, and `수 있습니다`.
- Prefer established Korean software terminology while retaining protected
  product and code terms. Examples: configuration → `설정`, session → `세션`,
  workspace → `워크스페이스`, persistence → `영속성`, sandbox → `샌드박스`.
- Localize navigation, search, copy, appearance, accessibility, previous/next,
  and language-switching labels.
- Do not leave Japanese kana, Chinese sentences, or unnecessary English prose.
  Protected technical literals and code remain English.
