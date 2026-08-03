# Aegis Protocol

**v0.9.2 · public beta · fully open source (MIT)**

A browser turn-based tactics mini-game: jack a four-probe team onto a contested corporate die and either **wipe hostile processes** or **channel the north data port**. Three.js + TypeScript. XCOM-shaped tactics with a proto-cyberpunk skin.

> **Original IP.** Not affiliated with Firaxis, 2K, or *XCOM*.

---

## Story

It is early in the corporate net.

Full VR decks are still a rumor. People still type. ICE still feels experimental — half research paper, half private security contract. The big firms have already wired their fortunes into silicon and copper, and the only way in is to **jack probes** onto a live die: a hostile motherboard where terrain is trace and pad, cover is capacitors and heatsinks, and every shot is an executable.

You are the operator behind **Aegis Protocol** — an uplink kit that drops a four-process team onto contested hardware:

| Callsign | Class | Role |
|---|---|---|
| **REYES** | Intruder | Close-range scatter, breach tools, first through the pins |
| **CHEN** | Pointer | Long-read injects, high accuracy, overwatch and sandbox |
| **OKAFOR** | Sysop | Noise obfuscation, patch restores, keeps the team linked |
| **VOLKOV** | Flooder | Area pressure, throttle, heavy kit |

Hostile processes wake in pods. Wardens. Scrapers. Kernel guards. They stay dark until your vision touches them — then the cluster comes online and the die fights back.

### The campaign arc

Three ops. One stack clear.

1. **OP-01 · PIN PAD** — Soft insert on a training die. Prove the kit. Seize the north port or wipe scrapers before corp ICE notices.
2. **OP-02 · NODE VESPER** — Contested corporate die under an **ICE wake timer**. Courtyard, office, mech bay. How you win here matters:
   - **Quiet path (data port)** → Kernel is understaffed later
   - **Loud path (wipe)** → Kernel goes full alert
3. **OP-03 · KERNEL STACK** — Deep stack maze. Dual guards, multi-room ICE. Break the kernel or die trying.

Win either by **linking the north data port** (`link.sys` on the pylon, then **hold** through hostile cycles — no zerg-rush touch wins) or by **erasing every hostile process**. Crash your whole squad, or let a deadline expire, and the link dies.

Privilege (XP) banks across breaches. Crashed probes come back **wounded**. CRED buys loadout gear between ops. Survive the stack, and the campaign ends in a clean **STACK CLEAR**.

Tone: dirty firmware, edge connectors, amber CRT honesty. The outer game this mini-game plugs into is still coming — this is the breach layer.

---

## Play

```bash
npm install
npm run dev
```

Open the local URL. Enter the deck. Configure **OPS / SQUAD / SETTINGS**, then **JACK IN**.

| Input | Action |
|---|---|
| LMB | Select / move / confirm ability |
| Second click enemy | Fire (after hit preview) |
| Hover enemy | Hit chance preview |
| 1–7 | Abilities (`link.sys` appears on the pylon) |
| R | End cycle |
| Q / E | Rotate camera |
| WASD / arrows | Pan |
| Alt+drag / MMB / RMB drag | Orbit |
| Scroll | Zoom |
| Esc | Cancel targeting |

### Features (0.9.2 beta)

- Campaign arcs: **Standard (3 ops)** or **Extended (10 ops)** + Vesper branching
- Free skirmish (map / objective / ICE pick)
- ICE hardness: Sandbox → Live Net → Black Ice → **Void Ice** (extreme)
- Local **RECORDS** leaderboard (skirmish + campaign personal bests)
- Cover, flanks, FOW, pod activation, overwatch, grenades, smoke, heal
- Data port **channel + hold** (anti-rush)
- Deadline missions (ICE wake clock)
- XP / levels / ability gates, wounds, CRED loadout shop
- Procedural cyber-lofi ambient + local file music
- Debug cheats (optional) for testing

---

## Stack

- **Vite + TypeScript**
- **Three.js** (WebGL scene, units, FOW ghosts, VFX)
- Pure-TS simulation in `src/sim` (testable) separate from `src/view` / `src/ui`
- **Vitest** — combat, campaign, loadout, progression (~88 tests)

```bash
npm run dev      # local server
npm run build    # production → dist/
npm test         # unit tests
npm run preview  # serve production build
```

---

## Built off-grid — solar, Starlink, natural language

This project was written on an **off-grid homestead in rural Alaska**, powered **entirely by solar**, with internet over **Starlink**.

There was no studio pipeline and no hand-typed game engine from scratch in the classical sense. Development was done with:

- **[Grok Build](https://x.ai)** (Grok 4.5 coding agent / TUI)
- **Natural language** direction — design goals, polish lists, and play feedback spoken as plain English
- Local tools: Node, Vite, browser, git

The human side was direction, taste, playtesting, and “does this feel like a breach?” The machine side was implementation, refactor, tests, and iteration under Karpathy-style simplicity rules.

### Estimated build cost (from Grok Build session usage)

Tracked against the primary Aegis Protocol Grok Build session signals (local `/usage`-equivalent telemetry: `signals.json` / session stats — not a separate invoice export):

| Metric | Approx. value |
|---|---|
| Model | `grok-4.5` |
| User messages (session) | ~47 |
| Assistant turns | ~400 |
| Tool calls | ~1,280 |
| Tokens before compaction | **~1.6M** |
| Peak cumulative `totalTokens` in turn traces | **~4.5M** |
| Context window | 500k (peak use ~39% mid-session) |
| Compactions | 4 |
| Wall time (session) | ~13 hours active agent time |
| Agent lines added | ~19k |
| Files touched | ~86 |

**Dollar cost:** this session was driven through **Grok Build / SuperGrok-style access** rather than a public metered API receipt, so there is no clean per-token invoice in the local logs. Treat the numbers above as the honest **token volume** of the build; subscription price depends on your xAI plan at the time.

Rough order-of-magnitude if you *were* metering API-class rates on multi-million tokens: expect **tens of dollars**, not thousands — but the real bill for this project was **subscription + solar + Starlink + time on the homestead**, not a studio payroll.

---

## License

**MIT** — free to use, fork, mod, ship, and learn from. See [LICENSE](./LICENSE).

Attribution appreciated but not required: *Aegis Protocol* by UnderdarkEcho.

---

## Status

**0.9.2 public beta.** Vertical slice is playable end-to-end (standard + extended campaign, skirmish, Void Ice, local records, progression, audio). Expect rough edges: AI can still be dense, content reuses three maps, and the “outer sim” this mini-game plugs into is not in this repo.

Issues and PRs welcome.

---

## Repo

- GitHub: [github.com/UnderdarkEcho/aegisProtocol](https://github.com/UnderdarkEcho/aegisProtocol)
- Version: **0.9.2-beta**
