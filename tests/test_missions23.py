"""Vice Bay fresh build — missions test: M1, M2, M3 end to end via the debug
hooks plus real input (teleport + E + aimed shooting), and the three side jobs."""
import os
import subprocess
import sys
import time

REPO = os.path.expanduser("~/workspace/makefun/gta6-01/repo")
PORT = 8902
URL = f"http://127.0.0.1:{PORT}/index.html?seed=1"

failures = []


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        failures.append(name)


def state(page):
    return page.evaluate("() => window.__debug.state()")


def shoot_at_enemies(page, seconds=4.0):
    """Aim the mouse at the nearest enemy (screen coords from world coords,
    via the camera — the player is NOT at screen centre near world edges)
    and hold fire. Returns after `seconds`."""
    page.evaluate("""() => {
      const g = window.__game;
      const e = g.enemies[0];
      if (!e) return;
      const dx = e.x - g.player.x, dy = e.y - g.player.y;
      const len = Math.hypot(dx, dy) || 1;
      // Player's screen position: world pos minus the camera's top-left.
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


def main():
    from playwright.sync_api import sync_playwright

    server = subprocess.Popen(
        ["node", "serve.ts", "--port", str(PORT)],
        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(50):
            try:
                import urllib.request
                urllib.request.urlopen(URL, timeout=1)
                break
            except Exception:
                time.sleep(0.2)
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

            # ---- M1: pickup at Dex, deliver at Beach Cafe.
            st = state(page)
            check("M1 starts at stage 0", st["missionIndex"] == 0 and st["stageIndex"] == 0)
            cash0 = st["cash"]
            page.evaluate("() => window.__debug.tp(700, 1300)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = state(page)
            check("M1 pickup advances", st["stageIndex"] == 1, str(st["stageIndex"]))
            page.evaluate("() => window.__debug.tp(2740, 600)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = state(page)
            check("M1 completes -> M2", st["missionIndex"] == 1, str(st["missionIndex"]))
            check("M1 pays $300", st["cash"] == cash0 + 300, f"{st['cash']} vs {cash0 + 300}")
            check("M1 in missionsDone", "m1" in st["missionsDone"])

            # ---- M2: warehouse, kill 3, report to Mara.
            page.evaluate("() => window.__debug.tp(420, 1850)")
            page.wait_for_timeout(400)
            st = state(page)
            check("M2 reaches kill stage", st["stageIndex"] == 1, str(st["stageIndex"]))
            check("M2 spawns 3 enemies", st["enemies"] == 3, str(st["enemies"]))
            page.evaluate("() => { window.__debug.give('smg'); window.__debug.give('armor'); window.__debug.give('heal'); }")
            for _ in range(6):
                st = state(page)
                if st["enemies"] == 0 or st["stageIndex"] != 1:
                    break
                page.keyboard.press("r")  # reload the SMG from reserve
                page.wait_for_timeout(300)
                shoot_at_enemies(page, 2.5)
                # Walk toward the warehouse centre so shots stay in range.
                page.evaluate("() => window.__debug.tp(420, 1820)")
                page.wait_for_timeout(200)
            st = state(page)
            check("M2 all enemies down", st["enemies"] == 0, str(st["enemies"]))
            page.wait_for_timeout(400)
            st = state(page)
            check("M2 kill stage advances", st["stageIndex"] == 2, str(st["stageIndex"]))
            page.evaluate("() => { window.__debug.clearWanted(); window.__debug.give('heal'); }")
            page.evaluate("() => window.__debug.tp(1500, 950)")
            page.wait_for_timeout(300)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = state(page)
            check("M2 completes -> M3", st["missionIndex"] == 2, str(st["missionIndex"]))
            check("M2 in missionsDone", "m2" in st["missionsDone"])

            # ---- M3: wanted 3, reach the safehouse.
            st = state(page)
            check("M3 sets wanted 3", st["wanted"] == 3, f"wanted={st['wanted']}")
            page.evaluate("() => window.__debug.tp(2700, 2000)")
            page.wait_for_timeout(500)
            st = state(page)
            check("M3 completes story", st["missionIndex"] == 3, str(st["missionIndex"]))
            check("M3 clears wanted", st["wanted"] == 0, f"wanted={st['wanted']}")
            check("all 3 missions done", st["missionsDone"] == ["m1", "m2", "m3"],
                  str(st["missionsDone"]))

            # ---- Side jobs: taxi, race, food.
            page.evaluate("() => window.__debug.startJob('taxi')")
            page.wait_for_timeout(200)
            st = state(page)
            check("taxi job starts", st["job"] and st["job"]["kind"] == "taxi")
            # Drive the taxi job through with teleports: pickup then dropoff.
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
            st = state(page)
            check("taxi job pays out", st["job"] is None, str(st["job"]))
            if st["job"] is not None:
                page.evaluate("() => window.__debug.cancelJob()")

            page.evaluate("() => window.__debug.startJob('race')")
            page.wait_for_timeout(200)
            for _ in range(3):
                page.evaluate("""() => {
                  const g = window.__game;
                  if (g.job) { const cp = g.job.points[g.job.cp]; window.__debug.tp(cp.x, cp.y); }
                }""")
                page.wait_for_timeout(350)
            st = state(page)
            check("race job completes", st["job"] is None, str(st["job"]))
            if st["job"] is not None:
                page.evaluate("() => window.__debug.cancelJob()")

            page.evaluate("() => window.__debug.startJob('food')")
            page.wait_for_timeout(200)
            for _ in range(3):
                page.evaluate("""() => {
                  const g = window.__game;
                  if (g.job) { const s = g.job.stops[g.job.stop]; window.__debug.tp(s.x, s.y); }
                }""")
                page.wait_for_timeout(350)
            st = state(page)
            check("food job completes", st["job"] is None, str(st["job"]))
            check("3 jobs counted", st["stats"]["jobs"] == 3, str(st["stats"]["jobs"]))

            check("zero console/page errors", len(errors) == 0, str(errors[:3]))
            browser.close()
    finally:
        server.terminate()

    print(f"\n{'ALL GREEN' if not failures else 'FAILURES: ' + ', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
