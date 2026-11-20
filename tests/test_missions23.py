"""Vice Bay v2 — chapters 1-3 test (redo): complete c1-c3 end to end via
the debug hooks plus real input (teleport + E + aimed shooting), verify
respect points and district standing are awarded, the helicopter appears
at 4 stars, a garage upgrade is purchasable, and the weapon wheel opens."""
import os
import subprocess
import sys
import time
import urllib.request

REPO = os.path.expanduser("~/workspace/makefun/gta6-01/repo")
PORT = 8902
URL = f"http://127.0.0.1:{PORT}/index.html?debug=1&seed=1"

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


def aim_at_enemy(page, seconds=4.0):
    """Aim the mouse at the nearest enemy (screen coords from world coords,
    via the camera) and hold fire. Returns after `seconds`."""
    page.evaluate("""() => {
      const g = window.__game;
      const e = g.enemies[0];
      if (!e) return;
      const dx = e.x - g.player.x, dy = e.y - g.player.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = g.player.x - (g.camera.x - 640);
      const py = g.player.y - (g.camera.y - 360);
      window.__aimScreen = { x: px + (dx / len) * 200, y: py + (dy / len) * 200 };
    }""")
    aim = page.evaluate("() => window.__aimScreen")
    if aim:
        page.mouse.move(aim["x"], aim["y"])
    page.mouse.down()
    page.wait_for_timeout(int(seconds * 1000))
    page.mouse.up()


def poll_until(page, fn, timeout_ms=8000, poll_ms=250):
    """Poll a JS predicate until true or the timeout; returns the last value."""
    deadline = time.time() + timeout_ms / 1000.0
    last = None
    while time.time() < deadline:
        last = page.evaluate(fn)
        if last:
            return last
        page.wait_for_timeout(poll_ms)
    return last


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

            # ---- C1: pickup at Dex, deliver at Beach Cafe.
            st = debug_state(page)
            expect("C1 starts at stage 0", st["chapter"] == 0 and st["stage"] == 0)
            cash0 = st["cash"]
            page.evaluate("() => window.__debug.tp(700, 1300)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("C1 pickup advances", st["stage"] == 1, str(st["stage"]))
            page.evaluate("() => window.__debug.tp(2740, 600)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("C1 completes -> C2", st["chapter"] == 1, str(st["chapter"]))
            expect("C1 pays $300", st["cash"] == cash0 + 300, f"{st['cash']} vs {cash0 + 300}")
            expect("C1 in chaptersDone", "c1" in st["chaptersDone"])
            expect("C1 awards respect", st["respect"]["points"] >= 120,
                   f"respect={st['respect']}")
            expect("C1 raises beach standing", st["standing"].get("beach", 0) >= 8,
                   str(st["standing"]))

            # ---- C2: warehouse, kill 3, report to Mara.
            page.evaluate("() => window.__debug.tp(420, 1850)")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("C2 reaches kill stage", st["stage"] == 1, str(st["stage"]))
            expect("C2 spawns 3 enemies", st["enemies"] == 3, str(st["enemies"]))
            page.evaluate("() => { window.__debug.give('smg'); window.__debug.give('armor'); window.__debug.give('heal'); }")
            for _ in range(6):
                st = debug_state(page)
                if st["enemies"] == 0 or st["stage"] != 1:
                    break
                # Death works now (facade-closure fix): the scripted
                # player face-tanks three shooters, so top up HP and
                # armor every round instead of once before the fight.
                # Also clear wanted every round: this loop verifies the
                # kill-stage mechanics, not heat management (covered by
                # c5 + the heli checks) — a stationary player spraying
                # an SMG would otherwise be arrested mid-fight.
                page.evaluate("() => { window.__debug.give('heal'); window.__debug.give('armor'); window.__debug.clearWanted(); }")
                page.keyboard.press("r")  # reload the SMG from reserve
                page.wait_for_timeout(300)
                aim_at_enemy(page, 2.5)
                # Walk toward the warehouse centre so shots stay in range.
                page.evaluate("() => window.__debug.tp(420, 1820)")
                page.wait_for_timeout(200)
            # Clear heat once more the moment the loop exits: a foot cop
            # may already be standing on the player with a nearly-full
            # arrest timer, and the 400ms wait below would let it finish
            # the bust before the stage check runs.
            page.evaluate("() => window.__debug.clearWanted()")
            st = debug_state(page)
            expect("C2 all enemies down", st["enemies"] == 0, str(st["enemies"]))
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("C2 kill stage advances", st["stage"] == 2, str(st["stage"]))
            page.evaluate("() => { window.__debug.clearWanted(); window.__debug.give('heal'); }")
            page.evaluate("() => window.__debug.tp(1500, 950)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("C2 completes -> C3", st["chapter"] == 2, str(st["chapter"]))
            expect("C2 in chaptersDone", "c2" in st["chaptersDone"])
            expect("C2 respect grows", st["respect"]["points"] >= 320,
                   f"respect={st['respect']}")

            # ---- C3: wanted 3, reach the safehouse.
            st = debug_state(page)
            expect("C3 sets wanted 3", st["wanted"] == 3, f"wanted={st['wanted']}")
            page.evaluate("() => window.__debug.tp(2700, 2000)")
            page.wait_for_timeout(500)
            st = debug_state(page)
            expect("C3 completes story arc", st["chapter"] == 3, str(st["chapter"]))
            expect("C3 clears wanted", st["wanted"] == 0, f"wanted={st['wanted']}")
            expect("all 3 chapters done", st["chaptersDone"] == ["c1", "c2", "c3"],
                   str(st["chaptersDone"]))

            # ---- Helicopter: 4 stars must bring Air One overhead.
            page.evaluate("() => window.__debug.setWanted(4)")
            got_heli = poll_until(page, "() => window.__debug.state().heli !== null", 8000)
            st = debug_state(page)
            expect("helicopter appears at 4 stars", st["heli"] is not None,
                   f"heli={st['heli']}")
            expect("heli is tracking", st["heli"] in ("track", "search"), str(st["heli"]))
            page.evaluate("() => window.__debug.setHeli(false)")
            page.evaluate("() => window.__debug.clearWanted()")
            page.wait_for_timeout(300)
            expect("heli despawns on command", debug_state(page)["heli"] is None)

            # ---- Garage: buy engine tier 1 on an owned Comet.
            page.evaluate("() => { window.__debug.setCash(5000); window.__debug.inCar('comet'); }")
            page.wait_for_timeout(200)
            st = debug_state(page)
            car_id = st["carId"]
            ok = page.evaluate("() => window.__debug.buyUpgrade('engine', 1)")
            st = debug_state(page)
            expect("garage engine tier 1 buys", ok is True, str(ok))
            expect("garage records the upgrade",
                   st["garage"].get(str(car_id), {}).get("engine") == 1, str(st["garage"]))
            expect("garage charges $300", st["cash"] == 5000 - 300, f"cash={st['cash']}")
            # Same tier twice must fail; skipping a tier must fail.
            ok2 = page.evaluate("() => window.__debug.buyUpgrade('engine', 1)")
            ok3 = page.evaluate("() => window.__debug.buyUpgrade('engine', 3)")
            st = debug_state(page)
            expect("same tier cannot be bought twice", ok2 is False, str(ok2))
            expect("tier cannot be skipped", ok3 is False, str(ok3))
            expect("no double charge", st["cash"] == 5000 - 300, f"cash={st['cash']}")

            # ---- Weapon wheel opens via the debug hook and closes on Q.
            page.evaluate("() => window.__debug.openWheel()")
            page.wait_for_timeout(200)
            expect("weapon wheel opens", debug_state(page)["wheel"] is True)
            page.keyboard.press("q")
            page.wait_for_timeout(300)
            expect("Q tap closes the wheel", debug_state(page)["wheel"] is False)

            # REGRESSION (J4 round 3, BLOCKER): closing the wheel with
            # Esc while Q is still HELD must not reopen it — the old
            # frame-loop hold check reopened the wheel the same frame
            # Esc closed it, so Esc could never dismiss the wheel.
            page.keyboard.down("q")  # hold Q past the 250 ms threshold
            page.wait_for_timeout(500)
            expect("Q hold opens the wheel", debug_state(page)["wheel"] is True)
            page.keyboard.press("Escape")  # close while Q is still held
            page.wait_for_timeout(600)
            expect("Esc closes the wheel while Q is held",
                   debug_state(page)["wheel"] is False)
            page.keyboard.up("q")
            page.wait_for_timeout(300)
            expect("wheel stays closed after Q release",
                   debug_state(page)["wheel"] is False)

            # ---- Crew hooks: driver + lookout can be granted.
            page.evaluate("() => window.__debug.giveCrew('both')")
            st = debug_state(page)
            expect("crew driver granted", st["crew"]["driver"] is True)
            expect("crew lookout granted", st["crew"]["lookout"] is True)

            # ---- Side job: taxi pays out through pickup + dropoff.
            # Taxi unlocks at 25 standing in the current district, so
            # grant standing first (the unlock gate itself is covered
            # by the C1 beach-standing check above).
            page.evaluate("() => { for (const d of ['marina','heights','downtown','docks','strip','beach']) window.__debug.setStanding(d, 30); }")
            page.evaluate("() => window.__debug.startJob('taxi')")
            page.wait_for_timeout(200)
            st = debug_state(page)
            expect("taxi job starts", st["job"] and st["job"]["kind"] == "taxi")
            page.evaluate("""() => {
              const g = window.__game;
              const t = g.job.phase === 'pickup' ? g.job.pickup : g.job.dropoff;
              window.__debug.tp(t.x, t.y);
            }""")
            page.wait_for_timeout(400)
            page.evaluate("""() => {
              const g = window.__game;
              if (g.job) window.__debug.tp(g.job.dropoff.x, g.job.dropoff.y);
            }""")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("taxi job pays out", st["job"] is None, str(st["job"]))

            # ---- Job picker (J2 round 4): J opens a picker when more
            # than one job is unlocked, instead of rolling one at
            # random. Esc closes it without starting; Digit2 starts
            # the second job in the list.
            page.evaluate("() => { for (const d of ['marina','heights','downtown','docks','strip','beach']) window.__debug.setStanding(d, 80); }")
            page.evaluate("() => window.__debug.tp(1500, 1100)")  # downtown centre
            page.wait_for_timeout(200)
            page.keyboard.press("KeyJ")
            page.wait_for_timeout(200)
            st = debug_state(page)
            expect("J opens job picker with >1 job", st["screen"] == "jobs", str(st["screen"]))
            picker = page.evaluate("() => window.__game.jobPicker")
            expect("picker lists 3 unlocked jobs", picker == ["taxi", "race", "food"], str(picker))
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            st = debug_state(page)
            expect("Esc closes picker without starting", st["screen"] == "play" and st["job"] is None, str(st["screen"]))
            page.keyboard.press("KeyJ")
            page.wait_for_timeout(200)
            page.keyboard.press("Digit2")
            page.wait_for_timeout(200)
            st = debug_state(page)
            expect("Digit2 starts the race job", st["job"] and st["job"]["kind"] == "race", str(st["job"]))
            expect("picker closes after starting", st["screen"] == "play", str(st["screen"]))

            expect("zero console/page errors", len(errors) == 0, str(errors[:3]))
            browser.close()
    finally:
        server.terminate()

    print(f"\n{'ALL GREEN' if not problems else 'FAILURES: ' + ', '.join(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
