"""Vice Bay fresh build — play test: load, input, steal/drive, shoot,
save/load, FPS, zero console errors and zero external requests."""
import json
import os
import subprocess
import sys
import time

REPO = os.path.expanduser("~/workspace/makefun/gta6-01/repo")
PORT = 8901
URL = f"http://127.0.0.1:{PORT}/index.html?seed=1"

failures = []


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        failures.append(name)


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
            requests = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("request", lambda r: requests.append(r.url))
            page.goto(URL)
            page.wait_for_timeout(1200)
            check("title screen shows", page.evaluate("() => window.__game.screen") == "title")
            check("game object exposed", page.evaluate("() => !!window.__game && !!window.__debug"))

            # Start a new game.
            page.keyboard.press("Enter")
            page.wait_for_timeout(600)
            st = page.evaluate("() => window.__debug.state()")
            check("Enter starts play", st["screen"] == "play", str(st["screen"]))
            check("mission 1 active", st["missionIndex"] == 0 and st["stageIndex"] == 0)

            # Walk.
            x0, y0 = st["x"], st["y"]
            page.keyboard.down("w")
            page.wait_for_timeout(1000)
            page.keyboard.up("w")
            st = page.evaluate("() => window.__debug.state()")
            check("walking moves Rico", abs(st["x"] - x0) + abs(st["y"] - y0) > 60,
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
            st = page.evaluate("() => window.__debug.state()")
            check("stealing a car works", st["inCar"] is True, str(st))
            check("stealing raises wanted", st["wanted"] >= 1, f"wanted={st['wanted']}")
            check("steal counted", st["stats"]["stolen"] >= 1)

            # Drive forward.
            x0, y0 = st["x"], st["y"]
            page.keyboard.down("w")
            page.wait_for_timeout(2000)
            page.keyboard.up("w")
            st = page.evaluate("() => window.__debug.state()")
            check("driving moves the car", abs(st["x"] - x0) + abs(st["y"] - y0) > 150,
                  f"moved to {st['x']},{st['y']}")

            # Shoot (drive-by): mag should drop.
            mag0 = st["mag"]
            page.mouse.move(900, 360)
            page.mouse.down()
            page.wait_for_timeout(700)
            page.mouse.up()
            st = page.evaluate("() => window.__debug.state()")
            check("shooting spends ammo", st["mag"] < mag0, f"mag {mag0}->{st['mag']}")

            # Leave the car, quick-save, reload, continue.
            page.keyboard.press("e")
            page.wait_for_timeout(300)
            st = page.evaluate("() => window.__debug.state()")
            check("leaving the car works", st["inCar"] is False)
            cash_before = st["cash"]
            page.keyboard.press("q")
            page.wait_for_timeout(400)
            check("quicksave writes", page.evaluate("() => window.__debug.hasSave()") is True)
            page.reload()
            page.wait_for_timeout(900)
            page.keyboard.press("Enter")  # Continue
            page.wait_for_timeout(600)
            st = page.evaluate("() => window.__debug.state()")
            check("continue restores cash", st["cash"] == cash_before,
                  f"{st['cash']} vs {cash_before}")
            check("continue restores play", st["screen"] == "play")

            # FPS over 2 seconds of driving.
            page.evaluate("() => window.__debug.inCar('comet')")
            page.keyboard.down("w")
            page.wait_for_timeout(2000)
            page.keyboard.up("w")
            fps = page.evaluate("() => window.__fps")
            check("FPS >= 50", fps >= 50, f"fps={fps}")

            # Pause / resume.
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            check("pause works", page.evaluate("() => window.__game.screen") == "paused")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            check("resume works", page.evaluate("() => window.__game.screen") == "play")

            external = [u for u in requests if "127.0.0.1" not in u and "localhost" not in u]
            check("zero external requests", len(external) == 0, str(external[:3]))
            check("zero console/page errors", len(errors) == 0, str(errors[:3]))
            browser.close()
    finally:
        server.terminate()

    # Dossier build.
    out = "/tmp/vicebay-dossier"
    subprocess.run(["rm", "-rf", out], check=False)
    env = dict(os.environ, MAKEFUN_OUTPUT_DIR=out)
    r = subprocess.run(["node", "main.ts"], cwd=REPO, env=env,
                       capture_output=True, text=True)
    check("dossier build exit 0", r.returncode == 0, r.stderr[-500:])
    check("dossier.json written", os.path.exists(os.path.join(out, "dossier.json")))
    if os.path.exists(os.path.join(out, "dossier.json")):
        d = json.load(open(os.path.join(out, "dossier.json")))
        print("dossier keys:", sorted(d.keys())[:8])

    print(f"\n{'ALL GREEN' if not failures else 'FAILURES: ' + ', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
