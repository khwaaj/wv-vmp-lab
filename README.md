# Widevine VMP Lab

A lightweight, browser-based tool for testing DRM playback using Shaka Player and inspecting the Widevine VMP status.

## Overview

This page provides a simple interface for playing Widevine-protected test content while logging requests/reposnses as
well the status of the Verified Media Path (VMP) of the implementation.

## Features

* Play a selection of official Widevine test content.
* Select UAT or Production Widevine backends.
* Log DRM requests/reponses, including the VMP status of delivered content licenses.

## Usage

1. Open the page in a browser
2. Select:
   * Content to play from the **Content List** dropdown.
   * The backend to use from the **Backends** dropdown.
3. Click **Load Content**
4. Observe the **Log Output** below the *Player*.
5. Optionally play the loaded content by using the media controls.

## Local Testing

The `tools/` directory in this project includes a small helper script, `serve-https.py`, for running a local HTTPS
server. This is required because modern browsers enforce HTTPS for encrypted media playback (EME / Widevine).

### Prerequisites

You need a locally trusted certificate. The easiest way to generate one is with **mkcert**, which can be installed with
your favourite package manager.

Then install the local certificate authority:

```
mkcert -install
```

### Generate Certificates

Run the following in your project directory:

```
(cd tools/ && mkcert localhost)
```

This will generate two files in `tools/`:

* `localhost.pem` (certificate)
* `localhost-key.pem` (private key)

### Running the HTTPS Server

Start the server and point it to the `web/` directory:

```
tools/serve-https.py web/
```

By default, the server will:

* Serve content from the specified directory (`web/`)
* Use the generated `localhost.pem` and `localhost-key.pem`
* Be accessible at:

```
https://localhost:8443
```

### Notes

* The certificate is trusted locally via mkcert, so browsers should not show warnings.
* If you change hostnames (e.g. use an IP), you must generate a new certificate:

  ```
  mkcert 127.0.0.1
  ```
* Do **not** commit the generated `.pem` files to version control.
