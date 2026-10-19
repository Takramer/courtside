import React, { useEffect, useState } from 'react'
import './extras.css'

const GLOSSARY = [
  ['PG, SG, SF, PF, C', 'The five positions. Point guard and shooting guard are smaller ball-handlers and shooters; small forward and power forward are in between; center is the tallest, near the basket. Guards pile up assists, steals and threes. Centers pile up rebounds, blocks and FG%.'],
  ['FG% / FT%', 'Field goal % = share of shots made. Free throw % = share of free throws made. A player who shoots a lot at a high rate helps most; a poor shooter who shoots often hurts most.'],
  ['3PM', 'Three-pointers made: long shots worth 3 points.'],
  ['TO', 'Turnovers: losing the ball. Fewer is better. Stars handle the ball a lot, so they commit many; most managers ignore this category.'],
  ['ADP', 'Average draft position: where a player is usually picked across thousands of ESPN drafts. Tells you how long you can wait on someone.'],
  ['Value', "This app's single number for a player: how much better he is than the best player sitting on waivers. 0 means anyone could replace him."],
  ['Waivers / free agents', 'Players no team owns. Anyone can add them, often after a short waiting period.'],
  ['Streaming', 'Adding a free agent just for the days he plays, then dropping him for another. Fills empty lineup spots with extra stats.'],
  ['Punting', 'Deliberately giving up one category (often FT% or TO) so you can draft players who are great at everything else. You only need to win 5 of 9.'],
  ['GTD / Day-to-day', 'Game-time decision: might play, might not. Check again about an hour before the game.'],
  ['IR', 'Injured reserve: an extra roster spot for players listed OUT. Use it so injured stars do not cost you a bench spot.'],
  ['Hot / cold', 'Playing above or below his usual level over the last 15 days. Hot role players often cool off; cold stars usually recover.'],
]

const TOC = [['learn-basics', 'The game'], ['learn-scoring', 'Categories vs. points'], ['learn-routine', 'Season routine'], ['learn-news', 'Why news matters'], ['learn-words', 'Words you will see']]

export default function Learn() {
  const [active, setActive] = useState(TOC[0][0])
  // Highlight the section being read. The page uses #hash for routing, so the contents list scrolls with buttons, not anchors.
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      const hit = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (hit) setActive(hit.target.id)
    }, { rootMargin: '-120px 0px -55% 0px' })
    TOC.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [])
  const jump = (id) => {
    const el = document.getElementById(id); if (!el) return
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    el.querySelector('h2')?.focus({ preventScroll: true })
    setActive(id)
  }

  return (
    <div className="page learn learnpage">
      <nav className="toc" aria-label="On this page">
        <span>On this page</span>
        {TOC.map(([id, label]) => <button key={id} className={active === id ? 'on' : ''} aria-current={active === id ? 'true' : undefined} onClick={() => jump(id)}>{label}</button>)}
      </nav>
      <article>
      <h1>Fantasy basketball in 10 minutes</h1>
      <p className="lead">Read top to bottom once. Come back to any section when it comes up.</p>

      <section id="learn-basics">
        <h2 tabIndex={-1}>What the game is</h2>
        <p>You draft a team of real NBA players. When they play real games, their stats (points, rebounds and so on) count for your team. Each week you face one other manager in your league. Win more weeks than everyone else, then win the playoffs at the end of the season.</p>
        <p>Your team's stats only count for players in your <b>starting lineup</b> on days they <b>have a game</b>. Players on your bench score nothing. That single fact drives most daily decisions.</p>
      </section>

      <section id="learn-scoring">
        <h2 tabIndex={-1}>Categories vs. points</h2>
        <p><b>Categories (most common):</b> each week, your team's total in 9 stats is compared to your opponent's: points, rebounds, assists, steals, blocks, 3-pointers, FG%, FT% and turnovers. Win 5 of 9 and you win the week (or each category counts as its own win, depending on the league).</p>
        <p><b>Points:</b> every stat is worth a set number of points (a rebound = 1, a steal = 4, a turnover = −2). Highest total wins. Simpler: more playing time and more games almost always win.</p>
        <p>Check which one your league uses and set it in <a href="#league">League setup</a>.</p>
      </section>

      <section id="learn-routine">
        <h2 tabIndex={-1}>Your season routine</h2>
        <ol className="steps">
          <li><b>Every day, 10 minutes before the first game (usually 7pm Eastern):</b> open <a href="#team">My team</a>, set your ESPN lineup from it and sit anyone ruled out. Check the news dot next to any name.</li>
          <li><b>Monday:</b> open <a href="#waivers">Waivers</a> sorted by "Best this week". Players with 4 games that week beat better players with 2. Add one if he beats your weakest player.</li>
          <li><b>When injury news hits:</b> a starter going out for weeks often hands his minutes to a bench player. That bench player shows up under "Most added" or "Hottest". Grab him before others do.</li>
          <li><b>Any trade offer:</b> run it through <a href="#trade">Trade</a>. Never accept two worse players for one better one unless you have a strong waiver pickup ready for the open spot.</li>
          <li><b>Monthly:</b> look at My team's strong and weak categories. Trade from a category you dominate for help in one you are close to winning.</li>
        </ol>
      </section>

      <section id="learn-news">
        <h2 tabIndex={-1}>Why news matters</h2>
        <p>Projections are built from last season. Real seasons change fast: injuries, trades, a coach giving a young player more minutes, a player away from the team for personal reasons. The News page tags each story (Out, Long-term, Bigger role, Off-court, Minutes limit) and the player panel can search all recent press about anyone. Minutes are everything: a player who goes from 20 to 32 minutes a night roughly gains half again in stats.</p>
        <p>As games are played, this app shifts each player's numbers from his preseason projection toward what he is actually doing. By about 12 games in, real stats count for half.</p>
      </section>

      <section id="learn-words">
        <h2 tabIndex={-1}>Words you will see</h2>
        <dl className="gloss">{GLOSSARY.map(([t, d]) => <React.Fragment key={t}><dt>{t}</dt><dd>{d}</dd></React.Fragment>)}</dl>
      </section>
      </article>
    </div>
  )
}
