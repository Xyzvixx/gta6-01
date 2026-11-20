"""Vice Bay v2 — chapters 4-8 end-to-end (redo): tail, Air One survival,
heist, Kingpin Rising, The Last Job, plus the fail/retry path. Uses the
debug hooks plus real input (teleport + E + aimed shooting + driving)."""

import os
import subprocess
import sys
import time
import urllib.request

REPO = os.path.expanduser("~/workspace/makefun/gta6-01/repo")
PORT = 8908
URL = f"http://127.0.0.1:{PORT}/index.html?debug=1&seed=7"

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


def poll_expr(page, expr, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate(expr):
            return True
        time.sleep(0.2)
    return False


def aim_at_enemy(page, seconds=4.0):
    """Aim the mouse at the nearest enemy and hold fire."""
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


def shadow_target(page, car_flag, hold_seconds, radius=200):
    """Keep the player near a chapter target car (tail/chase stages) by
    teleporting alongside it. Returns True when the stage advances.
    Uses the CURRENT chapter's car id (chapterData), not the flag —
    a stale chase/tail car from an earlier chapter can share the flag."""
    start_st = debug_state(page)
    start_ch, start_stage = start_st["chapter"], start_st["stage"]
    start = time.time()
    while time.time() - start < hold_seconds + 20:
        st = debug_state(page)
        if st["chapter"] != start_ch or st["stage"] != start_stage:
            return True
        # Maintenance: these stages run under heavy police pressure. If
        # the player's car is gone or wrecked, a ram strands Rico on
        # foot where a foot cop arrests him and restarts the chapter
        # (the C5/C8 chase failures — the chase itself works, the car
        # just doesn't survive 20-25s of rams). Re-spawn a fresh comet
        # + heal whenever the car is gone or below half health.
        if not st["inCar"] or (st["carHp"] or 0) < 50:
            page.evaluate("() => { window.__debug.inCar('comet'); window.__debug.give('heal'); }")
        elif st["hp"] < 50:
            page.evaluate("() => window.__debug.give('heal')")
        pos = page.evaluate("""() => {
          const g = window.__game;
          const id = g.chapterData.chaseCarId || g.chapterData.tailCarId;
          const c = g.cars.find(c => c.id === id);
          if (!c) return null;
          return { x: c.x, y: c.y };
        }""")
        if pos:
            page.evaluate(
                f"() => window.__debug.tp({pos['x'] + radius}, {pos['y']})")
        # Re-teleport every 350ms: the target drives ~260 px/s, so a
        # 700ms gap lets it pull 180px away and the stage timer decays
        # instead of accumulating. 350ms keeps Rico inside the radius.
        page.wait_for_timeout(350)
    st = debug_state(page)
    return st["chapter"] != start_ch or st["stage"] != start_stage


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

            # ---- C4: tail the courier 25s, then steal the cargo.
            page.evaluate("() => window.__debug.startChapter(3)")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("C4 starts", st["chapter"] == 3 and st["stage"] == 0,
                   str((st["chapter"], st["stage"])))
            cash0 = st["cash"]
            # Follow the courier car (flag tailTarget) at ~200px for 25s.
            ok = shadow_target(page, "tailTarget", 25, radius=200)
            expect("C4 tail completes", ok and debug_state(page)["stage"] == 1,
                   str(debug_state(page)["stage"]))
            page.evaluate("() => window.__debug.tp(1500, 1650)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("C4 completes -> C5", st["chapter"] == 4, str(st["chapter"]))
            expect("C4 pays $800", st["cash"] == cash0 + 800,
                   f"{st['cash']} vs {cash0 + 800}")
            expect("C4 in chaptersDone", "c4" in st["chaptersDone"])

            # ---- C5: survive 90s at 4 stars, chase the van, hide.
            st = debug_state(page)
            expect("C5 starts at 4 stars", st["wanted"] >= 4,
                   f"wanted={st['wanted']}")
            cash0 = st["cash"]
            # Survive: drive in a car, repair/heal as needed, 90s.
            page.evaluate("() => { window.__debug.inCar('comet'); window.__debug.give('armor'); }")
            page.keyboard.down("w")
            survived = False
            t0 = time.time()
            while time.time() - t0 < 110:
                st = debug_state(page)
                if st["stage"] == 1:
                    survived = True
                    break
                if st["screen"] != "play":
                    break
                # Keep driving; steer a little so we don't pin to a wall.
                if int(time.time() - t0) % 10 < 5:
                    page.keyboard.down("a")
                    page.keyboard.up("d")
                else:
                    page.keyboard.down("d")
                    page.keyboard.up("a")
                if not st["inCar"] or (st["carHp"] or 0) < 35:
                    page.evaluate("() => { window.__debug.inCar('comet'); window.__debug.give('heal'); }")
                if st["hp"] < 40:
                    page.evaluate("() => window.__debug.give('heal')")
                page.wait_for_timeout(1000)
            page.keyboard.up("w")
            page.keyboard.up("a")
            page.keyboard.up("d")
            expect("C5 survive 90s completes", survived,
                   f"stage={debug_state(page)['stage']}")
            # Chase Mara's van 20s (flag chaseTarget).
            ok = shadow_target(page, "chaseTarget", 20, radius=120)
            expect("C5 van chase completes", ok and debug_state(page)["stage"] == 2,
                   str(debug_state(page)["stage"]))
            page.evaluate("() => window.__debug.tp(300, 250)")
            page.wait_for_timeout(500)
            st = debug_state(page)
            expect("C5 completes -> C6", st["chapter"] == 5, str(st["chapter"]))
            expect("C5 pays $1100", st["cash"] == cash0 + 1100,
                   f"{st['cash']} vs {cash0 + 1100}")

            # ---- C6: 3 checkpoints, take, vanish.
            cash0 = debug_state(page)["cash"]
            for (tx, ty, name) in [(1500, 1300, "cp1"), (1900, 950, "cp2"),
                                    (1500, 2000, "cp3")]:
                page.evaluate(f"() => window.__debug.tp({tx}, {ty})")
                page.wait_for_timeout(400)
            st = debug_state(page)
            expect("C6 reaches take stage", st["stage"] == 3,
                   str(st["stage"]))
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("C6 take advances", st["stage"] == 4, str(st["stage"]))
            page.evaluate("() => window.__debug.tp(2740, 600)")
            page.wait_for_timeout(500)
            st = debug_state(page)
            expect("C6 completes -> C7", st["chapter"] == 6, str(st["chapter"]))
            expect("C6 pays $1400", st["cash"] == cash0 + 1400,
                   f"{st['cash']} vs {cash0 + 1400}")

            # ---- C7: clear 2+2 lieutenants, report to Dex.
            cash0 = debug_state(page)["cash"]
            page.evaluate("() => window.__debug.give('smg')")
            page.evaluate("() => window.__debug.give('armor')")
            for _ in range(8):
                st = debug_state(page)
                if st["stage"] == 1:
                    break
                # Death works now (facade-closure fix): the scripted
                # player face-tanks two shooters, so top up HP and
                # armor every round instead of once before the fight.
                # Also clear wanted every round (see test_missions23:
                # this loop verifies kill mechanics, not heat).
                page.evaluate("() => { window.__debug.give('heal'); window.__debug.give('armor'); window.__debug.clearWanted(); }")
                page.keyboard.press("r")
                page.wait_for_timeout(200)
                aim_at_enemy(page, 2.5)
                page.evaluate("() => window.__debug.tp(1500, 950)")
                page.wait_for_timeout(200)
            # Clear heat once more the moment the loop exits (see C2):
            # a foot cop may already be in contact with a nearly-full
            # arrest timer.
            page.evaluate("() => window.__debug.clearWanted()")
            st = debug_state(page)
            expect("C7 downtown cleared", st["stage"] == 1, str(st["stage"]))
            # Re-arm before the docks stage: the downtown fight may have
            # burned most of the SMG reserve.
            page.evaluate("() => { window.__debug.give('smg'); window.__debug.give('armor'); window.__debug.give('heal'); }")
            for _ in range(8):
                st = debug_state(page)
                if st["stage"] == 2:
                    break
                # Same per-round top-up as the downtown fight.
                page.evaluate("() => { window.__debug.give('heal'); window.__debug.give('armor'); window.__debug.clearWanted(); }")
                page.keyboard.press("r")
                page.wait_for_timeout(200)
                aim_at_enemy(page, 2.5)
                page.evaluate("() => window.__debug.tp(420, 1850)")
                page.wait_for_timeout(200)
            # Same post-loop clear as the downtown fight.
            page.evaluate("() => window.__debug.clearWanted()")
            st = debug_state(page)
            expect("C7 docks cleared", st["stage"] == 2, str(st["stage"]))
            page.evaluate("() => window.__debug.tp(700, 1300)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("C7 completes -> C8", st["chapter"] == 7, str(st["chapter"]))
            expect("C7 pays $1800", st["cash"] == cash0 + 1800,
                   f"{st['cash']} vs {cash0 + 1800}")
            expect("C7 grants lookout crew", st["crew"]["lookout"] is True,
                   str(st["crew"]))

            # ---- C8: vault car, escort, deliver to the pier.
            cash0 = debug_state(page)["cash"]
            page.evaluate("() => window.__debug.tp(1900, 1300)")
            page.wait_for_timeout(500)
            st = debug_state(page)
            expect("C8 escort stage", st["stage"] == 1, str(st["stage"]))
            ok = shadow_target(page, "chaseTarget", 25, radius=120)
            expect("C8 escort completes", ok and debug_state(page)["stage"] == 2,
                   str(debug_state(page)["stage"]))
            page.evaluate("() => window.__debug.tp(420, 2100)")
            page.wait_for_timeout(600)
            st = debug_state(page)
            expect("C8 completes the arc", st["chapter"] == 8,
                   str(st["chapter"]))
            expect("C8 pays $3000", st["cash"] == cash0 + 3000,
                   f"{st['cash']} vs {cash0 + 3000}")
            expect("C8 in chaptersDone", "c8" in st["chaptersDone"])
            expect("all 5 chapters (c4-c8) done",
                   st["chaptersDone"] == ["c4", "c5", "c6", "c7", "c8"],
                   str(st["chaptersDone"]))
            # Ranked results panel appears after the finale.
            page.wait_for_timeout(500)
            results = page.evaluate("() => window.__game.results")
            expect("S-rank results shown", results is not None and results.get("rank") == "S",
                   str(results))

            # ---- Fail/retry: losing the c4 courier restarts c4.
            page.evaluate("() => window.__debug.startChapter(3)")
            page.wait_for_timeout(400)
            # Destroy the courier car so the tail stage fails.
            page.evaluate("""() => {
              const g = window.__game;
              const c = g.cars.find(c => c.tailTarget);
              if (c) { c.hp = 0; c.dead = true; }
            }""")
            page.wait_for_timeout(600)
            st = debug_state(page)
            expect("fail restarts c4 at stage 0",
                   st["chapter"] == 3 and st["stage"] == 0,
                   str((st["chapter"], st["stage"])))

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
