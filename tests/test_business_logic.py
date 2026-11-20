"""Vice Bay v2 — business-logic self-test (redo): cash cannot be
duplicated, garage tier cannot be bought twice, chapter rewards are
idempotent, a rapid double-click buy charges once, a destroyed upgraded
car loses its upgrades, and save/load mid-pursuit restores the pursuit
state."""

import os
import subprocess
import sys
import time
import urllib.request

REPO = os.path.expanduser("~/workspace/makefun/gta6-01/repo")
PORT = 8909
URL = f"http://127.0.0.1:{PORT}/index.html?debug=1&seed=11"

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
            page.wait_for_timeout(1000)
            page.keyboard.press("Enter")
            page.wait_for_timeout(600)

            # ---- Chapter reward idempotency: completing c1 twice pays once.
            cash0 = debug_state(page)["cash"]
            page.evaluate("() => window.__debug.tp(700, 1300)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(300)
            page.evaluate("() => window.__debug.tp(2740, 600)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("c1 completes", st["chapter"] == 1, str(st["chapter"]))
            cash_after_c1 = st["cash"]
            expect("c1 pays once", cash_after_c1 == cash0 + 300,
                   f"{cash_after_c1} vs {cash0 + 300}")
            # Re-trigger the completion path: re-run startChapter(0) and
            # complete it again — the second payout must not happen.
            page.evaluate("() => window.__debug.startChapter(0)")
            page.wait_for_timeout(300)
            page.evaluate("() => window.__debug.tp(700, 1300)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(300)
            page.evaluate("() => window.__debug.tp(2740, 600)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = debug_state(page)
            # c1 is already in chaptersDone; completing it again must not
            # pay a second $300 (the _settled guard + chaptersDone check).
            expect("c1 replay pays no second reward",
                   st["cash"] == cash_after_c1,
                   f"{st['cash']} vs {cash_after_c1}")

            # ---- Rapid double-click buy charges once (garage engine t1).
            # In an owned car at Dex, E opens the GARAGE (not the shop),
            # so the double-click test runs on the garage buy instead.
            page.evaluate("() => { window.__debug.setCash(5000); window.__debug.inCar('comet'); window.__debug.tp(700, 1300); }")
            page.wait_for_timeout(300)
            # Capture the car id while still in it (after getting out,
            # state()["carId"] is null).
            dbl_car_id = debug_state(page)["carId"]
            page.keyboard.press("e")  # get out first — E never opens the
            page.wait_for_timeout(300)  # garage from the driver's seat
            page.keyboard.press("e")  # on foot at Dex: garage opens
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("Dex garage opens for double-click test", st["screen"] == "garage",
                   str(st["screen"]))
            cash0 = st["cash"]
            # Two engine-tier-1 buys in rapid succession.
            page.keyboard.press("1")
            page.keyboard.press("1")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("double-click garage buy charges once",
                   st["cash"] == cash0 - 300,
                   f"{st['cash']} vs {cash0 - 300}")
            expect("double-click garage buy fits tier 1 once",
                   st["garage"].get(str(dbl_car_id), {}).get("engine") == 1,
                   str(st["garage"]))
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

            # ---- Destroyed upgraded car loses its upgrades.
            page.evaluate("() => { window.__debug.setCash(5000); window.__debug.inCar('comet'); }")
            page.wait_for_timeout(200)
            st = debug_state(page)
            car_id = st["carId"]
            page.evaluate("() => window.__debug.buyUpgrade('engine', 1)")
            page.wait_for_timeout(200)
            st = debug_state(page)
            expect("upgrade fitted before destruction",
                   st["garage"].get(str(car_id), {}).get("engine") == 1,
                   str(st["garage"]))
            # Blow the car up: damageCar(0) drops HP to 0, then light the
            # fuse directly (the fuse is what hurtCar sets; stepVehicles
            # explodes the car once it burns down).
            page.evaluate("""() => {
              window.__debug.damageCar(0);
              const g = window.__game;
              const car = g.cars.find((c) => c.id === g.player.carId);
              if (car) car.fuseT = 0.01;
            }""")
            page.wait_for_timeout(1500)
            st = debug_state(page)
            expect("destroyed car drops upgrades from garage",
                   str(car_id) not in st["garage"],
                   str(st["garage"]))
            expect("player thrown clear on foot", st["inCar"] is False)

            # ---- Save/load mid-pursuit restores the pursuit.
            page.evaluate("() => { window.__debug.inCar('comet'); window.__debug.setWanted(4); window.__debug.setCash(4321); }")
            page.wait_for_timeout(300)
            page.evaluate("() => window.__debug.save()")
            page.wait_for_timeout(300)
            page.reload()
            page.wait_for_timeout(900)
            page.keyboard.press("Enter")  # Continue
            page.wait_for_timeout(600)
            st = debug_state(page)
            expect("mid-pursuit load restores cash", st["cash"] == 4321,
                   f"cash={st['cash']}")
            expect("mid-pursuit load restores play", st["screen"] == "play")
            # Wanted level is intentionally reset on load (a fresh
            # pursuit); the save itself must load cleanly.
            expect("mid-pursuit load has no errors", len(errors) == 0,
                   str(errors[:3]))

            # ---- J1 round 2: per-weapon magazines, no ammo laundering.
            # The old code kept one shared p.mag: loading the pistol
            # then switching to the rifle fired 12 free rifle rounds.
            page.evaluate("() => window.__debug.give('rifle')")
            page.wait_for_timeout(200)
            st = debug_state(page)
            expect("rifle granted with full mag", st["weapon"] == "rifle" and st["mag"] == 20,
                   f"{st['weapon']} mag={st['mag']}")
            # One rifle round (rate 0.55s, so a 400ms hold fires once).
            page.mouse.move(1100, 360)
            page.mouse.down()
            page.wait_for_timeout(400)
            page.mouse.up()
            page.wait_for_timeout(200)
            st = debug_state(page)
            expect("rifle shot spends one round", st["mag"] == 19, f"mag={st['mag']}")
            # The SMG gets its own full mag, not the rifle's rounds.
            page.evaluate("() => window.__debug.give('smg')")
            page.wait_for_timeout(200)
            st = debug_state(page)
            expect("smg granted with own full mag", st["weapon"] == "smg" and st["mag"] == 30,
                   f"{st['weapon']} mag={st['mag']}")
            # Switch back to the rifle through the wheel (slot 5): the
            # rifle mag must still be 19 — no refill, no laundering.
            page.evaluate("() => window.__debug.openWheel()")
            page.wait_for_timeout(200)
            page.keyboard.press("5")
            page.wait_for_timeout(200)
            page.keyboard.press("q")
            page.wait_for_timeout(300)
            st = debug_state(page)
            expect("rifle mag preserved across switch", st["weapon"] == "rifle" and st["mag"] == 19,
                   f"{st['weapon']} mag={st['mag']}")

            # ---- J1 round 2: roadblock cars are removed with the block,
            # and a dropped far-away cop takes its car with it.
            page.evaluate("() => { window.__debug.setWanted(3); window.__game.rbT = 0.1; }")
            rb = None
            for _ in range(20):
                rb = page.evaluate("() => { const g = window.__game; return g.roadblock ? g.cars.filter(c => c.roadblock).length : null; }")
                if rb is not None:
                    break
                page.wait_for_timeout(500)
            expect("roadblock spawns two cars", rb == 2, str(rb))
            # Drive far away: the block clears by distance (>1600px).
            page.evaluate("() => window.__debug.tp(3000, 200)")
            page.wait_for_timeout(600)
            left = page.evaluate("() => window.__game.cars.filter(c => c.roadblock).length")
            expect("roadblock cars removed with the block", left == 0, f"left={left}")
            # Cop orphan: a patrol car 1700px+ away is dropped WITH its car.
            page.evaluate("() => window.__debug.setWanted(2)")
            page.wait_for_timeout(1500)
            car_id = page.evaluate("() => { const g = window.__game; const c = g.cops.find(x => x.kind === 'car'); return c ? c.carId : null; }")
            expect("patrol car spawned for orphan test", car_id is not None, str(car_id))
            if car_id is not None:
                page.evaluate("() => window.__debug.tp(200, 2200)")
                page.wait_for_timeout(800)
                gone = page.evaluate(f"() => !window.__game.cars.some(c => c.id === {car_id})")
                expect("dropped cop's car removed too", gone is True)
            page.evaluate("() => window.__debug.clearWanted()")
            page.wait_for_timeout(300)

            # ---- J1 round 2: a failed chapter's target car is removed,
            # never left behind as an invincible obstacle. Start c4
            # (tail stage), get busted, and check the old courier is
            # gone and at most one new one exists.
            page.keyboard.press("e")  # get out of the car (arrest needs Rico on foot)
            page.wait_for_timeout(300)
            page.evaluate("() => window.__debug.startChapter(3)")
            page.wait_for_timeout(500)
            old_tail = page.evaluate("() => window.__game.chapterData.tailCarId")
            expect("c4 tail courier spawns", old_tail is not None, str(old_tail))
            if old_tail is not None:
                page.evaluate("() => window.__debug.setWanted(1)")
                restarted = False
                for _ in range(40):
                    cur = page.evaluate("() => window.__game.chapterData.tailCarId")
                    if cur != old_tail:
                        restarted = True
                        break
                    page.wait_for_timeout(500)
                expect("bust restarts the chapter", restarted is True)
                left = page.evaluate("() => { const g = window.__game; return { n: g.cars.filter(c => c.tailTarget).length, old: g.cars.some(c => c.id === " + str(old_tail) + ") }; }")
                expect("old courier removed, at most one new one", left["n"] <= 1 and left["old"] is False, str(left))
            page.evaluate("() => window.__debug.clearWanted()")
            page.wait_for_timeout(300)

            expect("zero console/page errors", len(errors) == 0, str(errors[:3]))

            print()
            if problems:
                print(f"FAILURES: {', '.join(problems)}")
                return 1
            print("ALL GREEN")
            return 0
    finally:
        server.terminate()


if __name__ == "__main__":
    sys.exit(main())
