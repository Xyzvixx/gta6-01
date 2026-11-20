"""Vice Bay v2 — play test (redo): load, title screen, New Game, walk,
steal a car, drive, shoot, save/load, FPS, zero console errors and zero
external requests. Same harness style as the round-1 play test."""
import json
import os
import subprocess
import sys
import time
import urllib.request

REPO = os.path.expanduser("~/workspace/makefun/gta6-01/repo")
PORT = 8901
URL = f"http://127.0.0.1:{PORT}/index.html?debug=1&seed=1"
DOSSIER_OUT = "/tmp/vicebay-dossier-v2-redo"

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


def collect_traffic(page):
    errors, requests = [], []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))
    return errors, requests


def main():
    from playwright.sync_api import sync_playwright

    server = start_server()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            errors, requests = collect_traffic(page)
            page.goto(URL)
            page.wait_for_timeout(1200)
            expect("title screen shows", page.evaluate("() => window.__game.screen") == "title")
            expect("game object exposed", page.evaluate("() => !!window.__game && !!window.__debug"))
            expect("seed exposed", page.evaluate("() => window.__seed") == 1)

            # Start a new game.
            page.keyboard.press("Enter")
            page.wait_for_timeout(600)
            st = debug_state(page)
            expect("Enter starts play", st["screen"] == "play", str(st["screen"]))
            expect("chapter 1 active", st["chapter"] == 0 and st["stage"] == 0)
            expect("respect starts at zero", st["respect"]["points"] == 0 and st["respect"]["rank"] == 0)
            expect("standing starts at zero", all(v == 0 for v in st["standing"].values()))

            # Walk on foot.
            x0, y0 = st["x"], st["y"]
            page.keyboard.down("w")
            page.wait_for_timeout(1000)
            page.keyboard.up("w")
            st = debug_state(page)
            expect("walking moves Rico", abs(st["x"] - x0) + abs(st["y"] - y0) > 60,
                   f"moved to {st['x']},{st['y']}")

            # Steal a parked car: teleport next to one, press E.
            page.evaluate("""() => {
              const g = window.__game;
              const car = g.cars.find(c => c.role === 'parked'
                && Math.hypot(c.x - 700, c.y - 1300) > 200);
              window.__debug.tp(car.x + 30, car.y);
            }""")
            page.wait_for_timeout(200)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            st = debug_state(page)
            expect("stealing a car works", st["inCar"] is True, str(st))
            expect("stealing raises wanted", st["wanted"] >= 1, f"wanted={st['wanted']}")
            expect("steal counted", st["stats"]["stolen"] >= 1)

            # Drive forward.
            x0, y0 = st["x"], st["y"]
            page.keyboard.down("w")
            page.wait_for_timeout(2000)
            page.keyboard.up("w")
            st = debug_state(page)
            expect("driving moves the car", abs(st["x"] - x0) + abs(st["y"] - y0) > 150,
                   f"moved to {st['x']},{st['y']}")

            # Shoot (drive-by): mag should drop.
            mag0 = st["mag"]
            page.mouse.move(900, 360)
            page.mouse.down()
            page.wait_for_timeout(700)
            page.mouse.up()
            st = debug_state(page)
            expect("shooting spends ammo", st["mag"] < mag0, f"mag {mag0}->{st['mag']}")

            # Leave the car, quick-save with a Q tap, reload, continue.
            page.keyboard.press("e")
            page.wait_for_timeout(300)
            st = debug_state(page)
            expect("leaving the car works", st["inCar"] is False)
            cash_before = st["cash"]
            page.keyboard.press("q")
            page.wait_for_timeout(400)
            expect("quicksave writes", page.evaluate("() => window.__debug.hasSave()") is True)
            page.reload()
            page.wait_for_timeout(900)
            page.keyboard.press("Enter")  # Continue
            page.wait_for_timeout(600)
            st = debug_state(page)
            expect("continue restores cash", st["cash"] == cash_before,
                   f"{st['cash']} vs {cash_before}")
            expect("continue restores play", st["screen"] == "play")

            # REGRESSION (J4 round 2, BLOCKER): idling on the title
            # screen must never autosave the fresh chapter-0 game over
            # the real save. Save a sentinel cash value, return to the
            # title, force saveT to just under the 60 s autosave
            # threshold, idle 3 s, and confirm the stored save is
            # untouched.
            page.evaluate("() => { window.__debug.setCash(4321); window.__debug.save(); }")
            page.reload()
            page.wait_for_timeout(900)
            st = debug_state(page)
            expect("title screen shows after reload", st["screen"] == "title")
            saved_before = page.evaluate("() => JSON.parse(localStorage.getItem('vicebay.save.v4')).cash")
            expect("sentinel save stored", saved_before == 4321, f"cash={saved_before}")
            page.evaluate("() => { window.__game.saveT = 59; }")
            page.wait_for_timeout(3000)
            saved_after = page.evaluate("() => JSON.parse(localStorage.getItem('vicebay.save.v4')).cash")
            expect("title idle does not overwrite save", saved_after == 4321,
                   f"cash {saved_before}->{saved_after}")
            page.keyboard.press("Enter")  # Continue back into the game
            page.wait_for_timeout(600)

            # FPS over 2 seconds of driving.
            page.evaluate("() => window.__debug.inCar('comet')")
            page.keyboard.down("w")
            page.wait_for_timeout(2000)
            page.keyboard.up("w")
            fps = page.evaluate("() => window.__fps")
            expect("FPS >= 50", fps >= 50, f"fps={fps}")

            # FPS stress case (blueprint section 8 item 8): helicopter +
            # rain + full traffic + police at 1280x720.
            page.evaluate("() => { window.__debug.setWanted(4); window.__debug.setRain(1); }")
            page.keyboard.down("w")
            page.wait_for_timeout(2500)
            page.keyboard.up("w")
            stress_fps = page.evaluate("() => window.__fps")
            expect("stress FPS >= 40 (heli + rain + 4 stars)", stress_fps >= 40,
                   f"fps={stress_fps}")
            page.evaluate("() => { window.__debug.clearWanted(); window.__debug.setRain(0); }")

            # Pause / resume.
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            expect("pause works", page.evaluate("() => window.__game.screen") == "paused")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            expect("resume works", page.evaluate("() => window.__game.screen") == "play")

            external = [u for u in requests if "127.0.0.1" not in u and "localhost" not in u]
            expect("zero external requests", len(external) == 0, str(external[:3]))
            expect("zero console/page errors", len(errors) == 0, str(errors[:3]))
            browser.close()
    finally:
        server.terminate()

    # Dossier build.
    subprocess.run(["rm", "-rf", DOSSIER_OUT], check=False)
    env = dict(os.environ, MAKEFUN_OUTPUT_DIR=DOSSIER_OUT)
    r = subprocess.run(["node", "main.ts"], cwd=REPO, env=env,
                       capture_output=True, text=True)
    expect("dossier build exit 0", r.returncode == 0, r.stderr[-500:])
    expect("dossier.json written", os.path.exists(os.path.join(DOSSIER_OUT, "dossier.json")))
    if os.path.exists(os.path.join(DOSSIER_OUT, "dossier.json")):
        d = json.load(open(os.path.join(DOSSIER_OUT, "dossier.json")))
        print("dossier keys:", sorted(d.keys())[:8])

    print(f"\n{'ALL GREEN' if not problems else 'FAILURES: ' + ', '.join(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
