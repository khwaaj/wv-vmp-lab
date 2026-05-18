// Copyright 2026 Castlabs, GmbH
// SPDX-License-Identifier: Apache-2.0

const {app, components, BrowserWindow, ipcMain} = require('electron');
const path = require('path');

ipcMain.handle('open-internal', async (e, url) => {
  try {
    const sender = BrowserWindow.fromWebContents(e.sender);
    const { x, y, width, height } = sender ? sender.getBounds() : { x: 0, y: 0, width: 1200, height: 900 };
    const win = new BrowserWindow({ width, height, x: x + 22, y: y + 22 });
    await win.loadURL(url);
    return win.id;
  } catch (err) {
    console.error('open-internal failed:', err.message);
    return null;
  }
});

app.whenReady().then(async () => {
  await components.whenReady();
  console.log('components ready:', components.status());
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadURL('https://localhost:8443/');
});
