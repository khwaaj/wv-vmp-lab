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

  if (!res) return null;

  if (res.wireType === 0) {
    return res.value;
  }

  return null;
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
    const category = ERROR_CATEGORY[e.category] || e.category
    const code = ERROR_CODE[e.code] || e.code
    e.message = `Shaka Error ${category}.${code}`
  }
  console.error("Error:", e)
  e.stack = undefined;
  logBox.textContent += "Error: " + e + "\n";
}


// =========================
// Player and content logic
// =========================

let player = null;

document.getElementById('loadContentBtn').onclick = async () => {
  const contentSelect = document.getElementById('contentSelect').selectedOptions[0]
  const backendSelect = document.getElementById('backendSelect').selectedOptions[0]
  const video = document.getElementById('video');

  clearLog();
  log(`Loading content: ${contentSelect.text}, using backend: ${backendSelect.text}`)

  shaka.polyfill.installAll();

  try {
    if (player) {
      await player.destroy();
      player = null
    }
    player = new shaka.Player();

    const net = player.getNetworkingEngine();
    net.registerRequestFilter((type, request) => {
      if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
        const message_type = extractInt(request.body, [1]);
        const message_type_str = enumToString(MessageType, message_type)
        log(">>", message_type_str);
      }
    });
    net.registerResponseFilter((type, response) => {
      if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
        const message_type = extractInt(response.data, [1]);
        const message_type_str = enumToString(MessageType, message_type)
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
          "com.widevine.alpha": backendSelect.value
        },
        advanced: {
          "com.widevine.alpha": {
            videoRobustness: ["SW_SECURE_DECODE"],
            audioRobustness: ["SW_SECURE_CRYPTO"]
          }
        }
      }
    });

    await player.attach(video)
    await player.load(contentSelect.value);
  } catch (e) {
    logError(e);
  }
};
