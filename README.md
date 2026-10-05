<p align="center">
  <img src="assets/logo-256.png" width="96" alt="TTT Client logo" style="image-rendering: pixelated">
</p>

<h1 align="center">TTT Client</h1>

<p align="center">A custom Minecraft: Java Edition launcher made by <b>tatnat</b>.<br>
<a href="https://www.youtube.com/@tatnatmc">youtube.com/@tatnatmc</a></p>

## Download

Get the latest version from the **[Releases page](../../releases/latest)**:

- **TTT-Client-Setup-x.y.z.exe** — installer (adds desktop + Start menu shortcuts)
- **TTT-Client-Portable-x.y.z.exe** — single file, no install needed

Windows only (64-bit). The exe isn't code-signed, so Windows may show
"Windows protected your PC" the first time — click **More info → Run anyway**.

## Features

- **Microsoft login** — play online with your own account and skin
- **Every version** — releases, snapshots, beta, alpha and classic
- **No Java needed** — the right Java version is downloaded from Mojang automatically
- **Mods** — search Modrinth and install Fabric mods in one click (dependencies included)
- **Discord status** — shows what you're playing in Discord
- Separate game folder, so it never touches the official launcher's `.minecraft`

## Build it yourself

Requires [Node.js](https://nodejs.org/) 20+.

```bash
npm install
npm start        # run the launcher
npm run dist     # build the Windows installer + portable exe into dist/
```

---

TTT Client is not affiliated with Mojang Studios or Microsoft.
