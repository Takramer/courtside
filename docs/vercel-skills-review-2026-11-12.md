# Courtside review with Vercel's agent skills, 2026-11-12

Read-only review. No source file changed, nothing built, deployed or committed. Each finding below comes from reading the code at the file:line given. Two numbers come from small Node benchmarks run in /tmp against the real `src/lib/model.js`. Nothing was tested in a browser, so the UI findings are traced from code, not seen on screen.

## Top 5 proposed changes, ranked by user impact

### 1. Waivers freezes for about half a second on "Best this week"

- **Where:** `src/lib/model.js:130` (`etToday`), called from the sort key at `src/pages/Waivers.jsx:19`, `:22` and `:27`.
- **Skill / rule:** vercel-react-best-practices, `js-cache-function-results` (cache repeated calls made during render).
- **What is wrong:** `etToday()` calls `toLocaleDateString` with a time zone, which builds a new `Intl.DateTimeFormat` on every call. The "Best this week" sort key calls `games(p)` twice, and each call runs `etToday()`, so every comparison costs four formatter builds. With 400 free agents I measured 11,748 calls and 418 ms per sort on this Mac. A phone will be slower. The sort runs on every App render, and opening a player panel or the finder re-renders App, so clicking a name on that sort stalls before the panel opens.
- **Fix:** build the formatter once. This fixes every caller (App readout, Team, Matchup, plainTake), not just Waivers. With the cached formatter the same 11,748 calls took 10 ms, and the output string is identical (`2026-11-12` both ways).

```diff
-export const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
+const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }) // one formatter, not one per call
+export const etToday = () => ET.format(new Date())
```

- **Effort:** 5 minutes. Run `npm run check` afterwards, since predict.js and grade.js import model.js.

### 2. Every explanation tooltip is invisible on the phone and to the keyboard

- **Where:** `src/components.jsx:18-20` (`Tip`), `src/styles.css:150`. `Tip` appears 31 times across the app.
- **Skill / rule:** web-design-guidelines, Accessibility ("Interactive elements need keyboard handlers"; tooltips must work on focus) and Touch & Interaction.
- **What is wrong:** `Tip` shows its text only through the `title` attribute. It sets `data-tip`, but no CSS reads it (no `attr(` anywhere in `src/`). Touch browsers never show `title`, and browsers don't show it on keyboard focus either. `tabIndex={0}` gives each tip a tab stop that shows nothing. The plain-English text behind "Value", "Slot", "±", "Avl", "If he sits" and the rest is the beginner guide, and the app is used on a phone (`PhoneLink`, `League.jsx:202`).
- **Fix:** render the text in a real tooltip element and show it on hover and focus. `aria-describedby` keeps it readable to screen readers once `title` is gone.

```jsx
// components.jsx
export function Tip({ children, text }) {
  const id = useId()
  return (
    <span className="tip" tabIndex={0} aria-describedby={id}>
      {children}<span id={id} role="tooltip" className="tipbox">{text}</span>
    </span>
  )
}
```

```css
/* styles.css, next to .tip */
.tip { position: relative; }
.tipbox { display: none; position: absolute; left: 0; top: calc(100% + 6px); z-index: 30; width: max-content; max-width: min(320px, 80vw);
  padding: 6px 8px; background: var(--panel3); border: 1px solid var(--line2); color: var(--text);
  font: 400 13px/1.4 var(--sans); letter-spacing: 0; text-transform: none; white-space: normal; text-align: left; }
.tip:hover > .tipbox, .tip:focus > .tipbox { display: block; }
```

- **Effort:** about an hour, mostly checking on the phone. Two things to check: a tap must focus the span (`:focus`, not `:focus-visible`, is deliberate), and tips in table headers inside `.scroll` boxes may clip at the box edge.

### 3. Points-per-stat fields can't hold a negative number, so a minus sign flips the weight

- **Where:** `src/pages/League.jsx:72`. Compare `NumField` at `:8-18`.
- **Skill / rule:** web-design-guidelines, Forms (controlled inputs must accept partial input; "Errors inline next to fields").
- **What is wrong:** the default league scores in points (`model.js:21`), and five of its weights are negative (`fga -1`, `fta -1`, `to -2`, `model.js:17`). These inputs write `+e.target.value` on every keystroke. Typing "-" into a number input reports `''`, which becomes `0`. React then writes "0" back into the field, so the "-" disappears and the next digit lands as a positive number. Retyping `-2` for turnovers gives `+2` and silently re-ranks every player. `NumField` exists for exactly this problem (the comment on line 8), but these fields skip it. I traced this from the code and React 18's number-input handling; I did not reproduce it in a browser.
- **Fix:** use `NumField`, and stop it rounding and clamping when a step is set.

```diff
- <label key={k}>{WEIGHT_LABELS[k]}<input type="number" step="0.5" value={s.weights[k] ?? 0} onChange={(e) => set('weights', { ...s.weights, [k]: +e.target.value })} /></label>
+ <label key={k}>{WEIGHT_LABELS[k]}<NumField value={s.weights[k] ?? 0} min={-10} max={10} step={0.5} onCommit={(v) => set('weights', { ...s.weights, [k]: v })} /></label>
```

```diff
// NumField onBlur, League.jsx:16. `|| min` would turn a valid 0 weight into -10.
- onBlur={() => { const n = Math.max(min, Math.min(max, Math.round(+text) || min)); setText(String(n)); if (n !== value) onCommit(n) }}
+ onBlur={() => { const t = step ? +text : Math.round(+text); const n = text === '' || !Number.isFinite(t) ? value : Math.max(min, Math.min(max, t)); setText(String(n)); if (n !== value) onCommit(n) }}
```

- **Effort:** 15 minutes. Then type `-2`, `0` and `1.5` into a weight in the browser and check the rankings move the right way.

### 4. The news proxy caches its own failures

- **Where:** `api/news.js:57-58`, `:75-76`, `:83-84`, `:94-96`. The fetchers return `[]` on a bad status at `:10`, `:28` and `:41`.
- **Skill / rule:** vercel-optimize (the code-only cache-header check). Its rule: keep error and fallback responses dynamic, and cache only real answers.
- **What is wrong:** each upstream fetcher turns a failed request into an empty list, and the handler then sends its normal `s-maxage` header. A RotoWire, ESPN or Google outage becomes a 200 with an empty feed that Vercel's CDN keeps for 5 minutes on the main feed and 15 minutes on player searches, and can serve stale for up to an hour while it revalidates. During that time "Search all press" on any player says "Nothing found", and the injury report can look empty.
- **Fix:** let the fetchers throw on a bad status, and send `no-store` whenever any source failed.

```diff
 async function rotowire() {
   const r = await fetch('https://www.rotowire.com/rss/news.php?sport=NBA')
-  if (!r.ok) return []
+  if (!r.ok) throw new Error(`RotoWire ${r.status}`)
// same change in injuries() :28, espnHeadlines() :41, googleNews() :58

+const cacheFor = (res, failed, policy) => res.setHeader('Cache-Control', failed ? 'no-store' : policy)

-    const items = await googleNews(player).catch(() => [])
-    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')
-    return res.status(200).json({ news: items })
+    const items = await googleNews(player).catch(() => null)
+    cacheFor(res, !items, 's-maxage=900, stale-while-revalidate=3600')
+    return res.status(200).json({ news: items ?? [] })

-    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')
+    cacheFor(res, got.some((r) => r.status === 'rejected'), 's-maxage=900, stale-while-revalidate=3600')

-  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
+  cacheFor(res, [rw, espn, inj].some((r) => r.status === 'rejected'), 's-maxage=300, stale-while-revalidate=3600')
```

- **Effort:** 20 minutes. `npm run dev` serves `/api` locally; check the header with `curl -I` against a broken feed URL.

### 5. 254 KB of panel-only data downloads on every app load

- **Where:** `src/App.jsx:58-59`. The data is used only at `src/components.jsx:122` (`Guards`) and `:163` (`Friction`), both inside the player panel.
- **Skill / rule:** vercel-react-best-practices, `bundle-conditional` (load large data only when the feature is used) and `rerender-move-effect-to-event`.
- **What is wrong:** `matchups.json` (207 KB, 38 KB gzipped) and `friction.json` (47 KB, 8 KB gzipped) are fetched and parsed at startup, alongside `/api/players`, on every visit. Most visits never open a player panel.
- **Fix:** fetch them the first time a panel opens. `useFetch` already skips a `null` URL, and it keeps its data when the URL later goes back to `null`.

```diff
+  const [panelUsed, setPanelUsed] = useState(false)
-  const mdata = useFetch('/data/matchups.json')
-  const xdata = useFetch('/data/friction.json')
+  const mdata = useFetch(panelUsed ? '/data/matchups.json' : null) // panel-only data waits for the first panel
+  const xdata = useFetch(panelUsed ? '/data/friction.json' : null)
 ...
-    ... toast, open: setOpenId, ...
+    ... toast, open: (id) => { setOpenId(id); setPanelUsed(true) }, ...
```

- **Effort:** 10 minutes. The cost: on the first panel opened, "Who guards him" and "History with" show up a moment after the rest.

## Later

Smaller findings, one line each, all checked against the code.

- `src/App.jsx:226`: nav links don't mark the active page with `aria-current="page"`, only with the `on` class.
- `src/styles.css:57`: nav link text (`--dim` #555c66 on #0a0b0d) has 2.91:1 contrast at 11px, below the WCAG AA minimum of 4.5:1.
- `src/pages/Team.jsx:21-27`: the `PlayerSearch` combobox has no `aria-controls` or `aria-activedescendant`, so screen readers don't announce the arrow-key highlight.
- `src/App.jsx:307-319`: the `LinkIn` overlay has no `role="dialog"` or `aria-modal`, and Esc doesn't cancel it.
- `src/App.jsx:55` and `src/pages/News.jsx:29`: when `/api/news` fails, the page says "Loading news…" forever, because `ndata.error` never reaches it. `News.jsx:87` likewise says "Loading the injury report…" when the report is only empty.
- `src/pages/Matchup.jsx:17`: `Line` decides "out" from `p.inj` alone. It skips the shared `availability()` resolver that `App.jsx:166-171` says every page must use.
- `src/components.jsx:213-216`: `loadPress` doesn't check `p.id` when the answer returns, so a slow search can land on the next player opened with ⌘K. It also skips the `r.ok` check.
- `src/lib/espn.js:59`: the matchup poll keeps firing every 60 s in a hidden tab, two ESPN calls each time. Skip `run` while `document.hidden`; `onVis` already catches up when the tab returns.
- `api/matchup.js:74-86`: the history branch waits for the settings call only to get team names. One call with `?view=mMatchupScore&view=mTeam` would do both (`league.js:38` already stacks views). Rule: `async-parallel`.
- `api/league.js:38-56`: the free-agent call waits for `scoringPeriodId` from the first call. Running the two calls in parallel depends on ESPN accepting the filter without that ID, which I didn't verify.
- `api/news.js:19` and `:63`: one unparseable `pubDate` throws a RangeError and drops the whole RotoWire feed or the whole player search.
- `src/App.jsx:137-141`: the off-court sweep can't build its URL until `/api/players` returns, because the names come from `byId`. That's one extra round trip, and fixing it isn't worth much.
- `src/App.jsx:195-200`: App rebuilds one ctx object of about 50 keys on every render, so any App state change re-renders the whole active page, and `React.memo` can't help (composition rule `state-context-interface`, react rule `rerender-memo`). Once fix 1 lands, the cost doesn't justify a refactor.
- `src/components.jsx:195-207`: the panel's keydown effect depends on `onClose`, and App passes it inline (`App.jsx:283`), so it re-subscribes on every App render (`advanced-event-handler-refs`). Harmless.
- `src/pages/League.jsx:83-114`: `<label>` elements contain `<p className="affects">`, and a `<p>` inside a `<label>` is invalid HTML.
- `src/pages/League.jsx:231`: "Link copied" shows without waiting for `clipboard.writeText`, so it says copied even when the browser refuses.
- `src/styles.css:279`: the ⌘K input sets `outline: none` and gives no other focus style.
- `src/App.jsx:114` with `League.jsx:72` and `:101`: every keystroke in the slots and weights fields recomputes values for 650 players. That's fine at this size; noted only.

## Which skills ran

- **web-design-guidelines: ran.** I fetched the guidelines fresh from `vercel-labs/web-interface-guidelines` (`command.md`) on 2026-11-12 and checked `src/App.jsx`, `src/components.jsx`, `src/pages/*.jsx`, `src/styles.css`, `src/pages/*.css` and `index.html` against them. These pass: the global `:focus-visible` ring, `color-scheme: dark`, the `theme-color` meta, tabular numbers, reduced-motion fallbacks for the panel, finder and skeleton, labelled icon buttons, and the sonner toasts, which announce themselves.
- **vercel-react-best-practices: ran,** with the Next.js, RSC, server and hydration rules skipped. I read the rule files for async-parallel, client-swr-dedup, rerender-memo, rerender-use-deferred-value, rendering-content-visibility, client-localstorage-schema, js-cache-storage, rerender-no-inline-components, js-index-maps, js-cache-function-results, bundle-conditional and advanced-event-handler-refs. The seven startup fetches already run in parallel (`App.jsx:54-60`). No list needs virtualizing: Waivers stops at 60 rows (`Waivers.jsx:27`) and the roster is 13.
- **vercel-composition-patterns: ran,** with the React 19 rules skipped (the app runs React 18.3). The only finding is the ctx bag, listed under Later. There are just two boolean props (`PlayerName sub`, `NewsItem showName`), which is not proliferation, so no change.
- **vercel-optimize: metrics pipeline skipped. I ran no `vercel` commands.** The CLI is installed and the project is linked (`.vercel/project.json`, project "courtside"). But the skill needs CLI v53 or later (this machine has 50.35.0), and for a Vite SPA it stops to ask before running even a limited audit. I did the code-only cache-header check on `api/` instead:
  - `players.js:67` caches correctly and skips the header on its 502.
  - `news.js` caches its fallbacks (fix 4 above).
  - `league.js:61` and `matchup.js:103` and `:116` use `no-store`, which is right because they carry your ESPN cookies.
