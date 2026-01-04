# Bibliac

**Scientific bibliography manager with multi-source search plugins**

[**Download**](https://github.com/yipihey/bibliac/releases/latest) | [**Website**](https://yipihey.github.io/bibliac/)

---

## What is Bibliac?

Bibliac is a desktop app for researchers who work with scientific papers. It connects to NASA ADS, arXiv, and INSPIRE HEP to search for papers, download PDFs, track references and citations, and manage your personal library—all in one place.

### Key Features

**Multi-Source Search**
- Search NASA ADS, arXiv, and INSPIRE HEP from a unified interface
- Natural language queries powered by AI (e.g., "papers about dark matter from 2023")
- View references and citations for any paper

**PDF Management**
- Download PDFs from arXiv, publishers, and ADS scans
- Keep multiple versions per paper (preprint + published)
- Highlight text and add notes directly in PDFs
- Configure library proxy for institutional access

**Library Organization**
- Organize papers into collections (folders)
- Track read status: unread, reading, read
- Rate papers: seminal, important, useful, meh
- Full-text search across your library

**BibTeX Export**
- Auto-generated master bibliography file
- Export selected papers to `.bib`
- Copy `\cite{}` or `\citep{}` with keyboard shortcuts

**iCloud Sync** (macOS)
- Sync your library across Mac devices
- Multiple libraries support

---

## Who is this for?

Bibliac is designed for:
- **Astronomers & Astrophysicists** who use NASA ADS daily
- **Particle Physicists** who rely on INSPIRE HEP
- **Researchers** who want arXiv preprints alongside published versions
- Anyone tired of managing PDFs in folders and browser bookmarks

---

## Requirements

- **macOS 12+** (Apple Silicon and Intel supported)
- **NASA ADS API key** (free, get one at [ui.adsabs.harvard.edu](https://ui.adsabs.harvard.edu/user/settings/token))

---

## Installation

1. Download the latest `.dmg` from [Releases](https://github.com/yipihey/bibliac/releases/latest)
2. Open the DMG and drag Bibliac to Applications
3. Launch Bibliac and enter your ADS API token in Preferences

> **Note**: On first launch, macOS may warn about an unidentified developer. Right-click the app and select "Open" to bypass Gatekeeper.

---

## Screenshots

*Coming soon*

---

## Building from Source

```bash
# Clone the repository
git clone https://github.com/yipihey/bibliac.git
cd bibliac

# Install dependencies
npm install

# Run in development mode
npm start

# Build distributable
npm run make
```

---

## Feedback & Issues

- Report bugs or request features on [GitHub Issues](https://github.com/yipihey/bibliac/issues)
- Email: bibliac@tomabel.org

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Bibliac</strong> — Your papers, beautifully organized.
</p>
