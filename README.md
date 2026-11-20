# VICE BAY v2 — Canvas 2D crime (gta6-01): 8 chapters, Air One helicopter, 5 respect ranks, 6-district standing, 2 crew, 3-tier garage, weapon wheel, 9 vehicles — golden-hour dusk + wet neon

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Xyzvixx/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Xyzvixx/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

**Vice Bay v2** is a full open-world crime game that runs offline in a desktop
browser from static files — no network requests, no libraries, no downloads.
You are **Rico Vale**, a former courier in debt in the fictional beach city of
Vice Bay. Take Mara's jobs, dodge Captain Rosa's police and her Air One
helicopter, and take the Bay for yourself — at golden-hour dusk, on wet neon
streets.

## How to run

```sh
node serve.ts        # then open http://localhost:8080
```

Or open `game/index.html` directly. There is no build step. Node 22 is
needed for `serve.ts` and for the make.fun entrypoint `node main.ts`.

## What is in the game

- **A living city** — six districts (Old Marina, Palm Heights, Downtown Vice
  Bay, The Docks, Sunset Strip, Beachfront), a road grid with named avenues
  and streets, a beach and harbour, parks, landmarks and neon-signed
  buildings, all generated from a single deterministic seed.
- **8-chapter story** — one arc, Rico Vale vs Los Tiburones: deliveries, dock
  fights, a 3-star escape, tailing a courier, surviving Air One, a neon heist,
  clearing four lieutenants, and the vault-car finale with a ranked results
  screen. Every chapter has a waypoint, HUD objective text and a retry path.
- **Air One helicopter** — spawns at 4–5 stars and searches with a spotlight
  cone, tracking you with a lag and holding your wanted heat while the light
  is on you. Break line of sight to lose it; it never damages you directly.
- **4 progression layers** — 5 respect ranks (Street → Legend) with concrete
  unlocks; per-district standing 0–100 that changes shop prices, police
  response time and which side jobs open; 2 recruitable crew (driver +15%
  top speed and a roadside repair, lookout with minimap pings and roadblock
  warnings); and a 3-tier garage (engine / armor / nitro) where upgrades are
  lost with a destroyed car and repairs scale with what you bolted on.
- **Weapon wheel + 4 guns** — hold Q for the radial wheel, pick with
  mouse or 1–5. P-9 pistol, VB-9 SMG, Boomstick shotgun, LR-7 rifle (rank 1+
  at Bay Arms), plus fists and drive-bys from a car. Locked guns show greyed
  out with their unlock condition.
- **9 vehicles** — Marlin sedan, Comet GT sport, Vano van, Cabrio taxi,
  Hauler truck, police Interceptor, plus the new Vespa Moto (fast, fragile),
  Rancho Pickup (tough, slow) and Vice Limo (long, prestige). Cars show
  damage tiers and explode on a fuse at max damage.
- **Wanted level & police** — 1–5 stars, heat 0–100. Foot cops try to arrest
  you, patrol cars chase and ram, roadblocks appear at 3+ stars. Get busted
  or wasted and you lose cash and the chapter restarts — never the run.
- **Side jobs** — taxi fares, a timed street race and food runs, gated by
  your standing in the district you are standing in (25 / 50 / 75).
- **Shops** — Dex Garage (repairs, armor, neon underglow), Bay Arms (guns,
  ammo, kevlar, rifle) and Neon Thread (outfits). Walk up and press E.
  Standing and rank 3 give real discounts.
- **Weather & day/night** — rain showers with wet, slick roads, a dusk-to-
  night clock with lit windows, street lamps, neon signs and headlights.
- **Audio** — fully synthesized WebAudio: engine hum, two-tone sirens,
  gunshots, crashes, rain, and three radio stations (V to switch, M to mute).
- **Save v4** — versioned localStorage saves (v3 migrates safely) with
  Continue, quick-save on Q tap, and an immediate save on chapter completion.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move / drive |
| Shift | Run |
| Mouse + click | Aim / shoot (drive-by from a car) |
| E | Enter / steal / leave car, pick up, use shop |
| R | Reload |
| Q (tap) | Quick-save |
| Q (hold >0.25s) | Weapon wheel |
| 1–5 | Pick weapon / buy in shops |
| G | Crew driver ability (in a car) |
| H | Crew lookout ability |
| J | Start a side job |
| T | Settings (music, traffic, freeze day/night) |
| V | Radio station |
| M | Mute |
| Esc | Pause |

## Screenshots

Deterministic, rendered live from the game with `?shot=…`:

1. `heli` — helicopter pursuit at dusk, 4 stars, spotlight cone
2. `garage` — Dex Garage upgrade screen, owned Comet GT
3. `combat` — on-foot combat, weapon wheel open, respect-rank HUD
4. `finale` — ranked results after The Last Job, night neon

## Originality

Everything in Vice Bay — the city, characters, vehicles, names, story, art,
sound and music — is original fiction created for this entry. It is not
affiliated with, endorsed by, or connected to Rockstar Games or any existing
game, brand or recording artist.

## License

MIT — see [LICENSE](LICENSE).
