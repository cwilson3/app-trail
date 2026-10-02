<!-- markdownlint-configure-file {
  "MD033": false
} -->

# AppTrail

<div align="center">

  [![Version](https://img.shields.io/static/v1?label=AppTrail&message=v0.9.3-beta&labelColor=1abba9&color=f4f4f4&style=flat)](#apptrail)
  [![Playwright Version](https://img.shields.io/badge/Playwright-1.63.0-brightgreen.svg?logo=playwright)](https://playwright.dev/docs/intro)
  [![TypeScript Version](https://img.shields.io/badge/TypeScript-7.0.2-blue.svg?logo=typescript)](https://www.typescriptlang.org/)

  [About](#about) •
  [Getting Started](#getting-started) •
  [Your Data](#where-your-data-lives) •
  [Files](#files) •
  [Sending the table to Notes](#sending-the-table-to-notes) •
  [Testing](#testing) •
  [Adding a job from its URL](#adding-a-job-from-its-url) •
  [Single File, Two writers](#single-file-two-writers) •
  [The table](#the-table) •
  [Themes](#themes) •
  [The detail card](#the-detail-card) •
  [Data format](#data-format) •
  [License](#license)

</div>

## About

As my brother said "So you made a clickable nerd web page thing instead of a spreadsheet to track the job applications?" Yes. Yes I did. AppTrail is a lightweight single-page job application tracker. One HTML file, no build step, and no dependencies outside of testing tools. Your data lives in a folder of its own, outside the repository (see [Where your data lives](#where-your-data-lives)).

## Getting Started

### Prerequisites

Install Node.js 24 from [nodejs.org](https://nodejs.org/en/) (the version `package.json` pins under `engines`).

### Clone Repo

Clone the repo into `~/src` using https or ssh, then change into it:

```sh
git clone https://github.com/cwilson3/app-trail.git ~/src/app-trail
cd ~/src/app-trail
```

### Install Dependencies

The app itself has no dependencies and no build step, so there is nothing to
install to run it. The packages in `package.json` are only needed for the unit
tests and type checks (see [Testing](#testing)):

```sh
npm install
```

### Start the App

Start the local backend (recommended) — every edit is written straight to your `data.json`:

```sh
npm start
```

Then open [http://localhost:8787](http://localhost:8787) in a browser. To use a
different port, pass it after `--`:

```sh
npm start -- 9000
```

`server.js` is plain Node (no packages to install) and binds to `127.0.0.1` only.
It serves the app from `src/` and your data from the data folder, and
accepts `PUT /data/data.json` from the page. Saves are atomic and the previous
file is kept as `data.json.bak`. The data folder is created on first run if it
isn't there, and the server prints its path when it starts.

### Optional: Choose the Note

You can set a note in your Apple Notes app to update with a table containing the current table from the Tracker section of the page. To pick which Apple Note the **Note** button writes to, copy the example config
into your data folder and edit its `title` (macOS path shown — see
[Where your data lives](#where-your-data-lives) for other systems):

```sh
cp config.example.json ~/Library/Application\ Support/app-trail/config.json
```

### Try It on Test Data

To try the app on one of the Playwright suite's datasets without touching your
own tracker, run one of these and open [http://localhost:8789](http://localhost:8789):

```sh
npm run demo:fellowship     # 25 applications
npm run demo:homestar       # 13 applications
```

Each run starts from a fresh copy in `.demo-data/<name>/`, so edits are thrown away next time.

### Without the Server

Open `src/index.html` directly in a browser:

```sh
open src/index.html         # macOS; on Linux use xdg-open
```

It still works fully; edits are kept in that browser's local storage, and in
Chrome/Edge/Opera **Actions → Open** links the page to a JSON file on disk so
**Save** writes back to it. **Export** always writes a JSON copy you can back up
or move to another machine.

### Verify Setup

Confirm everything is in place by running the unit tests:

```sh
npm test
```

## Where your data lives

Everything the app stores — `data.json`, its `.bak`, the import log,
`config.json` and the saved job descriptions in `jds/` — lives in one folder
outside the repository:

| System | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/app-trail/` |
| Windows | `%APPDATA%\app-trail\` |
| Linux and others | `$XDG_DATA_HOME/app-trail/`, else `~/.local/share/app-trail/` |

Set `APP_TRAIL_DATA_DIR` to use a different folder — somewhere synced like
Dropbox, say. Set it where both the server and Claude Code will see it (your
shell profile), since the `/job-from-url` importer looks the folder up the same
way and only writes through a server using the same `data.json`.

Keeping it out of the repository means none of it can be committed by accident,
`git clean` can't delete it, and every clone and worktree sees the same tracker.
`paths.js` is the one place that decides the folder; `server.js` and the
importer both ask it.

**Upgrading from a checkout that kept data in the repository.** The first time
the default folder is used, it copies `data/*`, `config.json` and `jds/` across
from the repository and says so. It only copies — the old files are left where
they were, now gitignored and unused, for you to delete once you're happy — and
it never replaces a file already in the new folder. A folder set with
`APP_TRAIL_DATA_DIR` is never seeded this way.

**Backups.** Git no longer keeps your tracker's history. If you want that back,
make the data folder its own private git repository, or point
`APP_TRAIL_DATA_DIR` at a synced folder. **Export** writes a JSON copy any time.

## Files

| File | What it is |
| --- | --- |
| `src/index.html` | The whole app — markup, styles, and logic |
| `src/server.js` | Small static server + the `data.json` read/write endpoint. `createApp()` builds the request handler; running the file listens |
| `src/routes.js` | Every route the server answers, and the methods each takes — the table `spec.yml` documents |
| `src/store.js` | Reading and writing a tracker file: the ETag, the backup, the temporary file renamed into place. The server and the importer both save through it |
| `src/note.js` | The Note button's server side: the table's limits, the note's HTML, and running `osascript` |
| `src/paths.js` | Where the data folder is, and the one-time copy out of older checkouts |
| `spec.yml` | The server's HTTP contract (OpenAPI 3.1) |
| `examples/data.sample.json` | Three example applications; import it (**Actions → Import**) to see the app populated |
| `config.example.json` | A starting `config.json` — copy it into your data folder to choose the note **Note** writes to |
| `src/jd-name.js` | How a job description's file is named — loaded by the page and by `/job-from-url`, so both agree |
| `src/*.test.js` | Unit tests (`npm test`), each beside the code it covers; `src/test-support/` holds the page loader they share |
| `package.json` | Test tooling only — the app itself still has no dependencies |
| `.claude/skills/job-from-url/` | The `/job-from-url` skill — adds an application from a posting's URL |
| `.claude/agents/job-extract.md` | The sandboxed reader that skill uses |

## Sending the table to Notes

**Note** writes the rows the table is currently showing into a single note in
the macOS Notes app — the same rows, in the same order, after whatever filter
and sort are in effect, with six of the columns:

> Company · Role Title · Status · Interest · Round · Last Update

It writes one note and keeps writing to that same one, so pressing **Note**
again refreshes it in place rather than leaving you with a pile of exports.
Which note that is lives in `config.json` in your data folder
(`config.example.json` in the repository is a starting point):

```json
{
  "note": {
    "title": "JS-2026",
    "folder": ""
  }
}
```

`title` is the note's title — it is created on the first export if it does not
exist yet. `folder` is the Notes folder to keep it in; leave it empty for the
default folder, or name one and it will be created if missing. The file is read
on every export, so changing it does not need a restart. Delete the file and the
built-in default (`JS-2026`, default folder) applies.

Notes can only be driven from the machine it runs on, so this goes through
`server.js`, which hands the table to `osascript`. The title, the folder and the
table all travel as `execFile` arguments rather than as text spliced into a
script, so no cell can turn into AppleScript. macOS will ask once for permission
for the terminal to control Notes; if you decline, the button says so and you
can grant it later under **System Settings → Privacy & Security → Automation**.

Opened without the server there is nothing to call, so **Note** copies the same
table to the clipboard instead, ready to paste into the note yourself.

## Testing

Unit, type checks and API tests run on every PR. Running locally is possible as well. To run unit tests locally from the root directory run the following commands after installing dependencies (`npm install`):

```sh
npm test        # or npm run test:watch
```

To run the API tests locally, install the Playwright project's own dependencies and run its `api` project from `app-trail-playwright/`:

```sh
cd app-trail-playwright
npm install
npm run test:api     # npm run report opens the last HTML report
```

The API tests make HTTP calls only, so no browsers need installing for them.
Playwright starts the server itself on port 8788 (override with `APP_TRAIL_PORT`)
with a throwaway data folder in `.test-run/`, so your own tracker is never touched.
See [`app-trail-playwright/README.md`](app-trail-playwright/README.md) for the E2E and page-load suites.

The server-side modules are tested directly: `server.test.js` builds the
request handler with `createApp()` over an in-memory filesystem, so no port is
opened and nothing touches the disk.

## Adding a job from its URL

With Claude Code in this directory, `/job-from-url <url>` reads a posting and
fills in the row for you — company, role title, posted date, posted salary
range, role type, industry, the job link and the system of record. It saves the
posting itself alongside the row, as a markdown file under `jds/` in your data
folder. It reports
what it wrote; `--dry-run` on either script shows the same thing without
writing.

It leaves the parts that are yours alone: status, applied date, the range you
gave them, rounds and contacts are never auto-filled.

A job posting is a web page written by a stranger, so the skill is built so
that the stranger can fill in a table cell without also being able to give
instructions:

- **Structured sources first.** Greenhouse, Lever, Ashby, Workday and
  SmartRecruiters are read through their own APIs, and anything else through
  the `schema.org/JobPosting` markup in the page. In the common case no model
  reads the posting at all.
- **The part that reads can't write.** When the markup comes up short, the
  prose goes to a subagent with no shell, no network and no access to
  `data.json`. It returns field values and nothing else.
- **Everything is validated on the way in**, against an allow-list of the
  eight fields a posting is allowed to touch. Dates must be real and recent,
  salaries must be plausible annual USD, links must be `http(s)`, and anything
  over-long is dropped rather than trimmed. `Job Link` is the URL you supplied
  and `System of Record` comes from its hostname, so neither can be redirected
  by the page.
- **Nothing is written twice.** A URL already in the table is reported instead
  of re-added, and an update fills blanks without overwriting what you typed.

Each write appends a line to `data.import.log.jsonl` — what was written, what
was rejected, and where it came from.

### The saved job description

Postings get taken down and quietly reworded, and a job link is no use six
weeks later once it 404s. So the import also writes
`jds/<company>-<role>.md` — the posting's own words, converted to markdown.

- **Structure survives.** Boards publish descriptions as HTML, so `<h2>`
  becomes `##` and `<li>` becomes `-` rather than flattening into a wall of
  paragraphs. Where only flat text is available the headings are inferred back,
  conservatively.
- **Sections are named consistently where they can be.** "You may be a good
  fit if you have" files as *Minimum Qualifications*; a heading that matches
  nothing keeps the posting's own wording. Postings don't agree on which
  sections they have, and the file doesn't pretend otherwise — it has the
  sections that posting had.
- **The file is yours after that.** An existing file is never replaced without
  `--force`, so notes you add to a JD survive a re-import.
- `jds/` lives in your data folder, so these files stay on the machine that
  fetched them and never reach the repository.

The **Load JD** button on the detail card reads the file back. Nothing in
`data.json` points at it — the page derives the same `<company>-<role>` name
from the row it has open, and asks the server which files exist so a renamed
company or role still finds its posting. Open the file itself with the button
beside it.

A job imported while the tracker is open shows up in the table on its own — the
server tells the page, and the page merges it in without disturbing whatever
you were editing. See below: [Single file, Two writers](#single-file-two-writers).

## Single file, Two writers

Two things write `data.json`: the page you have open, and the importer. Neither
can see the other, and the page holds the whole document in memory — so without
some care, whichever saves last silently erases the other's work.

The server arbitrates, using a hash of the file as an ETag:

- `GET /data/data.json` hands back the current ETag.
- `PUT /data/data.json` must carry it in `If-Match`. If the file has moved on since
  the writer last read it, the write is refused with `409` and the current
  document, rather than being allowed to overwrite. (`If-Match: *` forces it.)
- Every change is announced on `GET /api/events`. That includes changes made
  straight to the file on disk — the server watches the data folder — so
  editing `data.json` in a text editor shows up in the page too.

The page listens on that stream and folds new rows in as they arrive. Rows you
have touched since your last save outrank the copy on disk; everything else
comes from the file. If a change lands while you are typing, it waits until you
leave the field, so a merge never rebuilds the form under your cursor.

The result is that an import lands in an open table on its own, with no reload
and nothing lost in either direction.

## The table

One row per application, sorted by company (click any heading to re-sort, click any row
to open its detail card).

| Column | Meaning |
| --- | --- |
| # | Row number in the current sort order |
| Company | Company name |
| Posted | Date the role was posted, when the listing shows one |
| Applied | Date you applied |
| Status | Overall status — Ready, Applied - Awaiting Response, Interview, Offer, Rejected, Closed, … (*Closed* = the posting came down or the role is no longer available) |
| Interest | How much you want the role — High, Moderate or Low (blank until you set it) |
| Last Update | Date of the most recent change (set automatically) |
| Round | Number of the current active round — the latest round whose end state is still *Pending* |
| Await | Date you're expecting a response by |
| Applied Via | Portal, referral, email, … |
| Role Title | The job title |
| Company Type | Startup, enterprise, nonprofit, … |
| Industry | The company's industry |
| Posted Range | Salary range posted with the role |
| My Range | The range you gave them |

### Filtering

**Filter** in the toolbar opens a panel with one column per field you can filter
on — Company, Status and Interest. Ticking nothing in a column means "any"; the
count beside each value is how many applications carry it. A row has to match
every column that has something ticked.

The table opens filtered to work still in play: every status except *Accepted*,
*Rejected*, *Withdrawn*, *Ghosted* and *Closed*. **Reset to default** puts that
back, **Clear all** shows everything, and the badge on the button counts the
columns currently narrowing the table. The subtitle reads "12 of 13
applications" whenever something is hidden.

Your filter is remembered in the browser, like the theme and width settings.
Adding an application clears any filter that would have hidden the new blank
row, so it never disappears the moment you create it.

## Themes

The gear in the lower-right corner opens Settings, which holds the content-width
toggle and the theme picker. Thirteen themes ship, each a full palette rather
than a light/dark pair — picking one is picking a palette, there is no
OS-following mode:

| | | |
| --- | --- | --- |
| **Light** — the default, near-white | **Dark** — neutral charcoal | **Joey** — neon on near-black |
| **Retro** — arcade cyan on violet | **Retro 2** — Joey's neon on a vaporwave ground | **Ginkgo** — gold on dark olive |
| **Win98** — grey plastic and teal | **WinXP** — Luna tan, blue and olive | **Phosphor** — a green CRT |
| **J** — ultramarine under crimson | **J2** — cocoa and purple | **Sea** — deep water, pale surf |
| **Urban** — warm charcoal and teal | | |

All but Light, Dark and Joey mirror the palettes of the same name in the Ginkgo
app, so a theme you like there looks the same here. Every palette clears WCAG AA
(4.5:1) for body text, the muted labels and the status pills.

Your choice is remembered in the browser, and the favicon follows it so the tab
is recognisable against the browser's own chrome.

## The detail card

- **Application Details** — Posted, Applied, Await, Status, **Interest**, Applied Via, **Job Link** and
  **System of Record** (where the application lives — Workday, Greenhouse, the company
  portal, …).
- **Company Details** — Company Name, Role Title, Company Type, Industry, Role Type,
  **Work Setting** (Remote, Hybrid or On-Site) and **Company Website**.
- **Salary** — Posted Role Range, **Adjusted for local market** (the posted range
  restated for where you live) and My Range Given. Each is two dollar fields; type `125k` or `125000` and
  they reformat to `$125,000`, and the table shows a pair as `$125,000-$145,000`.

  Between them these hold everything the table leaves out — the application **ID**, Role Type,
  Work Setting, System of Record, the local-market range, and both links, each with a button that
  opens the address in a new tab. **Job Link** also has a copy button, so the URL goes to the
  clipboard without selecting it by hand.
- **Local Job Description** — collapsed until you ask for it. **Load JD** pulls in
  `jds/<company>-<role>.md` from your data folder, the posting as saved by `/job-from-url`, and renders it in
  place. Press again to hide it; the button next to it opens the file in a new tab. Needs
  `server.js` running, since the file is read off disk.
- **Interview Rounds** — collapsible; each round has a type (Screen, Interview 1–5, Final,
  Take-home, Offer Call, Other), a status (Scheduled, In Progress, Completed, Cancelled,
  No Show) and an end state (Pending, Moved Forward, Rejected, Withdrawn, Offer, Expired,
  No Response).
- **Contacts** — each round holds any number of people, with contact details, result,
  notes and end info.

Edits save automatically. `Esc` closes any open card.

## Data format

```jsonc
{
  "version": 1,
  "savedAt": "2026-09-03T…",       // stamped on every save
  "applications": [
    {
      "id": "…", "num": 1,
      "company": "", "postedOn": "", "appliedOn": "", "lastUpdate": "", "status": "Ready",
      "interest": "",                                // "High" | "Moderate" | "Low" | ""
      "awaiting": "", "appliedVia": "", "roleTitle": "", "companyType": "",
      "industry": "", "roleType": "",
      "workSetting": "",                             // "Remote" | "Hybrid" | "On-Site" | ""
      "postedRange": { "min": null, "max": null },   // all three ranges are
      "localRange":  { "min": null, "max": null },   // a low and a high number
      "myRange":     { "min": null, "max": null },
      "jobLink": "", "companyWebsite": "", "systemOfRecord": "",
      "rounds": [
        { "id": "…", "type": "Screen",
          "date": "", "time": "",                    // YYYY-MM-DD and HH:MM
          "status": "Scheduled", "end": "Pending", "notes": "",
          "people": [ { "id": "…", "firstContact": "", "contactType": "Email",
                        "name": "", "role": "", "email": "", "phone": "",
                        "result": "", "note": "",
                        "endDate": "", "endType": "Pending", "endNotes": "" } ] }
      ]
    }
  ]
}
```

`data.json` is safe to hand-edit — the page normalises anything it loads, so missing
fields and unknown values fall back to sane defaults instead of breaking the UI.

## License

[MIT](LICENSE)
