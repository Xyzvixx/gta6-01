# Vice Bay — an open-world crime game

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Xyzvixx/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Xyzvixx/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

**Vice Bay** is a complete open-world crime game that runs offline in a desktop
browser from static files — no network requests, no libraries, no downloads.
You are **Rico Vale**, a former courier in debt in the fictional beach city of
Vice Bay. Run Mara's jobs, dodge Captain Rosa's police, and take the Bay for
yourself.

## Play

```sh
node serve.ts        # then open http://localhost:8080
```

Or open `game/index.html` directly. No build step.

## What's in the game

- **A living city** — six districts (Old Marina, Palm Heights, Downtown,
  The Docks, Sunset Strip, Beachfront), a road grid with named streets, a
  beach and harbour, parks, landmarks and 2.5D extruded buildings.
- **Driving & stealing cars** — six fictional cars (Comet GT sport, Marlin
  sedan, Vano van, Cabrio taxi, Hauler truck, police Interceptor) with arcade
  physics. Press **E** to get in — parked and traffic cars can be stolen,
  and the cops notice.
- **Traffic & pedestrians** — cars follow the roads and turn at intersections;
  pedestrians stroll the sidewalks, cross at crosswalks and flee gunfire.
- **Wanted level & police** — 1–5 stars. Crimes raise the heat; hiding cools
  it. Foot cops try to arrest you, patrol cars chase and ram, and at 3+ stars
  roadblocks appear. Get **busted** or **wasted** and you lose cash and the
  mission restarts — never the run.
- **Missions & story** — three story missions (First Delivery, Sharks at the
  Docks, Rosa Is Coming) with dialogue, waypoints and a route line on the
  minimap, plus side jobs: taxi fares, a timed street race and food runs.
- **Combat** — mouse aim, click to shoot, three guns (P-9 pistol, VB-9 SMG,
  Boomstick shotgun) plus fists, drive-bys from a car, gang enemies, health
  and armor pickups.
- **HUD & minimap** — wanted stars, clock, street and district name, cash,
  health/armor, weapon and ammo, mission banner with distance, and a round
  minimap with the route to your objective.
- **Start & save** — title screen, pause, quick-save (**Q**), autosave on
  mission completion, versioned localStorage saves with Continue.
- **Shops** — Dex Garage (repairs, armor, neon underglow), Bay Arms (guns,
  ammo, kevlar) and Neon Thread (outfits). Walk up and press **E**.
- **Weather & damage** — rain showers with wet, slick roads; day/night cycle
  with lit windows, street lamps, neon signs and headlights; cars show dents,
  smoke and fire as they take damage and can explode.
- **Audio** — fully synthesized WebAudio: engine hum, sirens, gunshots,
  crashes, rain, and three radio stations (**V** to switch, **M** to mute).

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move / drive |
| Shift | Run |
| Mouse + click | Aim / shoot (drive-by from a car) |
| E | Enter / steal / leave car, pick up, use shop |
| R | Reload |
| Q | Quick-save |
| J | Start a side job |
| T | Settings (music, traffic, freeze day/night) |
| V | Radio station |
| M | Mute |
| Esc | Pause |

## Screenshots

Deterministic, rendered live from the game with `?shot=…&seed=1`:

1. `01-city-driving.png` — downtown drive, traffic and pedestrians
2. `02-on-foot-combat.png` — on-foot combat at the docks
3. `03-police-chase.png` — three-star police chase
4. `04-night-neon.png` — neon night in the rain

## Originality

Everything in Vice Bay — the city, characters, vehicles, names, story, art,
sound and music — is original fiction created for this entry. It is not
affiliated with, endorsed by, or connected to Rockstar Games or any existing
game, brand or recording artist.

## License

MIT — see [LICENSE](LICENSE).
