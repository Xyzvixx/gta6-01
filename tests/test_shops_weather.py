"""Vice Bay v2 — shops & weather test (redo): buy at all 3 shops
(including the rank-3 Kingpin discount), garage buy/tier rules through
the garage screen, save/load v4 round-trip plus v3 migration, rain +
clock, radio stations, and the 4 deterministic v2 screenshots
(< 256 KiB each)."""
import json
import os
import subprocess
import sys
import time
import urllib.request

REPO = os.path.expanduser("~/workspace/makefun/gta6-01/repo")
PORT = 8903
URL = f"http://127.0.0.1:{PORT}/index.html?debug=1&seed=1"
SHOTS = json.load(open(os.path.join(REPO, "shots.json")))

problems = []


def expect(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        problems.append(name)


def debug_state(page):
    return page.evaluate("() => window.__debug.state()")


def start_server():
    proc = subprocess.Popen(
        ["node", "serve.ts", "--port", str(PORT)],
        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(50):
        try:
            urllib.request.urlopen(URL, timeout=1)
            return proc
        except Exception:
            time.sleep(0.2)
    return proc


def nearest_car_hp(page):
    return page.evaluate("""() => {
      const g = window.__game;
      const p = g.player;
      let best = null, bd = 1e9;
      for (const c of g.cars) { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = c; } }
      return best ? best.hp : null;
    }""")


def main():
    from playwright.sync_api import sync_playwright

    server = start_server()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(URL)
            page.wait_for_timeout(800)
            page.keyboard.press("Enter")
            page.wait_for_timeout(500)
            page.evaluate("() => window.__debug.give('cash500')")

            # ---- Dex Garage: repair a damaged car (key 0).
            # The car is teleported WITH the player (tp moves the car
            # while Rico is driving it): repair only ever services the
            # player's OWN car (J2 round 2), so the damaged marlin
            # must actually be at Dex. The old flow teleported Rico
            # alone and the shop repair silently serviced a random
            # stranger's car parked near Dex instead. Repair is bought
            # on the GARAGE screen: E at Dex opens the garage whenever
            # the player's own car is parked there, which is exactly
            # why the shop's repair was unreachable in ordinary play.
            page.evaluate("() => { window.__debug.inCar('marlin'); window.__debug.damageCar(40); }")
            page.evaluate("() => window.__debug.tp(700, 1300)")
            page.keyboard.press("e")  # get out
            page.wait_for_timeout(300)
            page.keyboard.press("e")  # C1 pickup happens here first (same spot)
            page.wait_for_timeout(300)
            page.keyboard.press("e")  # now the garage opens (owned car at Dex)
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("Dex garage opens", st["screen"] == "garage", str(st["screen"]))
            cash0 = st["cash"]
            page.keyboard.press("0")  # full repair $80
            page.wait_for_timeout(300)
            st = debug_state(page)
            expect("repair charges $80", st["cash"] == cash0 - 80, f"{st['cash']} vs {cash0 - 80}")
            car_hp = nearest_car_hp(page)
            expect("repair restores car to 100 HP", car_hp == 100, f"car hp={car_hp}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            expect("garage closes", debug_state(page)["screen"] == "play")

            # ---- Kingpin discount: rank 3 (2000 respect) takes 20% off.
            page.evaluate("() => { window.__debug.setRespect(2000); window.__debug.setCash(2000); }")
            page.wait_for_timeout(200)
            st = debug_state(page)
            expect("respect rank 3 reached", st["respect"]["rank"] == 3, str(st["respect"]))
            page.evaluate("() => window.__debug.tp(1900, 950)")
            page.wait_for_timeout(200)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            expect("Bay Arms opens", debug_state(page)["screen"] == "shop")
            cash0 = debug_state(page)["cash"]
            page.keyboard.press("1")  # pistol ammo x48, list $40 -> $32 at rank 3
            page.wait_for_timeout(300)
            st = debug_state(page)
            expect("discount charges $32 not $40", st["cash"] == cash0 - 32,
                   f"{st['cash']} vs {cash0 - 32}")
            expect("ammo bought", st["ammo"]["pistol"] >= 48 + 96, str(st["ammo"]))
            # ---- Kevlar vest (Digit5, J2 round 3): Bay Arms has FIVE
            # goods and the old Digit1-4 keys left the vest unbuyable —
            # a whole shop item with no way to buy it.
            cash0 = debug_state(page)["cash"]
            armor0 = debug_state(page)["armor"]
            page.keyboard.press("5")  # Kevlar vest, list $120 -> $96 at rank 3
            page.wait_for_timeout(300)
            st = debug_state(page)
            expect("vest charges $96 not $120", st["cash"] == cash0 - 96,
                   f"{st['cash']} vs {cash0 - 96}")
            expect("vest adds +50 armor", st["armor"] == min(100, armor0 + 50),
                   f"armor={st['armor']} vs {armor0}")
            # ---- Vest refused at full armor (J2 round 5): buying the
            # vest at armor 100 must NOT charge — the round-5 fix
            # refuses BEFORE the cash is taken, with a toast.
            page.evaluate("() => window.__debug.setArmor(100)")
            page.wait_for_timeout(200)
            cash0 = debug_state(page)["cash"]
            page.keyboard.press("5")  # Kevlar vest, again
            page.wait_for_timeout(300)
            st = debug_state(page)
            expect("vest refused at armor 100 (cash unchanged)", st["cash"] == cash0,
                   f"{st['cash']} vs {cash0}")
            expect("armor stays 100", st["armor"] == 100, f"armor={st['armor']}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)

            # ---- Neon Thread: neon outfit, also discounted at rank 3.
            page.evaluate("() => window.__debug.tp(1100, 950)")
            page.wait_for_timeout(200)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            expect("Neon Thread opens", debug_state(page)["screen"] == "shop")
            cash0 = debug_state(page)["cash"]
            page.keyboard.press("2")  # neon outfit, list $90 -> $72 at rank 3
            page.wait_for_timeout(300)
            st = debug_state(page)
            expect("neon outfit equipped", st["outfit"] == "neon", str(st["outfit"]))
            expect("outfit discount applies", st["cash"] == cash0 - 72,
                   f"{st['cash']} vs {cash0 - 72}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)

            # ---- Garage screen: buy tiers 1-9 keys, tier order enforced.
            # Reset respect first: rank 3 (set above for the shop
            # discount) would discount garage prices too, but this
            # section checks list prices ($300 / $700).
            page.evaluate("() => { window.__debug.setCash(5000); window.__debug.setRespect(0); window.__debug.inCar('comet'); window.__debug.tp(700, 1300); }")
            page.wait_for_timeout(300)
            # Capture the car id while still in it: after getting out,
            # state()["carId"] is null and the garage lookup below would
            # check the wrong (empty) entry.
            car_id = debug_state(page)["carId"]
            page.keyboard.press("e")  # get out of the car first (E never
            page.wait_for_timeout(300)  # opens the garage from the
            page.keyboard.press("e")  # driver's seat — on foot at Dex
            page.wait_for_timeout(400)  # with an owned car nearby it does)
            st = debug_state(page)
            expect("garage screen opens at Dex", st["screen"] == "garage", str(st["screen"]))
            cash0 = st["cash"]
            page.keyboard.press("1")  # engine tier 1, $300
            page.wait_for_timeout(300)
            st = debug_state(page)
            expect("garage key 1 buys engine t1", st["garage"].get(str(car_id), {}).get("engine") == 1,
                   str(st["garage"]))
            expect("garage charges $300", st["cash"] == cash0 - 300, f"cash={st['cash']}")
            page.keyboard.press("3")  # engine tier 3: skipping tier 2 must fail
            page.wait_for_timeout(300)
            st = debug_state(page)
            expect("garage refuses skipped tier", st["garage"].get(str(car_id), {}).get("engine") == 1,
                   str(st["garage"]))
            expect("skipped tier not charged", st["cash"] == cash0 - 300, f"cash={st['cash']}")
            page.keyboard.press("2")  # engine tier 2, $700
            page.wait_for_timeout(300)
            st = debug_state(page)
            expect("garage buys engine t2 next", st["garage"].get(str(car_id), {}).get("engine") == 2,
                   str(st["garage"]))
            expect("garage charges $700", st["cash"] == cash0 - 1000, f"cash={st['cash']}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            expect("garage closes", debug_state(page)["screen"] == "play")

            # ---- Weather: rain on/off, clock set.
            page.evaluate("() => window.__debug.setRain(1)")
            page.wait_for_timeout(1200)
            st = debug_state(page)
            expect("rain rises to 1", st["rain"] > 0.5, f"rain={st['rain']}")
            page.evaluate("() => window.__debug.setRain(0)")
            page.wait_for_timeout(1200)
            st = debug_state(page)
            expect("rain falls back", st["rain"] < 0.5, f"rain={st['rain']}")
            page.evaluate("() => window.__debug.setClock(22.0)")
            page.wait_for_timeout(300)
            expect("clock sets to night", abs(debug_state(page)["clock"] - 22.0) < 0.2,
                   str(debug_state(page)["clock"]))

            # ---- Radio: V cycles stations.
            station0 = debug_state(page)["station"]
            page.keyboard.press("v")
            page.wait_for_timeout(300)
            station1 = debug_state(page)["station"]
            expect("radio changes station", station1 != station0 and station1 != "",
                   f"{station0!r} -> {station1!r}")

            # ---- Save/load v4 round-trip.
            page.evaluate("() => { window.__debug.setCash(1234); window.__debug.setRespect(450); }")
            page.evaluate("() => window.__debug.save()")
            page.wait_for_timeout(300)
            page.reload()
            page.wait_for_timeout(900)
            page.keyboard.press("Enter")  # Continue
            page.wait_for_timeout(600)
            st = debug_state(page)
            expect("v4 load restores cash", st["cash"] == 1234, f"cash={st['cash']}")
            expect("v4 load restores respect", st["respect"]["points"] == 450,
                   str(st["respect"]))
            expect("v4 load restores play", st["screen"] == "play")

            # ---- v3 migration: a v3 payload in the save slot must load
            # with clean v4 defaults (respect 0, standing 0, no crew).
            page.evaluate("""() => {
              const v3 = { v: 3, cash: 777, hp: 80, armor: 10, weapon: 'pistol',
                ammo: { pistol: 50, smg: 0, shotgun: 0, rifle: 0 }, outfit: 'neon',
                x: 1500, y: 1020, clock: 12, missionIndex: 1, missionsDone: ['m1'],
                stats: { stolen: 2, kills: 1, chapters: 0, jobs: 0, topWanted: 2, playtime: 60 },
                inCar: false, carType: null, savedAt: Date.now() };
              window.localStorage.setItem('vicebay.save.v4', JSON.stringify(v3));
            }""")
            page.reload()
            page.wait_for_timeout(900)
            page.keyboard.press("Enter")  # Continue
            page.wait_for_timeout(600)
            st = debug_state(page)
            expect("v3 migrates cash", st["cash"] == 777, f"cash={st['cash']}")
            expect("v3 migrates respect to zero", st["respect"]["points"] == 0,
                   str(st["respect"]))
            expect("v3 migrates standing to zero",
                   all(v == 0 for v in st["standing"].values()), str(st["standing"]))
            expect("v3 migrates crew to none",
                   st["crew"]["driver"] is False and st["crew"]["lookout"] is False,
                   str(st["crew"]))
            expect("v3 migrates chapter", st["chapter"] == 1, str(st["chapter"]))

            # ---- Settings toggles via the settings screen.
            page.keyboard.press("Escape")  # pause
            page.wait_for_timeout(200)
            page.keyboard.press("t")  # settings
            page.wait_for_timeout(300)
            expect("settings screen opens",
                   page.evaluate("() => window.__game.screen") == "settings")
            page.keyboard.press("2")  # traffic low
            page.wait_for_timeout(200)
            traffic = page.evaluate("() => window.__game.settings.traffic")
            expect("traffic toggles to low", traffic == "low", str(traffic))
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            expect("back to play", debug_state(page)["screen"] == "play")

            expect("zero console/page errors", len(errors) == 0, str(errors[:3]))

            # ---- Screenshots (deterministic v2 scenes). Each capture is
            # re-saved with lossless PNG optimisation (identical pixels,
            # better encoding — the same step a build pipeline runs) so a
            # busy dusk frame stays under the kit's 256 KiB cap.
            sizes = {}
            for shot in SHOTS:
                name = shot["name"]
                seed = shot.get("seed", 1)
                page.goto(f"http://127.0.0.1:{PORT}/index.html?debug=1&shot={name}&seed={seed}")
                page.wait_for_function("() => window.__shotReady === true", timeout=15000)
                page.wait_for_timeout(300)
                path = os.path.join(REPO, "screenshots", f"{name}.png")
                page.screenshot(path=path)
                try:
                    from PIL import Image
                    im = Image.open(path)
                    im.save(path, optimize=True)
                except Exception:
                    pass
                size = os.path.getsize(path)
                sizes[name] = size
                expect(f"shot {name} < 256 KiB", size < 262144, f"{size} bytes")
            print("screenshot sizes:", sizes)
            browser.close()
    finally:
        server.terminate()

    print(f"\n{'ALL GREEN' if not problems else 'FAILURES: ' + ', '.join(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
