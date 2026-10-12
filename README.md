<<<<<<< HEAD
# ClassWatch — Privacy-First Classroom Focus & Study System

ClassWatch is a lightweight, privacy-conscious classroom focus and digital study system designed for teachers and students. It enables teachers to maintain classroom focus without collecting personal data, recording screens, or logging keystrokes.

Students get a focused **Study Dashboard** with color-coded subject folders, digital study notes, and quick tab launching. Teachers get real-time awareness with **High (Social Media)** and **Medium (Off-Topic)** tiered alerts, audio/visual notifications, in-tab warning banners, and screen locking.

---

## 🔒 Privacy-First Guarantee

Unlike invasive screen-monitoring software:
- **Domains Only**: The teacher only sees website **domain names** (e.g. `wikipedia.org`, `khanacademy.org`) and which tab is currently active.
- **Zero Content Scraping**: ClassWatch **never** reads page titles, full URLs, page text, form inputs, search queries, passwords, camera, or mic data.
- **Banner Injection Only**: In-tab warning scripts only inject floating alert banners into the DOM—they never inspect or read the host page's contents.
- A permanent privacy notice is displayed in the student extension popup at all times.

---

## 📁 Repository Structure

```
ClassWatch/
├── README.md                 # System overview, setup, and architecture documentation
├── server/
│   ├── package.json          # Node dependencies ("ws")
│   ├── server.js             # Teacher HTTP & WebSocket server (port 3000)
│   ├── test.js               # 17 automated integration tests
│   ├── make_icon.js          # PNG icon generator
│   └── public/
│       └── index.html        # Teacher Dashboard (Plain HTML/CSS/JS)
└── extension/
    ├── manifest.json         # Manifest V3 (tabs, storage, notifications, alarms, scripting)
    ├── background.js         # Service Worker (debounced monitoring, in-tab banners, lock)
    ├── popup.html            # Extension popup with connection controls & dashboard launcher
    ├── popup.js              # Popup controller
    ├── dashboard.html        # Student Study Dashboard (new tab page)
    ├── dashboard.css         # Color-coded folder styling (light/dark mode)
    ├── dashboard.js          # Study folders, notes autosave, and "New Tab" search
    ├── lock.html             # Full-screen lock screen
    └── icon128.png           # Extension icon
```

---

## 🚀 Quick Start Guide

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or higher)
- Google Chrome or any Chromium-based browser (Brave, Edge, Opera, etc.)

---

### Step 1: Start the Teacher Server

1. Open your terminal in the `server/` directory:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   node server.js
   ```
4. The console prints:
   ```
   ==================================================
   ClassWatch Teacher Server Started
   Class Code:  4821
   Student WS:  ws://192.168.1.15:3000/student
   ws://192.168.1.15:3000
   Teacher URL: http://localhost:3000/?key=abcdef123456...
   ==================================================
   ```
5. Click or paste the **Teacher URL** in your browser.
   - Note: Visiting `http://localhost:3000/` without the `?key=...` returns **403 Forbidden**.

---

### Step 2: Install or Reload the Student Chrome Extension

1. In Google Chrome, navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top right.
3. Click **Load unpacked** and select the `ClassWatch/extension` directory.
4. If you have already loaded it, click the **Reload icon (🔄)** on the ClassWatch card to apply any updates.
5. Pin the **ClassWatch Student** extension to your Chrome toolbar.

---

### Step 3: Join a Class Session & Open Student Dashboard

1. Click the ClassWatch extension icon in the student browser.
2. Enter:
   - **Teacher Server**: `ws://<LAN-IP>:3000` (or `ws://localhost:3000` for testing)
   - **4-Digit Class Code**: Code printed on server start (e.g. `4821`)
   - **Student Name**: Your full name (e.g. `Maya Lin`)
3. Click **Join Class**.
4. The student extension connects and automatically opens the **Study Dashboard** in a new tab (or click **📖 Open My Study Dashboard** in the popup at any time).

---

## 📖 Student Study Dashboard (`dashboard.html`)

- **Top "New Tab" Bar**:
  - Type any web address (e.g. `wikipedia.org`) or search query and press **Enter** / click **Go**.
  - Opens in a new tab.
  - Helpful focus reminder: *"Sites outside your study folders may be flagged to your teacher."*
- **Color-Coded Subject Folders**:
  - 📐 **Maths** (Blue): Khan Academy, NCERT Maths, Desmos
  - 🔬 **Science** (Green): PhET Simulations, NCERT Science, Wikipedia
  - 📖 **English** (Amber): Wikipedia, Google Docs
  - 🌍 **Social Studies** (Purple): NCERT, Wikipedia
  - 🏛️ **Library** (Teal): Wikipedia, Khan Academy
- **Interactive Folder View**:
  - Click any folder to see its study resources.
  - Click a link to open it directly in a new tab.
  - Breadcrumb navigation (`Study Folders > Science`) and **Back** button.
- **"My Notes" per Subject**:
  - Each folder contains a personal digital notes area.
  - Automatically saved to `chrome.storage.local` as you type.
- **Light & Dark Theme**: Toggle button in header. Accessible keyboard navigation (`:focus-visible`).

---

## 🖥️ Teacher Dashboard & Monitoring Controls

- **Study Folders Editor**:
  - Add, edit, or remove folders and study links.
  - Click **Save & Push**: Updates push to student dashboards immediately.
  - **Rule**: Every domain in any study folder is automatically treated as allowed.
- **Allowed Domains List**:
  - Whitelist of additional approved domains (subdomains automatically allowed).
- **Social Media & Entertainment Detection List**:
  - Pre-populated with 16 top distraction sites: `instagram.com`, `facebook.com`, `tiktok.com`, `x.com`, `twitter.com`, `whatsapp.com`, `reddit.com`, `discord.com`, `netflix.com`, `primevideo.com`, etc.
  - Editable on the teacher screen with **Save & Push**.
- **Tiered Live Alerts**:
  - 🔴 **High Severity (Social Media)**: Triggered when a student opens a social or entertainment site. Shows red badge `[Social media]`.
  - 🟡 **Medium Severity (Off-Topic)**: Triggered when a student opens an unapproved site outside study materials. Shows amber badge `[Off-topic]`.
  - 🟢 **Acknowledgement**: Shows when a student clicks **"Got it"** on a warning banner.
  - 🚪 **Student Left**: Alerts when a student leaves the session.
  - **Deduplication**: Suppresses repeated alerts for the same student and domain within 60 seconds.
  - **Localhost Guard**: Server IP and `localhost` are never flagged.
- **Audio & Visual Alarms**:
  - **Soft Beep**: Synthesized Web Audio API tone plays when a new alert arrives (no external audio files needed).
  - **Mute Toggle**: Easily mute/unmute audio alerts via the header button (saved in localStorage).
  - **Tab Flashing**: Title flashes `(1) New alert - ClassWatch` when window is in background.
  - **4-Second Toast**: Brief notification toast displayed on incoming alerts.
- **Action Buttons**:
  - **⚠️ Warn**: Sends custom or preset warning banner to student.
  - **🔒 Lock Screen**: Locks student screen with full-screen focus overlay until unlocked.
  - **🔓 Unlock / Unlock All**: Restores student browsing.
  - **Dismiss / Dismiss All**: Clears alerts from feed.

---

## ⚠️ Student In-Tab Warning Banners

1. **Teacher Warning (Red Banner)**:
   - When the teacher presses **Send warning**, a high-priority red banner appears at the very top of the student's active tab:
     *"⚠️ Message from your teacher: <message>"*
   - Includes a **"Got it"** button.
   - When the student clicks **"Got it"**, the banner dismisses and sends an acknowledgement back to the teacher dashboard (`"<Name> acknowledged the warning"`).
   - Auto-dismisses after 30 seconds if unclicked.
   - Native Chrome notification is triggered as a backup.
2. **Off-Topic Notice (Amber Banner)**:
   - When a student's active tab is on an unapproved site, a discreet amber bar appears at the top:
     *"⚠️ This site is not on today's allowed list. Your teacher can see this."*
   - Automatically disappears when the student navigates back to an approved site.

---

## 🧪 Automated Integration Tests

Run the full suite of 17 integration tests:
```bash
cd server
npm test
```

### Verified Test Cases:
1. `GET /` without key returns `403 Forbidden`.
2. `GET /` with invalid key returns `403 Forbidden`.
3. `GET /` with valid key returns `200 OK` and dashboard HTML.
4. Teacher WebSocket connection receives `INIT` with study folders and social domains.
5. Wrong class code rejected (`INVALID_CODE`).
6. Valid join receives `studyFolders` and updates teacher dashboard.
7. Allowed domain & subdomains (e.g. `en.wikipedia.org`) pass validation.
8. Study folder domains (e.g. `desmos.com`) automatically treated as allowed.
9. `localhost` and server LAN IP never flagged.
10. Off-topic sites (e.g. `coolgames.com`) generate **MEDIUM** severity alerts.
11. Social media sites (e.g. `instagram.com`) generate **HIGH** severity alerts.
12. Alert deduplication within 60 seconds.
13. Study folder updates push to student browsers live.
14. Warning message delivery to student.
15. Student **"Got it"** warning acknowledgement delivered to teacher alert feed.
16. Screen lock and unlock enforcement.
17. Student leaving triggers teacher alert.

---

## 🔄 How to Reload Extension After Changes

1. Navigate to `chrome://extensions/` in Chrome.
2. Locate the **ClassWatch Student** card.
3. Click the **Reload icon (🔄)** in the lower right of the card.
4. Any changes to `manifest.json`, `background.js`, `popup.html`, `dashboard.html`, etc. take effect immediately.
=======
# classwatch
>>>>>>> 663f9151e3a2d72eabb929668a1bbd508a533cc6
