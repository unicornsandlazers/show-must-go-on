# The Show Must Go On

Party game: every guest gets a secret mission plus two decoys. Later everyone
votes on their phones which mission was real, and the TV shows the results.

- `index.html`: the invitation for guests (RSVP, missions, voting on the phone)
- `tv.html?key=…`: the stage screen for the TV, with the host's controls
- `apps-script/Code.gs`: the backend (Google Apps Script + Google Sheet)

**No missions live in this repository.** They are stored only in the Google
Sheet, and the site fetches one player's missions only when that player taps
"Show my missions".

## Setup (one-time)

1. Create a new Google Sheet.
2. In it, open **Extensions → Apps Script**, delete the sample code and paste in
   the whole of `apps-script/Code.gs`. Save.
3. In the function menu at the top, choose `setup` and click **Run**. Google
   asks you to approve access to the Sheet. When it finishes, the **Execution
   log** shows the **Admin key**. Save it.
4. The Sheet now has these tabs: `Players`, `RSVP`, `Votes`, `State`, `Config`.
   - `Players`: Name | Mission | Decoy 1 | Decoy 2 (import players.csv here).
   - `Config`: fill in the date, time, address and the invitation text.
5. **Deploy → New deployment → Web app**. Set "Execute as": *Me*, and
   "Who has access": *Anyone*. Click Deploy and copy the **Web app URL**
   (it ends with `/exec`).
6. Paste that URL into `config.js` in this repository and push.
7. GitHub: **Settings → Pages → Deploy from a branch → main / (root)**.

Links:
- Guests: `https://<user>.github.io/show-must-go-on/`
- TV: `https://<user>.github.io/show-must-go-on/tv.html?key=<ADMIN KEY>`

If you change `Code.gs` later: **Deploy → Manage deployments → pencil icon →
Version: New version → Deploy**. The URL stays the same.

## During the party

1. Open the TV page. It shows a QR code, and the guests' phones switch to the
   vote on their own.
2. **Start the vote** (click twice to confirm). This shuffles the players who
   answered "playing" and clears any old votes.
3. For each player: wait for the votes → **Reveal** → **Next player**.
   - **Mission not done**: the player gets no points for fooling people.
   - **Skip this player**: when someone has already left.
   - **Undo reveal**: reopens the vote if something went wrong.
4. After the last player: **Show final results**.
5. `H` hides the control bar.

## Points

| Situation | Right guessers | Player |
|---|---|---|
| Some guessed right | +2 | +1 for each person fooled |
| Everyone guessed right | +1 | 0 |
| Nobody guessed right | 0 | 0 |

## Local testing

`node dev/mock-server.js` runs `Code.gs` against a fake Sheet in memory, on
http://localhost:8080 (admin key `testkey12345`, test players in
`dev/seed.json`).
