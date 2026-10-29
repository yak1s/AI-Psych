# AI Psych 👁️

**The party game where a very curious AI asks questions about _you_.**

A hand-drawn, watercolor party game in the spirit of _Psych! Outwit Your Friends_. One person hosts, everyone else joins from their own phone with a 4‑digit code, and the "AI" asks questions about the players… questions that get a little too specific as the game goes on.

(The secret: the host uploaded the questions beforehand 🤫 — or the AI simply *noticed* things: whose phone is in another country, who is the only one on an iPhone, who keeps leaving the app…)

- 🎨 Hand-drawn watercolor look, lots of animation, synthesized sound effects and vibrations (every device can mute itself)
- 📱 No accounts, no install, no server to run — a static site that works on GitHub Pages
- 🔁 Survives refreshes, dropped connections and phones going to sleep. **If the host's phone dies, another player takes over and the game goes on.**
- 👥 2–30 players, games of 5, 10 or 15 questions
- 👀 150 built-in questions **plus questions built from what the AI notices** (time zones, phones, languages, how people play)
- ✨ Make a custom deck in minutes: fill in a few details, copy the ready-made prompt into ChatGPT / Gemini / Claude, paste the answer back
- 💬 Waiting-room chat with emoji reactions, reminders when it's your turn, full screen on phones

| | | |
| :---: | :---: | :---: |
| <img src="docs/screenshots/home.jpg" width="230" alt="Home screen"> | <img src="docs/screenshots/question-intro.jpg" width="230" alt="The AI noticed something"> | <img src="docs/screenshots/question-clue.jpg" width="230" alt="A question built from device clues"> |
| Home | "The AI noticed something…" | A question built from clues |
| <img src="docs/screenshots/vote.jpg" width="230" alt="Voting"> | <img src="docs/screenshots/results.jpg" width="230" alt="Results"> | <img src="docs/screenshots/chat.jpg" width="230" alt="Waiting-room chat"> |
| Voting (no vote, no points!) | Results | Waiting-room chat |
| <img src="docs/screenshots/greeting.jpg" width="230" alt="A late joiner is greeted"> | <img src="docs/screenshots/winner.jpg" width="230" alt="Winner and podium"> | |
| Everyone greets a late joiner | The podium (ties share a step) | |

<img src="docs/screenshots/host-lobby.jpg" alt="Host lobby with the room code, players and the secret deck">

<img src="docs/screenshots/ai-deck-helper.jpg" alt="Make a deck with AI">

---

## How to play

1. **Host**: open the site, tap **Host a game**, pick a name and a face. A 4‑digit room code appears.
2. **Everyone else**: open the same site, tap **Join with a code**, type the code (or scan the QR / use the share link), pick a name and a face.
3. The host picks **5, 10 or 15 questions** and presses **Start**.
4. Each round:
   - 🤖 The AI "writes" a question about one (or two) of the players.
   - ✍️ **Everyone writes an answer.** The screen shows how many answered; after you submit you see who is done and who is still writing.
   - 🗳️ **Vote** for your favorite answer. The answers are dealt to each phone one by one, in a different random order for each player. You can't vote for your own. Picked one but didn't lock it in? After 5 seconds you get a reminder, and if time runs out your pick counts.
   - 🙈 **No vote, no points:** if you could vote and didn't, the points your own answer earned don't count that round (the results say so).
   - ⚖️ The person the question is **about** is the judge: **their vote is worth 2 points**. Everyone else's vote is worth **1 point**.
   - 🏆 Results are revealed one by one, then the scoreboard. When everyone taps **Ready**, the next question starts.
5. After the last question there's a drumroll, a podium, confetti, a winner and a few silly awards. The podium shows every place up to 3rd and ties share a step (1st + two 2nds = 2 steps, 3 people; 1st, 2nd and three 3rds = 3 steps, 5 people).
6. **Play again** keeps the same room and players, and **never repeats a question** in that room. From the second game on, the warm-up (level 1) questions are skipped.

While you wait for the others there's a **waiting-room chat** (with emoji reactions). You only get messages sent while you're in a waiting room yourself — what you got stays with you for the rest of the room's games, with a marker where you were away.

Switch to another app mid-game and the game reminds you (a notification where the browser allows it, otherwise a blinking tab title) when there's a new question, it's time to vote, or everyone is waiting for you. On phones the game goes full screen on the first tap (turn it off in the menu).

### Host powers

- ⏱ **Timer (30 / 45 / 60 s)**: puts a countdown on everyone's screen. When it runs out, nothing happens automatically: the host sees who's missing and decides to **move on** (anything they had typed is sent for them), **add more time**, or keep waiting.
- ⏭ **Vote now / Results**: end the writing or voting part right away (whatever was typed or picked is sent).
- ⏩ **Skip question**: throws away the current answers and the AI writes a brand-new question for the same round.
- 👥 **Players**: kick someone mid-game, and match a late joiner to a name in the deck.
- 🛎️ **Let people in**: once a game is running, newcomers wait for the host's OK; then everyone sees a welcome and the newcomer plays from the next question. Joining with the name of a player who got disconnected (new phone, cleared browser) asks the host to give them back their seat — with their score.
- **Next anyway** on the results screen if someone wandered off, **End game** to go back to the lobby.

### Settings (lobby)

- Number of questions: 5 / 10 / 15
- **Time limit**: Off, Chill (2:00 to write / 1:00 to vote), Normal (1:30 / 0:45) or Fast (1:00 / 0:30). With a limit the game moves on by itself: unsent text is submitted automatically. If someone submitted and then started editing, the original submitted answer counts.
- "The person asked about writes an answer too" (on by default)
- "Let the AI use what it notices" — the clue questions (on by default)
- Top up with built-in questions if the deck runs out

---

## The secret question deck

The host can upload a **question deck** in the lobby at any time (even before anyone joins), and the room code stays on screen while they do it. The deck contains:

- **Questions**, each with a **creepiness level from 1 to 5**
- **Predicted players**: the people you expect to show up (e.g. "Mom", "Dad")

After uploading, the host **matches each predicted player to someone who actually joined** (AI Psych pre-matches obvious ones, like "Mommy" → Mom). The questions then use **the name the player typed when joining**, not the name in the file. If a predicted player didn't join, leave them on "not here" and **every question about them is skipped**.

During a game, questions are picked at random but the creepiness **climbs slowly from the lowest level to the highest**. The game also spreads questions across players so nobody gets asked about every round. Questions are never reused in the same room, even across games.

Without a deck, the AI uses its 150 built-in questions (with random players) and its clue questions (below).

### Make a deck with AI

In the deck panel, tap **✨ Make a deck with AI**. Fill in whatever you like (all optional): the occasion, where and when, how everyone is connected, a few words about each player, anything off limits, how many questions, and the language. Tap **Copy the prompt**, paste it into ChatGPT, Gemini or Claude, then copy the AI's whole reply and paste it into **step 2**. The game cleans up the usual chat-AI mistakes by itself (code fences, chatter around the JSON, trailing commas, an answer cut off halfway). You can still **download the template** and write a deck by hand.

## What the AI notices (clue questions)

Without anyone typing anything, each device quietly shares a few clues with the host (and only the host): its time zone and rough location (city level, from the internet connection — no location permission), its languages, phone or computer and which kind, dark mode, battery level, Wi‑Fi or mobile data, and a one-way fingerprint of its network (so the game can tell who's on the same Wi‑Fi without knowing the address). During the game the host also notices how people play: typing speed, how much they delete, how fast they vote, who keeps leaving the app, who answers first or last, who keeps voting for whom, who chats the most, who joined late.

From that, the AI writes questions **only when the clues make them interesting**, for example:

- *Everyone here is in the US… except Grandma, who is somewhere in Brazil. What is Grandma really doing there?*
- *Leo is the only one on an iPhone. What would it take for Leo to give it up and join the Android side?*
- *Mia has typed and deleted 212 letters in her answers so far. What did Mia write and then erase?*
- *It's 1:12 AM where Sam is. Why is Sam still awake?*

Clue questions are grouped by category (place, device, language, network, time, habits, the group), each with a per-game cap, so one game never turns into ten location questions. They're mixed in at the right creepiness level and never twice in a row. Turn them off in the settings.

### Questions are never repeated

Every question has a short code (shown on the card: `#B-…` built in, `#D-…` deck, `#AI-…` clue). Every device remembers which questions it has played — as host or as player, in any room — and tells the host when it joins. The host then prefers questions **nobody in the room has played**, then the ones the fewest people saw (and the fewest times). The lobby shows how many built-in questions are still fresh for this group.

### Placeholders

| In the file | Becomes |
| --- | --- |
| `{Mom}` | the player the host matched to "Mom" |
| `{any}` (or `{any1}`) | a random player, preferring whoever was asked about least |
| `{any2}`, `{any3}` | more random players, all different from each other and from the named ones |

A question can mention **two players** (e.g. `What does {Sarah} really think of {Mom}'s cooking?`). **Everyone mentioned is "about" the question, so each of their votes counts double.**

### Format 1: JSON (recommended)

```json
{
  "title": "Family Night",
  "players": ["Mom", "Dad", "Sarah", "Grandpa Joe"],
  "questions": [
    { "level": 1, "text": "What is {Mom}'s secret talent that nobody knows about?" },
    { "level": 2, "text": "What would {Grandpa Joe} and {Dad} argue about on a road trip?" },
    { "level": 3, "text": "What did {any} really do last weekend?" },
    { "level": 4, "text": "What does {Sarah} really think of {Mom}'s cooking?" },
    { "level": 5, "text": "What is the name {any} whispers when nobody is around?" }
  ]
}
```

`players` is optional (it's inferred from the placeholders), but listing them catches typos. Grouping by level also works: `"levels": { "1": ["…", "…"], "2": ["…"] }`.

### Format 2: plain text

```text
Title: Family Night
Players: Mom, Dad, Sarah, Grandpa Joe

[Level 1]
What is {Mom}'s secret talent that nobody knows about?

[Level 5]
What is the name {any} whispers when nobody is around?
```

Lines starting with `#` are comments. You can also prefix a single line with its level: `3| Why is {Dad} smiling?`

### Format 3: CSV (from a spreadsheet)

```csv
level,question
1,"What is {Mom}'s secret talent?"
4,"Why was {Dad} awake at 3am last Tuesday?"
```

Templates for all three formats are in [`decks/`](decks/), and the lobby has a **download template** link.

**Creepiness levels:** 1 😇 Innocent · 2 🤔 Curious · 3 🧐 Suspicious · 4 😰 Creepy · 5 👁️ How do they know?!

**Tips for writing a deck:** for a 10-question game with 5 levels, the game uses about 2 questions per level. Write at least 2–3 per level *for each person* so there are options if someone doesn't show up and for a second game. Levels 4–5 are where the "how does it know that?!" moments live.

---

## Deploy to GitHub Pages

This is a plain static site, with no build step and all libraries and fonts included in the repo.

**Option A: GitHub Actions (included)**
1. Push this repository to GitHub (the workflow deploys from `main`).
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the "Deploy to GitHub Pages" workflow manually). Your game is at `https://<you>.github.io/<repo>/`.

**Option B: deploy from a branch**
**Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**. That's it.

Any static host works too (Netlify, Cloudflare Pages, `python3 -m http.server`…).

---

## How the networking works (and why it's reliable)

- **WebRTC, host-authoritative.** The host's browser runs the game and is the single source of truth. Every player has a direct peer-to-peer data channel to the host.
- **Finding each other.** WebRTC needs a tiny "introduction" (signaling) server. By default AI Psych uses the free public [PeerJS](https://peerjs.com) server. The room code maps to a well-known peer id. After the introduction, game traffic goes device-to-device.
- **Two paths to every player.** Each device talks to the host over a direct WebRTC channel *and*, in parallel, an end-to-end encrypted relay through public MQTT brokers over secure WebSockets (several brokers at once for redundancy). The relay works where WebRTC can't — a host on a VPN, carrier-grade NAT on mobile data, players in other countries — and if the direct path dies mid-game the relay takes over instantly with no disconnect. The brokers only see encrypted bytes (ECDH key exchange + AES-GCM per player).
- **STUN / TURN.** Google and Cloudflare STUN servers plus the PeerJS TURN relay are configured. You can add your own TURN server in [`js/config.js`](js/config.js).
- **Everything is saved in the browser.** The host saves the whole game to `localStorage` after every change. Players keep their identity (a random id + secret) and any unsent actions. Nothing needs an account.
- **Refresh-proof.** A refreshed player silently rejoins as themselves, and a half-typed answer is kept. A refreshed host reclaims the same room id instantly (it keeps a private token) and everyone reconnects automatically, usually within a second. A service worker caches the app so a refresh works even while the internet is flaky.
- **Self-healing.** Both sides send heartbeats every 2 s. A silent connection (phone asleep, Wi‑Fi hiccup, tunnel) is detected in ~9 s and replaced with a fresh one, retrying with backoff forever. Actions (answers, votes, "ready") are queued and retried until the host acknowledges them, and the host de-duplicates them. So an answer submitted while offline is delivered when the connection comes back.
- **Closed the tab?** Open the site again and tap **Rejoin** (or **Resume** for the host). Lost the phone? Join from another device with the same name and the host gives you your seat back.
- **The host disappears? The game goes on.** The host keeps a compressed backup of the whole game on the next two devices in line. If nobody can reach the host for 25 seconds (and that device itself is online), the first one takes over hosting; everyone's devices find the new host by themselves (each hand-over gets a new address, announced over the encrypted relay), running clocks restart with the time that was left, and answers already sent are kept. When the old host comes back, it notices and rejoins as a normal player.
- **The host's connection is down? Nobody loses their turn.** While the host can't reach anyone, the clock stops. When a time limit runs out on someone whose connection just dropped, the game waits a few extra seconds for them.

### Self-hosting the signaling server (optional)

If you'd rather not depend on the public PeerJS server:

```bash
npx peer --port 9000        # https://github.com/peers/peerjs-server
```

Then either set `SIGNALING` in [`js/config.js`](js/config.js), or open the app with `?signal=https://your.server:443/` (the share link and QR code carry the setting to other players).

---

## Development

```bash
npm start                  # serves the site at http://localhost:8080
npm test                   # engine + deck-parsing unit tests (no dependencies)
npm install                # once, for the end-to-end tests
npx playwright install chromium
npm run test:e2e           # real browsers + real WebRTC + a private signaling server
```

The end-to-end tests play full games with several independent browsers. They also simulate the nasty stuff: player and host refreshes, network black-holes, abrupt ICE failures, a signaling-server restart, a closed tab, timers, skips, kicks, late joiners waiting for approval, a lost phone, and a host that vanishes mid-game. `npm run screenshots` regenerates the images in `docs/screenshots/`.

Handy console tools while testing: `__aipsych.current.net.simulateOutage(10000)` silently drops all traffic from that device for 10 s.

### Project layout

```
index.html, css/style.css      page + hand-drawn watercolor styles
js/game/engine.js              the rules: rooms, rounds, scoring, per-player views (pure, unit-tested)
js/game/deck.js                deck parsing (JSON/TXT/CSV), placeholders, creepiness levels
js/game/starter.js             built-in questions
js/game/dynamic.js             clue questions: templates, conditions, categories
js/signals.js                  device clues (time zone, rough location, phone, battery, network fingerprint)
js/net/host-net.js             host side of WebRTC (PeerJS), heartbeats, presence
js/net/client-net.js           player side, reconnect loop with backoff + watchdog
js/host-controller.js          engine ⇄ network glue for the host, persistence
js/player-controller.js        player identity, action queue with retries
js/ui/*                        Preact + htm components, watercolor art, synthesized audio
sw.js                          offline cache
```

## Credits

Built with [Preact](https://preactjs.com) + [htm](https://github.com/developit/htm), [PeerJS](https://peerjs.com), and [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (all bundled in `js/vendor/`). Fonts: [Finger Paint](https://fonts.google.com/specimen/Finger+Paint), [Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand) and [Caveat](https://fonts.google.com/specimen/Caveat) (SIL Open Font License). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

*AI Psych is a fan-made party game and is not affiliated with Psych! or its makers. (Also, there's no actual AI. Shh.)*
