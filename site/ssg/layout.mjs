// ─── the page shell ─────────────────────────────────────────────────────────
//
// Every page is the same three things in the same order: a masthead, an article, and a foot. What
// changes is the article's shape — a document with a sidebar, a document with a live specimen
// pinned beside it, or the full-width playground — and that is a class on `<body>` rather than a
// second layout.
//
// The sidebar is one list: the group the page belongs to, then the sections of the page. Which
// page of a group you are on and which section you are in are therefore the same column, read top
// to bottom, and a reader who is four pages into the documentation can still see the other pages.
//
// Links are RELATIVE, computed from how deep the page sits, which is what lets the same output be
// served from `/` in development and from `/litearea/` on Pages with nothing rewritten.
//
// A note on what is NOT here, because it used to be and it was wrong: there is no running head that
// arrives on scroll, no progress hairline, no rule above the wordmark, and no numbered claim or
// ledger block. Chrome that describes the page rather than telling the reader something they came
// for is decoration, and decoration that has to be read is worse than none.

import { escapeHtml as escape, frame } from './frames.mjs'
import { PAGES } from './pages.mjs'

const REPOSITORY = 'https://github.com/citisen/litearea'

/** What each group of pages is called in the sidebar and at the foot of a page. */
const GROUP_LABEL = new Map([
  ['/docs/', 'Documentation'],
  ['/api/', 'API'],
  ['/examples/', 'Examples'],
  ['/playground/', 'Playground'],
])

/** The groups the masthead offers, in the order they are read. */
export const SITE_INDEX = [
  { label: 'Docs', url: '/docs/' },
  { label: 'API', url: '/api/' },
  { label: 'Examples', url: '/examples/' },
  { label: 'Playground', url: '/playground/' },
]

/**
 * How deep a page sits, which is what every relative link is built from.
 *
 * It is read from the OUTPUT path and not from the url, because the two differ exactly where it
 * matters: `404.html` is served from the root but has no directory of its own.
 * @param out - the page's output path, relative to the Vite root.
 * @returns the number of directories between the site root and the page.
 */
function depthOf(out) {
  return out.split('/').length - 1
}

/**
 * The router every page is rendered with.
 * @param out - the page's output path.
 * @returns `{ up, depth, href(absolute) }`.
 */
export function routerFor(out) {
  const depth = depthOf(out)
  const up = depth === 0 ? './' : '../'.repeat(depth)
  return {
    up,
    depth,
    href: (absolute) => (absolute === '/' ? up : `${up}${absolute.replace(/^\//, '')}`),
  }
}

/**
 * The pages that sit beside this one: the same group, in the order the site is read.
 * @param page - the page record.
 * @returns its group, or an empty list when it belongs to none.
 */
function groupOf(page) {
  if (page.nav === undefined) return []
  return PAGES.filter((entry) => entry.nav === page.nav)
}

/**
 * The sidebar: the pages of this group, then the sections of this page.
 *
 * The section list is level-2 headings only. A documentation page here has a dozen third-level
 * headings under its second-level ones, and a list of all of them is longer than the article it
 * describes. The second-level ones are the page's own table of contents; the rest are found by
 * reading, or by search.
 *
 * The index is mono, so a heading's markup is taken back off rather than rendered: `` `words` `` is
 * a word here, not a code span, and a backtick set in a monospace face is a backtick.
 *
 * @param page - the page record.
 * @param headings - the headings the renderer collected.
 * @returns the nav, or an empty string when there is nothing to list.
 */
function sidebar(page, headings) {
  const entries = headings.filter((heading) => heading.level === 2)
  const group = groupOf(page)
  const label = (text) => escape(text.replace(/`/g, ''))
  const router = routerFor(page.out)

  const chapters = group.map(
    (entry) =>
      `<li class="rail-item"><a href="${router.href(entry.url)}"` +
      `${entry.url === page.url ? ' aria-current="page"' : ''}>${escape(entry.title)}</a></li>`,
  )

  const sections = entries.map(
    (heading) =>
      `<li class="rail-item"><a href="#${heading.id}"><span class="rail-text">${label(heading.text)}</span></a></li>`,
  )

  if (chapters.length === 0 && sections.length < 2) return ''

  const groupLabel = GROUP_LABEL.get(page.nav ?? '') ?? 'Also here'
  return (
    `<nav class="rail" aria-label="On this page">` +
    (chapters.length === 0
      ? ''
      : `<p class="rail-label">${escape(groupLabel)}</p><ul class="rail-list">${chapters.join('')}</ul>`) +
    (sections.length < 2
      ? ''
      : `<p class="rail-label">On this page</p><ul class="rail-list">${sections.join('')}</ul>`) +
    `</nav>`
  )
}

/**
 * The same list at the foot of the article.
 *
 * The sidebar is hidden on a narrow screen, so this is the entry point that survives there — and
 * it is also what a reader sees after finishing a page, which is where "what else is there" is
 * actually asked. It is skipped on a group's own index, whose whole body is that list.
 *
 * @param page - the page record.
 * @returns the nav, or an empty string when the page has no siblings.
 */
function footIndex(page) {
  const group = groupOf(page)
  if (group.length < 3 || page.url === page.nav) return ''
  const label = GROUP_LABEL.get(page.nav ?? '') ?? 'Also here'
  const items = group
    .map((entry) =>
      entry.url === page.url
        ? `<li><span aria-current="page">${escape(entry.title)}</span></li>`
        : `<li><a href="${routerFor(page.out).href(entry.url)}">${escape(entry.title)}</a></li>`,
    )
    .join('')
  return (
    `<nav class="more" aria-label="${escape(label)}">` +
    `<p class="more-label">${escape(label)}</p>` +
    `<ul class="more-list">${items}</ul>` +
    `</nav>`
  )
}

/**
 * One page, in full.
 *
 * @param page - the page record: `{ url, out, title, kind, nav, specimen, mirror }`.
 * @param article - the rendered article HTML.
 * @param headings - the headings the renderer collected.
 * @returns the complete document.
 */
export function renderPage(page, article, headings) {
  const router = routerFor(page.out)
  const index = SITE_INDEX.map(
    (entry) =>
      `<li><a href="${router.href(entry.url)}"${entry.url === page.nav ? ' aria-current="page"' : ''}>` +
      `${entry.label}</a></li>`,
  ).join('')

  const hasRail = page.nav !== undefined
  const hasSpecimen = page.specimen !== undefined

  const specimen = hasSpecimen
    ? frame('specimen', page.specimen.id, page.specimen.label ?? page.specimen.id, page.specimen.controls)
    : ''

  const bodyClass = [`kind-${page.kind}`, hasRail ? 'has-rail' : 'no-rail', hasSpecimen ? 'has-specimen' : '']
    .filter((part) => part !== '')
    .join(' ')

  const titleBlock =
    page.kind === 'home'
      ? ''
      : `<header class="title-block">` + `<h1 class="page-title">${escape(page.title)}</h1>` + `</header>`

  return `<!doctype html>
<html lang="en" data-mode="paper">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(page.headTitle ?? `${page.title} — litearea`)}</title>
<meta name="description" content="${escape(page.description ?? '')}">
<meta name="color-scheme" content="light dark">
<meta property="og:title" content="${escape(page.title)}">
<meta property="og:description" content="${escape(page.description ?? '')}">
<meta property="og:type" content="website">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/site.css">
${page.mirror === undefined ? '' : `<link rel="alternate" type="text/markdown" href="${router.href(page.mirror)}">`}
<link rel="alternate" type="text/plain" href="${router.href('/llms.txt')}" title="llms.txt">
<script>
  // The mode is chosen before the first paint, because a page that repaints itself in the other
  // colour a moment after it arrives is worse than one that never offers the choice.
  try {
    var stored = localStorage.getItem('litearea-site-mode')
    document.documentElement.dataset.mode = stored === 'ink' || stored === 'paper'
      ? stored
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'paper')
  } catch (error) { /* a private window, or storage switched off: paper it is */ }
</script>
<script type="module" src="/assets/site.ts"></script>
</head>
<body class="${bodyClass}" data-up="${router.up}">
<a class="skip" href="#main">Skip to the article</a>
<header class="masthead">
  <div class="masthead-row">
    <a class="wordmark" href="${router.href('/')}">litearea</a>
    <nav class="index" aria-label="The site">
      <ul class="index-list">${index}</ul>
    </nav>
    <button class="search-open" type="button" data-search-open>
      <span>Search</span><span class="search-key" data-search-key aria-hidden="true"></span>
    </button>
    <button class="mode-switch" type="button" data-mode-toggle aria-pressed="false">
      <span data-mode-word="paper">paper</span>
      <span class="mode-slash" aria-hidden="true">/</span>
      <span data-mode-word="ink">ink</span>
    </button>
  </div>
</header>
<main class="page" id="main">
${hasRail ? sidebar(page, headings) : ''}
${titleBlock}
<article class="prose">
${article}
${footIndex(page)}
</article>
${specimen}
</main>
<footer class="foot">
  <div class="foot-row">
    <p class="foot-line">MIT · <a href="${REPOSITORY}" target="_blank" rel="noreferrer">github</a> · <a href="https://www.npmjs.com/package/@citisen/litearea" target="_blank" rel="noreferrer">npm</a> · <a href="${router.href('/llms.txt')}">llms.txt</a>${
      page.mirror === undefined ? '' : ` · <a href="${router.href(page.mirror)}">this page as markdown</a>`
    }</p>
  </div>
</footer>
</body>
</html>
`
}
