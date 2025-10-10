## Controlling Denon/Marantz AV receivers from Roon

This project provides a Roon Volume Control extension that allows you to control volume and mute from within Roon. It does so by connecting the receiver via its network interface. Unfortunately, doing so will prevent other applications that rely on the Telnet-based communication to fail - at least my Denon AVR-3313 only accepts one of those connections at a time.

## Installation

1. Install Node.js from https://nodejs.org.

   * On Windows, install from the above link.
   * On Mac OS, you can use [homebrew](http://brew.sh) to install Node.js.
   * On Linux, you can use your distribution's package manager, but make sure it installs a recent Node.js. Otherwise just install from the above link.

   The extension has been developed with Node v8.0.0. While it may work with older versions, it's not something that I've tested.

1. Install Git from https://git-scm.com/downloads.
   * Following the instructions for the Operating System you are running.

1. Download the Denon/Marantz AVR extension.

   * Go to the [roon-extension-denon](https://github.com/docbobo/roon-extension-denon) page on [GitHub](https://github.com).
   * Click the green 'Clone or Download' button and select 'Download ZIP'.

1. Extract the zip file in a local folder.

1. Change directory to the extension in the local folder:
    ```
    cd <local_folder>/roon-extension-denon
    ```
    *Replace `<local_folder>` with the local folder path.*

1. Install the dependencies:
    ```bash
    npm install
    ```

1. Run it!
    ```bash
    node .
    ```

    The extension should appear in Roon now. See Settings->Setup->Extensions and you should see it in the list. Once it has been properly configured, it can be added as 'Volume Control' extension to an existing output zone.

## Docker Installation (Recommended)

For easy deployment, use Docker with the pre-built images:

### Quick Start with Docker Compose
```bash
curl -O https://raw.githubusercontent.com/arthursoares/roon-extension-denon/main/docker-compose.yml
docker-compose up -d
```

### Quick Start with Docker Run
```bash
docker run -d \
  --name roon-denon-extension \
  --network host \
  --restart unless-stopped \
  -v ./data:/usr/src/app/data \
  ghcr.io/arthursoares/roon-extension-denon:latest
```

📖 **See [DOCKER.md](./DOCKER.md) for complete Docker documentation and configuration options.**

## Zone Configuration Features

This enhanced version includes advanced zone control:

- **Zone Selection**: Choose between Main Zone and Zone 2
- **Dual-Zone Power Control**: Configure whether to turn off both zones or just the selected zone when powering off
- **Volume Control**: Available for Main Zone (Zone 2 supports power control only due to hardware limitations)

Configure these options in Roon → Settings → Extensions → Denon/Marantz AVR.

## Notes

* Setups with more than one Roon Core on the network are not currently tested.
* Zone 2 volume control is not supported due to limitations in the denon-client library.
