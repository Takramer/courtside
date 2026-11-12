# Design principles

Courtside is an instrument: you read it, decide, and leave. These rules come from the research below and from the "Instrument" direction in `src/styles.css`. Check new work against them before it ships.

## 1. Every number gets the picture that explains it

A number is a claim. A picture shows the reasons behind it.

- **Win probability → 20 dots.** "65%" is hard to feel. "You win 13 of 20 ways this week could end" is not. Quantile dotplots beat both plain text and bell curves for decisions under uncertainty (Kay et al., CHI 2016; Fernandes et al., CHI 2018). `OutcomeDots` in `src/charts.jsx`.
- **Projection → a bar with a whisker.** Solid is scored, the wash is still to come, the whisker is the give-or-take. `RaceBars`.
- **Games left → a week strip.** Seven cells, one per night. You can see whether the games fall on crowded or empty nights. `WeekStrip`.
- **Model honesty → a calibration plot.** "Said 75%, won 69%" as a dot off the diagonal. `Calibration`.

The test: if you delete the chart, is a question left unanswered? If not, the chart was decoration. Delete it.

## 2. One hero per view, and it must earn the size

The "big number, small label, row of stat tiles" layout is the most common templated-dashboard look ([AI slop catalogs](https://www.mintlify.com/pbakaus/impeccable/concepts/anti-patterns)). Here the big number appears only where it is the page's answer (the live score, the win %). Supporting facts became charts instead of a grid of identical tiles.

## 3. Colour has four jobs and no others

| Job | Token | Meaning |
|---|---|---|
| You | `--accent` (amber) | your side in every chart, your roster in the finder |
| The other side | `--info` (blue) | the opponent in every chart |
| Polarity | `--good` / `--bad` | win/lose, upgrade/downgrade, always with a shape or word |
| Magnitude | amber opacity (`heat()`) | value, cost if he sits |

- **Amber means you.** The leading score is no longer amber when it is the opponent's.
- **Red and green never work alone.** Deuteranopia brings `--good` and `--bad` within ΔE 7.4. So wins are filled dots and losses are open dots, verdicts are words, and deltas carry a sign.
- **Text never wears a series colour.** Labels stay in `--text` / `--muted` / `--dim`. A swatch beside the label carries identity.
- **No gradients, glows, glass or purple.** These are the fingerprints of generated UI ([why AI picks purple](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website), [noqta](https://noqta.tn/en/blog/ai-design-slop-overused-ui-patterns-fix-2026)).

## 4. Contrast for low vision, measured

Every text token clears WCAG 1.4.3 (4.5:1) on `--bg #0a0b0d`:

| Token | Was | Now | Ratio |
|---|---|---|---|
| `--muted` | #7c838f (5.2) | #9aa1ac | 7.6:1 |
| `--dim` | #555c66 (2.9, failed) | #7a818c | 5.0:1 |
| `--bad` | #c7453f (4.1, failed) | #d9534c | 5.0:1 |
| `--edge` (new) | — | #5c636e | 3.2:1, form-control borders (WCAG 1.4.11) |

Labels moved from 11px to 12px. Chart marks clear 3:1 against the surface ([WCAG 1.4.11](https://w3c.github.io/wcag21/understanding/non-text-contrast)). Run the dataviz validator for any new series colour; don't eyeball it.

## 5. Data-ink: thin marks, quiet axes, sparing labels

Following Tufte and Few: erase ink that carries no data ([Tufte notes](https://faculty.cc.gatech.edu/~stasko/7450/12/Notes/tufte.pdf)). That means:

- Hairline solid axes
- Bars no thicker than 24px
- A value label only where the eye needs one: the end of a bar, the projected final
- Sparkline-sized charts inside table rows, the week strip being one

A reader should get a page's answer within about five seconds ([Domo](https://domo-webflow.domo.com/learn/article/dashboard-design-examples-best-practices)).

## 6. Nothing hides behind a hover

Tooltips add detail; they never gate it. Every chart value is also on the page:

- in its caption (the dots sentence)
- in a label (the race bar finals)
- in a table beside it (calibration has its buckets table)

Charts carry an `aria-label` that says the same thing in words.

## 7. Copy says the thing first

Answer first, reason second, plain words. "You win 13 of 20 equally likely endings" before any method. "Open slots: Fri 7, Sat 6" before why it matters. No openers, no hype.

## 8. A phone is its own layout, not a squeezed desktop

- **Navigation sits under the thumb.** On a portrait phone or tablet the pages are a 5-tab bar at the bottom: Team, Week, Waivers, News, More. Landscape keeps the top row, because it has width but no height.
- **Nothing important hides behind a sideways scroll.** Phone tables fold the player cell to two lines and narrow the week strip. Slot, player, week and value then fit a 390px screen; extra columns can still be swiped to.
- **Touch targets are 44px** on any touchscreen (`pointer: coarse`), and a table's name cell is tappable across its whole area. Mice keep the denser sizes.
- **Every field is 16px on touch,** so iOS never zooms the page when you tap it.
- **Pinned chrome stays small.** Only the 48px top bar and the tab bar are fixed; the readout scrolls away.
- **Safe areas are respected** (notch, home bar), and the app can be added to the home screen and runs standalone.

The audit script behind these numbers loads every page at 320, 375, 393, 412, 852×393 and 768. It fails a page that:

- scrolls sideways
- has a tap target under 44px
- has text under 12px
- has an input that would make iOS zoom

## Anti-slop checklist

Before shipping a screen, it fails if it has any of these:

- [ ] A grid of identical cards or stat tiles
- [ ] A gradient, glow, glass panel or decorative blob
- [ ] Two hero numbers fighting for the eye
- [ ] Colour carrying meaning with no shape or word
- [ ] Text below 4.5:1, or a form control without a 3:1 edge
- [ ] A chart that answers no question the page asks
- [ ] A value reachable only by hovering
- [ ] Copy that opens with filler or restates the heading

## Sources

- Fernandes, Walls, Munson, Hullman, Kay. [Uncertainty Displays Using Quantile Dotplots or CDFs Improve Transit Decision-Making](https://idl.uw.edu/papers/uncertainty-bus), CHI 2018
- Kay, Kola, Hullman, Munson. [When(ish) is My Bus?](https://idl.uw.edu/papers/when-ish-is-my-bus), CHI 2016
- W3C. [Understanding SC 1.4.11 Non-text Contrast](https://w3c.github.io/wcag21/understanding/non-text-contrast)
- Tufte, *The Visual Display of Quantitative Information*; Few, *Information Dashboard Design* ([summary](https://faculty.cc.gatech.edu/~stasko/7450/12/Notes/tufte.pdf))
- AI-slop pattern catalogs: [impeccable](https://www.mintlify.com/pbakaus/impeccable/concepts/anti-patterns), [noqta](https://noqta.tn/en/blog/ai-design-slop-overused-ui-patterns-fix-2026), [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)
