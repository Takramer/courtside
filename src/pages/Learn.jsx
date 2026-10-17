import React from 'react'

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

export default function Learn() {
  return (
    <div className="page narrow learn">
      <h1>Fantasy basketball in 10 minutes</h1>

      <section>
        <h2>What the game is</h2>
        <p>You draft a team of real NBA players. When they play real games, their stats (points, rebounds and so on) count for your team. Each week you face one other manager in your league. Win more weeks than everyone else, then win the playoffs at the end of the season.</p>
        <p>Your team's stats only count for players in your <b>starting lineup</b> on days they <b>have a game</b>. Players on your bench score nothing. That single fact drives most daily decisions.</p>
      </section>

      <section>
        <h2>Categories vs. points</h2>
        <p><b>Categories (most common):</b> each week, your team's total in 9 stats is compared to your opponent's: points, rebounds, assists, steals, blocks, 3-pointers, FG%, FT% and turnovers. Win 5 of 9 and you win the week (or each category counts as its own win, depending on the league).</p>
        <p><b>Points:</b> every stat is worth a set number of points (a rebound = 1, a steal = 4, a turnover = −2). Highest total wins. Simpler: more playing time and more games almost always win.</p>
        <p>Check which one your league uses and set it in <a href="#league">League setup</a>.</p>
      </section>

      <section>
        <h2>The draft: how to use the Draft room</h2>
        <ol className="steps">
          <li>Before the draft, set teams, roster size and your draft position in League setup.</li>
          <li>Open <a href="#draft">Draft</a> next to your league's draft screen.</li>
          <li>Every time anyone picks, find that player and press <b>Mine</b> or <b>Taken</b>. Keep up; the suggestions only work if the board matches reality.</li>
          <li>When it is your turn, take one of the three suggestions. They weigh value, your weak categories, empty positions and who will not be there next round.</li>
          <li>Rules of thumb: early rounds, take the best player regardless of position. Avoid players with long injury histories in the first few rounds. Do not draft two centers in your first three picks unless they are elite.</li>
          <li>If your league app auto-drafts for you, it will not use these rankings. Stay at the screen.</li>
        </ol>
      </section>

      <section>
        <h2>Your season routine</h2>
        <ol className="steps">
          <li><b>Every day, 10 minutes before the first game (usually 7pm Eastern):</b> open <a href="#today">Today</a>, copy the suggested lineup into your league app. Sit anyone ruled out. Check the news dot next to any name.</li>
          <li><b>Monday:</b> open <a href="#waivers">Waivers</a> sorted by "Best this week". Players with 4 games that week beat better players with 2. Add one if he beats your weakest player.</li>
          <li><b>When injury news hits:</b> a starter going out for weeks often hands his minutes to a bench player. That bench player shows up under "Most added" or "Hottest". Grab him before others do.</li>
          <li><b>Any trade offer:</b> run it through <a href="#trade">Trade</a>. Never accept two worse players for one better one unless you have a strong waiver pickup ready for the open spot.</li>
          <li><b>Monthly:</b> look at My team's strong and weak categories. Trade from a category you dominate for help in one you are close to winning.</li>
        </ol>
      </section>

      <section>
        <h2>Why news matters</h2>
        <p>Projections are built from last season. Real seasons change fast: injuries, trades, a coach giving a young player more minutes, a player away from the team for personal reasons. The News page tags each story (Out, Long-term, Bigger role, Off-court, Minutes limit) and the player panel can search all recent press about anyone. Minutes are everything: a player who goes from 20 to 32 minutes a night roughly gains half again in stats.</p>
        <p>As games are played, this app shifts each player's numbers from his preseason projection toward what he is actually doing. By about 12 games in, real stats count for half.</p>
      </section>

      <section>
        <h2>Words you will see</h2>
        <dl className="gloss">{GLOSSARY.map(([t, d]) => <React.Fragment key={t}><dt>{t}</dt><dd>{d}</dd></React.Fragment>)}</dl>
      </section>
    </div>
  )
}
