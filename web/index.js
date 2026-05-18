// Copyright 2026 Castlabs, GmbH
// SPDX-License-Identifier: Apache-2.0

// =========================
// Protobuf parsing
// =========================

function readVarint(view, offset) {
  let result = 0, shift = 0, pos = offset;

  while (true) {
    const byte = view.getUint8(pos);
    result |= (byte & 0x7F) << shift;
    pos++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return { value: result, length: pos - offset };
}

function extractFieldRaw(buffer, path, depth = 0) {
  const view = new DataView(buffer);
  let offset = 0;

  while (offset < buffer.byteLength) {
    const tagInfo = readVarint(view, offset);
    const tag = tagInfo.value;
    offset += tagInfo.length;

    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;

    if (wireType === 0) {
      const valInfo = readVarint(view, offset);
      offset += valInfo.length;

      if (fieldNumber === path[depth] && depth === path.length - 1) {
        return { wireType, value: valInfo.value };
      }

    } else if (wireType === 2) {
      const lenInfo = readVarint(view, offset);
      offset += lenInfo.length;

      const length = lenInfo.value;
      const subBuffer = buffer.slice(offset, offset + length);
      offset += length;

      if (fieldNumber === path[depth]) {
        if (depth === path.length - 1) {
          return { wireType, value: new Uint8Array(subBuffer) };
        } else {
          const res = extractFieldRaw(subBuffer, path, depth + 1);
          if (res) return res;
        }
      }

    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 1) {
      offset += 8;
    } else {
      break;
    }
  }

  return null;
}

function extractInt(buffer, path) {
  const res = extractFieldRaw(buffer, path);
  return res?.wireType === 0 ? res.value : null;
}

// =========================
// Enum translation
// =========================

const MessageType = {
  1: "LICENSE_REQUEST",
  2: "LICENSE",
  3: "ERROR_RESPONSE",
  4: "SERVICE_CERTIFICATE_REQUEST",
  5: "SERVICE_CERTIFICATE",
};

const PlatformVerificationStatus = {
  0: "PLATFORM_UNVERIFIED",
  1: "PLATFORM_TAMPERED",
  2: "PLATFORM_SOFTWARE_VERIFIED",
  3: "PLATFORM_HARDWARE_VERIFIED",
  4: "PLATFORM_NO_VERIFICATION",
  5: "PLATFORM_SECURE_STORAGE_SOFTWARE_VERIFIED"
};

function enumToString(enumObj, value, defaultLabel="UNKNOWN") {
  return enumObj[value] ?? `${defaultLabel}(${value})`;
}

function buildReverseMap(enumObj) {
  const map = {};
  for (const [key, val] of Object.entries(enumObj)) {
    map[val] = key;
  }
  return map;
}

const ERROR_CATEGORY = buildReverseMap(shaka.util.Error.Category);
const ERROR_CODE = buildReverseMap(shaka.util.Error.Code);

// =========================
// Environment status
// =========================

function setStatus(id, type, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'stat-value ' + type;
}

async function checkKeySystem(config) {
  if (!navigator.requestMediaKeySystemAccess) return false;
  try {
    await navigator.requestMediaKeySystemAccess('com.widevine.alpha', config);
    return true;
  } catch {
    return false;
  }
}

async function detectBrowser() {
  const ua = navigator.userAgent;
  const chromiumMatch = ua.match(/Chrome\/([\d.]+)/);
  const chromiumVersion = chromiumMatch?.[1];

  // Electron is never in userAgentData — detect from UA string first
  const electronMatch = ua.match(/Electron\/([\d.]+)/);
  if (electronMatch) {
    return {
      primary: `Electron ${electronMatch[1]}`,
      secondary: chromiumVersion ? `Chromium ${chromiumVersion}` : null,
    };
  }

  // userAgentData gives structured brand info for Chromium-based browsers
  if (navigator.userAgentData) {
    try {
      const hints = await navigator.userAgentData.getHighEntropyValues(['fullVersionList']);
      const brands = hints.fullVersionList.filter(b => !b.brand.includes('Not'));
      const specific = brands.find(b => b.brand !== 'Chromium');
      const chromium = brands.find(b => b.brand === 'Chromium');
      if (specific) {
        // Google Chrome IS Chromium — no secondary line needed
        if (specific.brand === 'Google Chrome') return { primary: `Google Chrome ${specific.version}`, secondary: null };
        return {
          primary: `${specific.brand} ${specific.version}`,
          secondary: chromiumVersion ? `Chromium ${chromiumVersion}` : null,
        };
      }
      if (chromium) return { primary: `Chromium ${chromium.version}`, secondary: null };
    } catch {}
  }

  // UA string fallback for Firefox-based, Safari, and anything else
  if (/Firefox\//.test(ua)) return { primary: 'Firefox ' + ua.match(/Firefox\/([\d.]+)/)[1], secondary: null };
  if (/Version\/.+Safari\//.test(ua)) return { primary: 'Safari ' + ua.match(/Version\/([\d.]+)/)[1], secondary: null };
  if (chromiumVersion) return { primary: `Chromium ${chromiumVersion}`, secondary: null };
  return null;
}

async function checkStatus() {
  // User-Agent
  document.getElementById('stat-ua').textContent = navigator.userAgent;

  const browser = await detectBrowser();
  const browserEl = document.getElementById('stat-browser');
  const engineEl = document.getElementById('stat-browser-engine');
  browserEl.textContent = browser?.primary ?? 'Unknown';
  browserEl.className = 'stat-browser ' + (browser ? 'ok' : 'na');
  engineEl.textContent = browser?.secondary ?? '';

  // Widevine key system availability
  if (!navigator.requestMediaKeySystemAccess) {
    setStatus('stat-ks', 'error', 'EME not supported');
    ['stat-h264', 'stat-vp8', 'stat-vp9', 'stat-hevc', 'stat-av1',
     'stat-aac', 'stat-vorbis', 'stat-flac', 'stat-opus', 'stat-ac3', 'stat-eac3',
     'stat-cenc', 'stat-cbcs', 'stat-sess-temporary', 'stat-sess-persistent'].forEach(
      id => setStatus(id, 'na', '—')
    );
  } else {
    const ksOk = await checkKeySystem([{
      initDataTypes: ['cenc'],
      videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
    }]);
    setStatus('stat-ks', ksOk ? 'ok' : 'error', ksOk ? 'Available' : 'Not available');

    // Video and audio codec checks, encryption schemes, session types (run in parallel)
    const videoCodecs = [
      { id: 'stat-h264', contentType: 'video/mp4; codecs="avc1.42E01E"' },
      { id: 'stat-vp8', contentType: 'video/webm; codecs="vp8"' },
      { id: 'stat-vp9', contentType: 'video/webm; codecs="vp9"' },
      { id: 'stat-hevc', contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
      { id: 'stat-av1', contentType: 'video/webm; codecs="av01.0.05M.08"' },
    ];
    const audioCodecs = [
      { id: 'stat-aac', contentType: 'audio/mp4; codecs="mp4a.40.2"' },
      { id: 'stat-vorbis', contentType: 'audio/webm; codecs="vorbis"' },
      { id: 'stat-flac', contentType: 'audio/mp4; codecs="flac"' },
      { id: 'stat-opus', contentType: 'audio/webm; codecs="opus"' },
      { id: 'stat-ac3', contentType: 'audio/mp4; codecs="ac-3"' },
      { id: 'stat-eac3', contentType: 'audio/mp4; codecs="ec-3"' },
    ];
    const encSchemes = [
      { id: 'stat-cenc', scheme: 'cenc' },
      { id: 'stat-cbcs', scheme: 'cbcs' },
    ];
    const sessTypes = [
      { id: 'stat-sess-temporary', sessionType: 'temporary' },
      { id: 'stat-sess-persistent', sessionType: 'persistent-license' },
    ];
    await Promise.all([
      ...videoCodecs.map(({ id, contentType }) =>
        checkKeySystem([{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType }] }])
          .then(ok => setStatus(id, ok ? 'ok' : 'error', ok ? '✓' : '✗'))
      ),
      ...audioCodecs.map(({ id, contentType }) =>
        checkKeySystem([{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType }] }])
          .then(ok => setStatus(id, ok ? 'ok' : 'error', ok ? '✓' : '✗'))
      ),
      ...encSchemes.map(({ id, scheme }) =>
        checkKeySystem([{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', encryptionScheme: scheme }] }])
          .then(ok => setStatus(id, ok ? 'ok' : 'error', ok ? '✓' : '✗'))
      ),
      ...sessTypes.map(({ id, sessionType }) =>
        checkKeySystem([{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }], sessionTypes: [sessionType] }])
          .then(ok => setStatus(id, ok ? 'ok' : 'error', ok ? '✓' : '✗'))
      ),
    ]);
  }

  // Show Chrome-only links when the chrome:// scheme is available
  if (typeof window.chrome !== 'undefined') {
    document.getElementById('chrome-links').style.display = '';
  }
  // Show Firefox links when running in Firefox
  if (browser?.primary?.startsWith('Firefox')) {
    document.getElementById('firefox-links').style.display = '';
  }
}

checkStatus();

document.querySelectorAll('.browser-links').forEach(el => {
  el.addEventListener('click', async () => {
    const url = el.dataset.url;
    const feedback = el.querySelector('.copy-feedback');
    try {
      await navigator.clipboard.writeText(url);
      feedback.textContent = '✓ Copied!';
      setTimeout(() => { feedback.textContent = ''; }, 1500);
    } catch {
      feedback.textContent = 'Copy failed';
      setTimeout(() => { feedback.textContent = ''; }, 1500);
    }
  });
});

// =========================
// Logging
// =========================

const logBox = document.getElementById('logBox');

function clearLog() {
  console.log("---");
  logBox.textContent = "";
}

function log(...args) {
  console.log(...args);
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  logBox.textContent += msg + "\n";
}

function logError(e) {
  if (e instanceof shaka.util.Error) {
    const category = ERROR_CATEGORY[e.category] || e.category;
    const code = ERROR_CODE[e.code] || e.code;
    e.message = `Shaka Error ${category}.${code}`;
  }
  console.error("Error:", e);
  const log_e = Object.assign(Object.create(e), e);
  log_e.stack = undefined;
  log_e.data = undefined;
  logBox.textContent += "Error: " + log_e + "\n";
}

// =========================
// Report
// =========================

const downloadReportBtn = document.getElementById('downloadReportBtn');

function buildReport() {
  const g = id => document.getElementById(id)?.textContent.trim() ?? '—';
  const codecRow = (label, id) => `| ${label.padEnd(6)} | ${g(id).padEnd(6)} |`;
  const sessRow = (label, id) => `| ${label.padEnd(10)} | ${g(id).padEnd(6)} |`;
  const now = new Date();
  const ts = now.toISOString().slice(0, 16).replace('T', ' ');

  const engine = g('stat-browser-engine');
  const browserSection = [
    `## Browser`,
    g('stat-browser'),
    engine ? engine : null,
    ``,
    `User-Agent: ${g('stat-ua')}`,
  ].filter(l => l !== null).join('\n');

  return [
    `# Widevine VMP Lab Report`,
    `Generated: ${ts}`,
    ``,
    browserSection,
    ``,
    `## Widevine`,
    `Key system: ${g('stat-ks')}`,
    ``,
    `## Video Codecs`,
    `| Codec  | Status |`,
    `|--------|--------|`,
    codecRow('H.264', 'stat-h264'),
    codecRow('VP8', 'stat-vp8'),
    codecRow('VP9', 'stat-vp9'),
    codecRow('HEVC', 'stat-hevc'),
    codecRow('AV1', 'stat-av1'),
    ``,
    `## Audio Codecs`,
    `| Codec  | Status |`,
    `|--------|--------|`,
    codecRow('AAC', 'stat-aac'),
    codecRow('Vorbis', 'stat-vorbis'),
    codecRow('FLAC', 'stat-flac'),
    codecRow('Opus', 'stat-opus'),
    codecRow('AC-3', 'stat-ac3'),
    codecRow('EAC-3', 'stat-eac3'),
    ``,
    `## Encryption Schemes`,
    `| Scheme | Status |`,
    `|--------|--------|`,
    codecRow('CENC', 'stat-cenc'),
    codecRow('CBCS', 'stat-cbcs'),
    ``,
    `## Session Types`,
    `| Type       | Status |`,
    `|------------|--------|`,
    sessRow('Temporary', 'stat-sess-temporary'),
    sessRow('Persistent', 'stat-sess-persistent'),
    ``,
    ...(logBox.textContent.trim() ? [
      `## Log`,
      `\`\`\``,
      logBox.textContent.trim(),
      `\`\`\``,
      ``,
    ] : []),
  ].join('\n');
}

function createReportBlob() {
  return new Blob([buildReport()], { type: 'text/plain;charset=utf-8' });
}

downloadReportBtn.addEventListener('click', (e) => {
  const url = URL.createObjectURL(createReportBlob());
  if (e.altKey) {
    window.open(url, '_blank');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = `wvlab-report-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

// =========================
// Player and content logic
// =========================

let player = null;

document.getElementById('loadContentBtn').onclick = async () => {
  const contentSelect = document.getElementById('contentSelect').selectedOptions[0];
  const backendSelect = document.getElementById('backendSelect').selectedOptions[0];
  const video = document.getElementById('video');

  clearLog();
  log(`Loading content: ${contentSelect.text}, using backend: ${backendSelect.text}`);

  shaka.polyfill.installAll();

  try {
    if (player) {
      await player.destroy();
      player = null;
    }
    player = new shaka.Player();

    player.addEventListener('error', (e) => {
      logError(e.detail);
    });

    const net = player.getNetworkingEngine();
    let uaChecked = false;
    net.registerRequestFilter((type, request) => {
      if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
        if (!uaChecked) {
          uaChecked = true;
          const requestUA = request.headers['User-Agent'] || request.headers['user-agent'];
          if (requestUA && requestUA !== navigator.userAgent) {
            log("!! Request UA differs from navigator UA:");
            log("!!   Request:   ", requestUA);
            log("!!   Navigator: ", navigator.userAgent);
          }
        }
        const message_type = extractInt(request.body, [1]);
        const message_type_str = enumToString(MessageType, message_type);
        if (message_type === 1) {
          const versionField = extractFieldRaw(request.body, [2, 9]);
          const version = versionField?.wireType === 2
            ? new TextDecoder().decode(versionField.value)
            : null;
          log(">>", message_type_str, version ? `| CDM ${version}` : '');
        } else {
          log(">>", message_type_str);
        }
      }
    });
    net.registerResponseFilter((type, response) => {
      if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
        const message_type = extractInt(response.data, [1]);
        const message_type_str = enumToString(MessageType, message_type);
        if (message_type === 2) {
          const value = extractInt(response.data, [2, 10]);
          log("<<", message_type_str, "|", enumToString(PlatformVerificationStatus, value));
        } else {
          log("<<", message_type_str);
        }
      }
    });

    player.configure({
      drm: {
        servers: {
          "com.widevine.alpha": backendSelect.value,
        },
        advanced: {
          "com.widevine.alpha": {
            videoRobustness: ["SW_SECURE_DECODE"],
            audioRobustness: ["SW_SECURE_CRYPTO"],
          },
        },
        retryParameters: { maxAttempts: 1 },
      },
    });

    await player.attach(video);
    await player.load(contentSelect.value);
  } catch (e) {
    logError(e);
  }
};
