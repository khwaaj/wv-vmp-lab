// Copyright 2026 Castlabs, GmbH
// SPDX-License-Identifier: Apache-2.0

const {app, components, BrowserWindow, ipcMain, session} = require('electron');
const path = require('path');

const CSP = "default-src 'self' https: blob: data: 'unsafe-inline'; connect-src *; media-src blob: *; worker-src blob:;";

ipcMain.handle('open-internal', async (e, url) => {
  const sender = BrowserWindow.fromWebContents(e.sender);
  const { x, y, width, height } = sender ? sender.getBounds() : { x: 0, y: 0, width: 1200, height: 900 };
  const win = new BrowserWindow({ width, height, x: x + 22, y: y + 22, show: false });
  try {
    await win.loadURL(url);
    win.show();
    return win.id;
  } catch (err) {
    win.destroy();
    return null;
  }
});

function createApp(url) {
  app.whenReady().then(async () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP],
        },
      });
    });

    await components.whenReady();
    console.log('components ready:', components.status());
    const mainWindow = new BrowserWindow({
      width: 1200,
      height: 900,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    mainWindow.loadURL(url);
  });
}

module.exports = { createApp };
