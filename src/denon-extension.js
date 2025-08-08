"use strict";

const debug = require("debug")("roon-extension-denon"),
    Denon = require("denon-client"),
    RoonApi = require("node-roon-api"),
    RoonApiSettings = require("node-roon-api-settings"),
    RoonApiStatus = require("node-roon-api-status"),
    RoonApiVolumeControl = require("node-roon-api-volume-control"),
    RoonApiSourceControl = require("node-roon-api-source-control"),
    ZoneFunctions = require("./zone-functions");

/**
 * Denon/Marantz Roon Extension - Refactored Class-Based Architecture
 * 
 * Eliminates global variables and encapsulates all state within the extension class.
 * Provides clean separation of concerns and testable components.
 */
class DenonExtension {
    constructor() {
        // Initialize Roon API
        this.roon = new RoonApi({
            extension_id: "org.pruessmann.roon.denon",
            display_name: "Denon/Marantz AVR",
            display_version: "2025.8.0",
            publisher: "Doc Bobo",
            email: "docbobo@pm.me",
            website: "https://github.com/docbobo/roon-extension-denon",
        });

        // Load settings
        this.settings = this.roon.load_config("settings") || {
            hostname: "",
            setsource: "",
            zone: "main",
            powerOffBothZones: true,
        };

        // Denon client state
        this.client = null;
        this.keepaliveTimer = null;
        this.volumeState = null;
        this.sourceState = null;

        // Roon service references
        this.volumeControl = null;
        this.sourceControl = null;

        // Initialize services
        this.initializeServices();
        
        // Initialize zone functions helper
        this.zoneFunctions = new ZoneFunctions(null, this.settings);
    }

    /**
     * Initialize Roon API services
     */
    initializeServices() {
        this.svcSettings = new RoonApiSettings(this.roon, {
            get_settings: (cb) => {
                this.probeInputs(this.settings).then((settings) => {
                    cb(this.makeLayout(settings));
                });
            },
            save_settings: (req, isdryrun, settings) => {
                this.probeInputs(settings.values).then((settings) => {
                    let l = this.makeLayout(settings);
                    req.send_complete(l.has_error ? "NotValid" : "Success", {
                        settings: l,
                    });
                    delete settings.inputs;

                    if (!l.has_error && !isdryrun) {
                        const oldSettings = { ...this.settings };
                        this.settings = l.values;
                        this.svcSettings.update_settings(l);
                        
                        // Check if reconnection needed
                        if (this.shouldReconnect(oldSettings, this.settings)) {
                            this.setupConnection(this.settings.hostname);
                        }
                        
                        this.roon.save_config("settings", this.settings);
                    }
                });
            },
        });

        this.svcStatus = new RoonApiStatus(this.roon);
        this.svcVolumeControl = new RoonApiVolumeControl(this.roon);
        this.svcSourceControl = new RoonApiSourceControl(this.roon);

        this.roon.init_services({
            provided_services: [
                this.svcStatus,
                this.svcSettings,
                this.svcVolumeControl,
                this.svcSourceControl,
            ],
        });
    }

    /**
     * Check if reconnection is needed based on settings changes
     */
    shouldReconnect(oldSettings, newSettings) {
        return (
            oldSettings.hostname !== newSettings.hostname ||
            oldSettings.setsource !== newSettings.setsource ||
            oldSettings.zone !== newSettings.zone ||
            oldSettings.powerOffBothZones !== newSettings.powerOffBothZones
        );
    }

    /**
     * Create settings UI layout
     */
    makeLayout(settings) {
        const l = {
            values: settings,
            layout: [],
            has_error: false,
        };

        l.layout.push({
            type: "string",
            title: "Host name or IP Address",
            subtitle: "The IP address or hostname of the Denon/Marantz receiver.",
            maxlength: 256,
            setting: "hostname",
        });
        
        l.layout.push({
            type: "dropdown",
            title: "Zone",
            subtitle: "Select which zone to control. Note: Zone 2 supports power control only, not volume control.",
            values: [
                { title: "Main Zone", value: "main" },
                { title: "Zone 2 (Power Only)", value: "zone2" }
            ],
            setting: "zone",
        });
        
        l.layout.push({
            type: "dropdown",
            title: "Power Off Behavior",
            subtitle: "When powering off, turn off both zones or just the selected zone",
            values: [
                { title: "Turn off both zones", value: true },
                { title: "Turn off selected zone only", value: false }
            ],
            setting: "powerOffBothZones",
        });
        
        if (settings.err) {
            l.has_error = true;
            l.layout.push({
                type: "status",
                title: settings.err,
            });
        } else {
            l.has_error = false;
            if (settings.hostname) {
                l.layout.push({
                    type: "dropdown",
                    title: "Input",
                    values: settings.inputs,
                    setting: "setsource",
                });
            }
        }
        return l;
    }

    /**
     * Probe available inputs from receiver
     */
    async probeInputs(settings) {
        try {
            if (settings.hostname) {
                const inputs = await this.queryInputs(settings.hostname);
                delete settings.err;
                settings.inputs = inputs;
            }
        } catch (err) {
            settings.err = err.message;
        }
        return settings;
    }

    /**
     * Query available inputs
     */
    async queryInputs(hostname) {
        return Object.keys(Denon.Options.InputOptions)
            .filter((title) => title !== "Status")
            .sort()
            .map((title) => {
                return { title, value: Denon.Options.InputOptions[title] };
            });
    }

    /**
     * Setup Denon connection
     */
    setupConnection(host) {
        debug("setupConnection (%s)", host);

        // Cleanup existing connection
        this.cleanup();

        if (!host) {
            this.svcStatus.set_status("Not configured, please check settings.", true);
            return;
        }

        debug("Connecting to receiver...");
        this.svcStatus.set_status(`Connecting to ${host}...`, false);

        // Create new client
        this.client = new Denon.DenonClient(host);
        this.client.socket.setTimeout(0);
        this.client.socket.setKeepAlive(true, 10000);

        // Update zone functions helper
        this.zoneFunctions = new ZoneFunctions(this.client, this.settings);

        // Setup event handlers
        this.setupEventHandlers();

        // Setup keep-alive
        this.setupKeepAlive();

        // Connect
        this.connect();
    }

    /**
     * Cleanup existing connection and timers
     */
    cleanup() {
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
        
        if (this.client) {
            this.client.removeAllListeners("close");
            this.client.disconnect();
            this.client = null;
        }

        // Reset state
        this.volumeControl = null;
        this.sourceControl = null;
        this.volumeState = null;
        this.sourceState = null;
    }

    /**
     * Setup event handlers for Denon client
     */
    setupEventHandlers() {
        this.client.socket.on("error", (error) => {
            debug("Received onError(%O)", error);
        });

        this.client.on("data", (data) => {
            debug("%s", data);
        });

        this.client.socket.on("timeout", () => {
            debug("Received onTimeout(): Closing connection...");
            this.client.disconnect();
        });

        this.client.on("close", (had_error) => {
            debug("Received onClose(%O): Reconnecting...", had_error);

            if (this.client) {
                this.svcStatus.set_status(
                    "Connection closed by receiver. Reconnecting...",
                    true,
                );
                setTimeout(() => {
                    this.connect();
                }, 1000);
            } else {
                this.svcStatus.set_status(
                    "Not configured, please check settings.",
                    true,
                );
            }
        });

        this.client.on("powerChanged", (val) => {
            this.handlePowerChanged(val);
        });

        this.client.on("inputChanged", (val) => {
            this.handleInputChanged(val);
        });

        this.client.on("muteChanged", (val) => {
            this.handleMuteChanged(val);
        });

        this.client.on("masterVolumeChanged", (val) => {
            this.handleVolumeChanged(val);
        });

        this.client.on("masterVolumeMaxChanged", (val) => {
            this.handleVolumeMaxChanged(val);
        });

        this.client.on("zone2Changed", (val) => {
            this.handleZone2Changed(val);
        });
    }

    /**
     * Setup keep-alive mechanism
     */
    setupKeepAlive() {
        this.keepaliveTimer = setInterval(() => {
            if (this.client) {
                this.client.getBrightness().then((val) => {
                    debug("Keep-Alive: getBrightness == %s", val);
                });
            }
        }, 60000);
    }

    /**
     * Connect to receiver and setup controls
     */
    async connect() {
        try {
            await this.client.connect();
            
            // Only create volume control for Main Zone
            if (this.settings.zone === "main") {
                await this.createVolumeControl();
            }
            
            if (this.settings.setsource) {
                await this.createSourceControl();
            }
            
            const zoneInfo = this.settings.zone === "zone2" ? " (Zone 2 - Power Only)" : "";
            this.svcStatus.set_status("Connected to receiver" + zoneInfo, false);
        } catch (error) {
            debug("Connection error during setup: %O", error);
            this.svcStatus.set_status("Could not connect receiver: " + error, true);
        }
    }

    /**
     * Event handlers
     */
    handlePowerChanged(val) {
        debug("powerChanged: val=%s", val);
        
        if (!this.sourceState) return;

        const oldPowerValue = this.sourceState.Power;
        this.sourceState.Power = val;
        
        if (oldPowerValue !== this.sourceState.Power) {
            const stat = this.zoneFunctions.checkStatus(
                this.sourceState.Power,
                this.sourceState.Input,
            );
            debug("Power differs - updating");
            if (this.sourceControl) {
                this.sourceControl.update_state({ status: stat });
            }
        }
    }

    handleInputChanged(val) {
        debug("inputChanged: val=%s", val);
        
        if (!this.sourceState) return;

        const oldInput = this.sourceState.Input;
        this.sourceState.Input = val;

        if (oldInput !== this.sourceState.Input) {
            const stat = this.zoneFunctions.checkStatus(
                this.sourceState.Power,
                this.sourceState.Input,
            );
            debug("Input differs - updating");
            if (this.sourceControl) {
                this.sourceControl.update_state({ status: stat });
            }
        }
    }

    handleMuteChanged(val) {
        debug("muteChanged: val=%s", val);
        
        if (!this.volumeState) return;

        this.volumeState.is_muted = val === Denon.Options.MuteOptions.On;
        if (this.volumeControl) {
            this.volumeControl.update_state({
                is_muted: this.volumeState.is_muted,
            });
        }
    }

    handleVolumeChanged(val) {
        debug("masterVolumeChanged: val=%s", val - 80);
        
        if (!this.volumeState) return;

        this.volumeState.volume_value = val - 80;
        if (this.volumeControl) {
            this.volumeControl.update_state({
                volume_value: this.volumeState.volume_value,
            });
        }
    }

    handleVolumeMaxChanged(val) {
        debug("masterVolumeMaxChanged: val=%s", val - 80);
        
        if (!this.volumeState) return;

        this.volumeState.volume_max = val - 80;
        if (this.volumeControl) {
            this.volumeControl.update_state({
                volume_max: this.volumeState.volume_max,
            });
        }
    }

    handleZone2Changed(val) {
        debug("zone2Changed: val=%s", val);
        
        if (this.settings.zone === "zone2" && this.sourceState) {
            const oldPowerValue = this.sourceState.Power;
            this.sourceState.Power = (val === Denon.Options.Zone2Options.On) ? "ON" : "STANDBY";
            
            if (oldPowerValue !== this.sourceState.Power) {
                const stat = this.zoneFunctions.checkStatus(
                    this.sourceState.Power,
                    this.sourceState.Input,
                );
                debug("Zone2 power differs - updating");
                if (this.sourceControl) {
                    this.sourceControl.update_state({ status: stat });
                }
            }
        }
    }

    /**
     * Create volume control device
     */
    async createVolumeControl() {
        debug("createVolumeControl: volume_control=%o", this.volumeControl);
        
        if (!this.volumeControl) {
            this.volumeState = {
                display_name: this.zoneFunctions.getDisplayName(),
                volume_type: "db",
                volume_min: -79.5,
                volume_step: 0.5,
            };

            const device = {
                state: this.volumeState,
                control_key: 1,
                set_volume: this.setVolume.bind(this),
                set_mute: this.setMute.bind(this),
            };

            // Initialize current state
            const volume = await this.client.getVolume();
            this.volumeState.volume_value = volume - 80;
            
            const maxVolume = await this.client.getMaxVolume();
            this.volumeState.volume_max = maxVolume - 80;
            
            const mute = await this.client.getMute();
            this.volumeState.is_muted = mute === Denon.Options.MuteOptions.On;
            
            if (this.volumeControl) {
                this.volumeControl.update_state(this.volumeState);
            } else {
                debug("Registering volume control extension");
                this.volumeControl = this.svcVolumeControl.new_device(device);
            }
        }
    }

    /**
     * Create source control device
     */
    async createSourceControl() {
        debug("createSourceControl: source_control=%o", this.sourceControl);
        
        if (!this.sourceControl) {
            this.sourceState = {
                display_name: this.zoneFunctions.getDisplayName(),
                supports_standby: true,
                status: "",
                Power: "",
                Input: "",
            };

            const device = {
                state: this.sourceState,
                control_key: 2,
                convenience_switch: this.convenienceSwitch.bind(this),
                standby: this.standby.bind(this),
            };

            // Initialize current state
            const power = await this.zoneFunctions.getPowerForZone();
            this.sourceState.Power = power;
            
            const input = await this.client.getInput();
            this.sourceState.Input = input;
            
            const status = this.zoneFunctions.checkStatus(power, input);
            this.sourceState.status = status;
            
            debug("Registering source control extension");
            this.sourceControl = this.svcSourceControl.new_device(device);
        }
    }

    /**
     * Volume control methods
     */
    setVolume(req, mode, value) {
        debug("setVolume: mode=%s value=%d", mode, value);

        const newvol = mode === "absolute" 
            ? value 
            : this.volumeState.volume_value + value;
        
        const clampedVol = Math.max(
            this.volumeState.volume_min,
            Math.min(this.volumeState.volume_max, newvol)
        );

        this.client
            .setVolume(clampedVol + 80)
            .then(() => {
                debug("setVolume: Succeeded.");
                req.send_complete("Success");
            })
            .catch((error) => {
                debug("setVolume: Failed with error: %O", error);
                req.send_complete("Failed");
            });
    }

    setMute(req, action) {
        debug("setMute: action=%s", action);

        const muteAction = !this.volumeState.is_muted ? "on" : "off";
        
        this.client
            .setMute(
                muteAction === "on"
                    ? Denon.Options.MuteOptions.On
                    : Denon.Options.MuteOptions.Off,
            )
            .then(() => {
                debug("setMute: Succeeded.");
                req.send_complete("Success");
            })
            .catch((error) => {
                debug("setMute: Failed with error: %O", error);
                req.send_complete("Failed");
            });
    }

    /**
     * Source control methods
     */
    convenienceSwitch(req) {
        debug("convenienceSwitch");

        this.client
            .setInput(this.settings.setsource)
            .then(() => {
                debug("convenienceSwitch: Succeeded.");
                req.send_complete("Success");
            })
            .catch((error) => {
                debug("convenienceSwitch: Failed with error.");
                req.send_complete("Failed");
            });
    }

    standby(req) {
        debug("standby");

        this.zoneFunctions
            .setPowerBothZones("STANDBY")
            .then(() => {
                debug("standby: Succeeded.");
                req.send_complete("Success");
            })
            .catch((error) => {
                debug("standby: Failed with error: %O", error);
                req.send_complete("Failed");
            });
    }

    /**
     * Start the extension
     */
    start() {
        debug("Starting Denon Extension");
        this.setupConnection(this.settings.hostname);
        this.roon.start_discovery();
    }
}

module.exports = DenonExtension;