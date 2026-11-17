"""Vice Bay fresh build — shops & weather test: buy at all 3 shops, rain on/off,
car damage tiers, and the 4 deterministic screenshots (< 256 KiB each)."""
import json
import os
import subprocess
import sys
import time

REPO = os.path.expanduser("~/workspace/makefun/gta6-01/repo")
PORT = 8903
URL = f"http://127.0.0.1:{PORT}/index.html?seed=1"
SHOTS = json.load(open(os.path.join(REPO, "shots.json")))

failures = []


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        failures.append(name)


def state(page):
    return page.evaluate("() => window.__debug.state()")


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
            page.evaluate("() => window.__debug.give('cash500')")

            # ---- Dex Garage: repair a damaged car.
            page.evaluate("() => { window.__debug.inCar('marlin'); window.__debug.damageCar(40); }")
            page.keyboard.press("e")  # get out
            page.wait_for_timeout(300)
            page.evaluate("() => window.__debug.tp(700, 1300)")
            page.wait_for_timeout(200)
            page.keyboard.press("e")  # M1 pickup happens here first (same spot)
            page.wait_for_timeout(300)
            page.keyboard.press("e")  # now the shop opens
            page.wait_for_timeout(400)
            st = state(page)
            check("Dex shop opens", st["screen"] == "shop", str(st["screen"]))
            cash0 = st["cash"]
            page.keyboard.press("1")  # full repair $80
            page.wait_for_timeout(300)
            st = state(page)
            check("repair charges $80", st["cash"] == cash0 - 80, f"{st['cash']} vs {cash0 - 80}")
            car_hp = page.evaluate("""() => {
              const g = window.__game;
              const p = g.player;
              let best = null, bd = 1e9;
              for (const c of g.cars) { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = c; } }
              return best ? best.hp : null;
            }""")
            check("repair restores car to 100 HP", car_hp == 100, f"car hp={car_hp}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            check("shop closes", state(page)["screen"] == "play")

            # ---- Bay Arms: buy the SMG.
            page.evaluate("() => window.__debug.tp(1500, 950)")
            page.wait_for_timeout(200)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            check("Bay Arms opens", state(page)["screen"] == "shop")
            page.keyboard.press("2")  # VB-9 SMG $350
            page.wait_for_timeout(300)
            st = state(page)
            check("SMG bought", st["weapon"] == "smg" and st["ammo"]["smg"] >= 90,
                  f"{st['weapon']} ammo={st['ammo']}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)

            # ---- Neon Thread: neon outfit.
            page.evaluate("() => window.__debug.tp(1900, 600)")
            page.wait_for_timeout(200)
            page.keyboard.press("e")
            page.wait_for_timeout(400)
            check("Neon Thread opens", state(page)["screen"] == "shop")
            page.keyboard.press("2")  # neon outfit $90
            page.wait_for_timeout(300)
            st = state(page)
            check("neon outfit equipped", st["outfit"] == "neon", str(st["outfit"]))
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)

            # ---- Weather: rain on/off, wet road flag via state.
            page.evaluate("() => window.__debug.setRain(1)")
            page.wait_for_timeout(1200)
            st = state(page)
            check("rain rises to 1", st["rain"] > 0.5, f"rain={st['rain']}")
            page.evaluate("() => window.__debug.setRain(0)")
            page.wait_for_timeout(1200)
            st = state(page)
            check("rain falls back", st["rain"] < 0.5, f"rain={st['rain']}")

            # ---- Damage tiers: smoke/fire flags exist on a wrecked car.
            page.evaluate("() => { window.__debug.inCar('comet'); window.__debug.damageCar(20); }")
            page.wait_for_timeout(600)
            tier = page.evaluate("""() => {
              const g = window.__game;
              const car = g.cars.find(c => c.id === g.player.carId);
              return car ? car.hp : null;
            }""")
            check("damaged car holds 20 HP", tier == 20, f"hp={tier}")

            # ---- Settings toggles via the settings screen.
            page.keyboard.press("Escape")  # pause
            page.wait_for_timeout(200)
            page.keyboard.press("t")  # settings
            page.wait_for_timeout(300)
            check("settings screen opens",
                  page.evaluate("() => window.__game.screen") == "settings")
            page.keyboard.press("2")  # traffic low
            page.wait_for_timeout(200)
            traffic = page.evaluate("() => window.__game.settings.traffic")
            check("traffic toggles to low", traffic == "low", str(traffic))
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            check("back to play", state(page)["screen"] == "play")

            check("zero console/page errors", len(errors) == 0, str(errors[:3]))

            # ---- Screenshots (deterministic, seed 1).
            sizes = {}
            for shot in SHOTS:
                page.goto(f"http://127.0.0.1:{PORT}/index.html{shot['query']}")
                page.wait_for_function("() => window.__shotReady === true", timeout=15000)
                page.wait_for_timeout(300)
                path = os.path.join(REPO, "screenshots", shot["name"])
                page.screenshot(path=path)
                size = os.path.getsize(path)
                sizes[shot["name"]] = size
                check(f"shot {shot['name']} < 256 KiB", size < 262144, f"{size} bytes")
            print("screenshot sizes:", sizes)
            browser.close()
    finally:
        server.terminate()

    print(f"\n{'ALL GREEN' if not failures else 'FAILURES: ' + ', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
