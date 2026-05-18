// Copyright 2026 Castlabs, GmbH
// SPDX-License-Identifier: Apache-2.0

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openInternal', (url) => {
  return ipcRenderer.invoke('open-internal', url);
});
