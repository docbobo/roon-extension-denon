"use strict";

var debug = require("debug")("roon-extension-denon"),
    debug_keepalive = require("debug")("roon-extension-denon:keepalive"),
    Denon = require("denon-client"),
    RoonApi = require("node-roon-api"),
    RoonApiSettings = require("node-roon-api-settings"),
    RoonApiStatus = require("node-roon-api-status"),
    RoonApiVolumeControl = require("node-roon-api-volume-control"),
    RoonApiSourceControl = require("node-roon-api-source-control"),
    AudysseyControl = require("./src/audyssey-control"),
    fetch = require("node-fetch"),
    parse = require("fast-xml-parser");

var denon = {};
var roon = new RoonApi({
    extension_id: "org.pruessmann.roon.denon",
    display_name: "Denon/Marantz AVR",
    display_version: "2025.8.0",
    publisher: "Doc Bobo",
    email: "docbobo@pm.me",
    website: "https://github.com/docbobo/roon-extension-denon",
});

var mysettings = roon.load_config("settings") || {
    hostname: "",
    setsource: "",
    zone: "main",
    powerOffBothZones: true,
    maxVolumeMode: "dynamic",
    audyssey: {
        dynamicEQ: false,
        dynamicVolume: "OFF",
        referenceLevel: 5,
    },
};

function make_layout(settings) {
    var l = {
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

    l.layout.push({
        type: "dropdown",
        title: "Maximum Volume Control",
        subtitle: "Dynamic: use receiver's max volume setting. Fixed: cap at 0 dB regardless of receiver setting",
        values: [
            { title: "Dynamic (use receiver setting)", value: "dynamic" },
            { title: "Fixed at 0 dB", value: "fixed" }
        ],
        setting: "maxVolumeMode",
    });

    // Audyssey Settings Section
    if (settings.hostname && !settings.err) {
        l.layout.push({
            type: "group",
            title: "Audyssey Settings",
            items: [
                {
                    type: "dropdown",
                    title: "Dynamic EQ",
                    subtitle: "Audyssey Dynamic EQ adjusts frequency response for better sound at low volumes",
                    values: [
                        { title: "Off", value: false },
                        { title: "On", value: true }
                    ],
                    setting: "audyssey.dynamicEQ",
                },
                {
                    type: "dropdown",
                    title: "Dynamic Volume",
                    subtitle: "Audyssey Dynamic Volume maintains consistent volume levels",
                    values: [
                        { title: "Off", value: "OFF" },
                        { title: "Light", value: "LIT" },
                        { title: "Medium", value: "MED" },
                        { title: "Heavy", value: "HEV" }
                    ],
                    setting: "audyssey.dynamicVolume",
                },
                {
                    type: "dropdown",
                    title: "Reference Level Offset",
                    subtitle: "Adjusts the reference level for Audyssey calibration",
                    values: [
                        { title: "0 dB", value: 0 },
                        { title: "5 dB", value: 5 },
                        { title: "10 dB", value: 10 },
                        { title: "15 dB", value: 15 }
                    ],
                    setting: "audyssey.referenceLevel",
                }
            ]
        });
    }

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

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function (cb) {
        probeInputs(mysettings).then((settings) => {
            cb(make_layout(settings));
        });
    },
    save_settings: function (req, isdryrun, settings) {
        probeInputs(settings.values).then((settings) => {
            let l = make_layout(settings);
            req.send_complete(l.has_error ? "NotValid" : "Success", {
                settings: l,
            });
            delete settings.inputs;

            if (!l.has_error && !isdryrun) {
                var old_hostname = mysettings.hostname;
                var old_setsource = mysettings.setsource;
                var old_zone = mysettings.zone;
                var old_powerOffBothZones = mysettings.powerOffBothZones;
                var old_maxVolumeMode = mysettings.maxVolumeMode;
                var old_audyssey = JSON.parse(JSON.stringify(mysettings.audyssey || {}));

                // Extract Audyssey settings from flat properties (Roon API behavior)
                const new_audyssey = {
                    dynamicEQ: l.values["audyssey.dynamicEQ"] !== undefined
                        ? l.values["audyssey.dynamicEQ"]
                        : (l.values.audyssey ? l.values.audyssey.dynamicEQ : false),
                    dynamicVolume: l.values["audyssey.dynamicVolume"] !== undefined
                        ? l.values["audyssey.dynamicVolume"]
                        : (l.values.audyssey ? l.values.audyssey.dynamicVolume : "OFF"),
                    referenceLevel: l.values["audyssey.referenceLevel"] !== undefined
                        ? l.values["audyssey.referenceLevel"]
                        : (l.values.audyssey ? l.values.audyssey.referenceLevel : 5)
                };

                debug("Audyssey settings extracted from UI: dynamicEQ=%s, dynamicVolume=%s, referenceLevel=%s",
                    new_audyssey.dynamicEQ, new_audyssey.dynamicVolume, new_audyssey.referenceLevel);

                mysettings = l.values;
                // Store Audyssey settings in nested format for persistence
                mysettings.audyssey = new_audyssey;
                svc_settings.update_settings(l);

                // Check if connection settings changed
                if (
                    old_hostname != mysettings.hostname ||
                    old_setsource != mysettings.setsource ||
                    old_zone != mysettings.zone ||
                    old_powerOffBothZones != mysettings.powerOffBothZones ||
                    old_maxVolumeMode != mysettings.maxVolumeMode
                ) {
                    setup_denon_connection(mysettings.hostname);
                }

                // Check if Audyssey settings changed and apply them
                if (denon.audyssey) {
                    let audysseyChanged = false;

                    if (old_audyssey.dynamicEQ !== new_audyssey.dynamicEQ) {
                        audysseyChanged = true;
                        debug("Audyssey: Dynamic EQ changed from %s to %s - applying to receiver",
                            old_audyssey.dynamicEQ, new_audyssey.dynamicEQ);
                        denon.audyssey.setDynamicEQ(new_audyssey.dynamicEQ)
                            .then(() => {
                                debug("Audyssey: Dynamic EQ successfully set to %s", new_audyssey.dynamicEQ);
                            })
                            .catch((err) => {
                                debug("Audyssey: Failed to set Dynamic EQ: %O", err);
                            });
                    }
                    if (old_audyssey.dynamicVolume !== new_audyssey.dynamicVolume) {
                        audysseyChanged = true;
                        debug("Audyssey: Dynamic Volume changed from %s to %s - applying to receiver",
                            old_audyssey.dynamicVolume, new_audyssey.dynamicVolume);
                        denon.audyssey.setDynamicVolume(new_audyssey.dynamicVolume)
                            .then(() => {
                                debug("Audyssey: Dynamic Volume successfully set to %s", new_audyssey.dynamicVolume);
                            })
                            .catch((err) => {
                                debug("Audyssey: Failed to set Dynamic Volume: %O", err);
                            });
                    }
                    if (old_audyssey.referenceLevel !== new_audyssey.referenceLevel) {
                        audysseyChanged = true;
                        debug("Audyssey: Reference Level changed from %s to %s - applying to receiver",
                            old_audyssey.referenceLevel, new_audyssey.referenceLevel);
                        denon.audyssey.setReferenceLevel(new_audyssey.referenceLevel)
                            .then(() => {
                                debug("Audyssey: Reference Level successfully set to %s", new_audyssey.referenceLevel);
                            })
                            .catch((err) => {
                                debug("Audyssey: Failed to set Reference Level: %O", err);
                            });
                    }

                    if (!audysseyChanged) {
                        debug("Audyssey: No settings changed, skipping application");
                    }
                } else {
                    debug("Audyssey: Client not initialized, cannot apply settings");
                }

                debug("Saving settings to config file");
                roon.save_config("settings", mysettings);
            }
        });
    },
});

var svc_status = new RoonApiStatus(roon);
var svc_volume_control = new RoonApiVolumeControl(roon);
var svc_source_control = new RoonApiSourceControl(roon);

roon.init_services({
    provided_services: [
        svc_status,
        svc_settings,
        svc_volume_control,
        svc_source_control,
    ],
});

function probeInputs(settings) {
    let inputs = (
        settings.hostname
            ? queryInputs(settings.hostname).then((inputs) => {
                  delete settings.err;
                  settings.inputs = inputs;
              })
            : Promise.resolve()
    )

        .catch((err) => {
            settings.err = err.message;
        })
        .then(() => {
            return settings;
        });
    return inputs;
}

function queryInputs(hostname) {
    return Promise.resolve(
        Object.keys(Denon.Options.InputOptions)
            .filter((title) => title != "Status")
            .sort()
            .map((title) => {
                return { title, value: Denon.Options.InputOptions[title] };
            }),
    );
}

function setup_denon_connection(host) {
    debug("setup_denon_connection (" + host + ")");

    if (denon.keepalive) {
        clearInterval(denon.keepalive);
        denon.keepalive = null;
    }
    if (denon.client) {
        // Remove all event listeners to prevent memory leaks
        denon.client.removeAllListeners();
        denon.client.socket.removeAllListeners();
        denon.client.disconnect();
        delete denon.client;
    }

    if (!host) {
        svc_status.set_status("Not configured, please check settings.", true);
    } else {
        debug("Connecting to receiver...");
        svc_status.set_status("Connecting to " + host + "...", false);

        denon.client = new Denon.DenonClient(host);
        denon.client.socket.setTimeout(0);
        denon.client.socket.setKeepAlive(true, 10000);

        denon.client.socket.on("error", (error) => {
            // Handler for debugging purposes. No need to reconnect since the event will be followed by a close event,
            // according to documentation.
            debug("Received onError(%O)", error);
        });

        denon.client.on("data", (data) => {
            debug("%s", data);
        });

        denon.client.socket.on("timeout", () => {
            debug("Received onTimeout(): Closing connection...");
            denon.client.disconnect();
        });

        denon.client.on("close", (had_error) => {
            debug("Received onClose(%O): Reconnecting...", had_error);

            if (denon.client) {
                svc_status.set_status(
                    "Connection closed by receiver. Reconnecting...",
                    true,
                );
                setTimeout(() => {
                    connect();
                }, 1000);
            } else {
                svc_status.set_status(
                    "Not configured, please check settings.",
                    true,
                );
            }
        });

        denon.client.on("powerChanged", (val) => {
            debug("powerChanged: val=%s", val);

            let old_power_value = denon.source_state.Power;
            denon.source_state.Power = val;
            if (old_power_value != denon.source_state.Power) {
                let stat = check_status(
                    denon.source_state.Power,
                    denon.source_state.Input,
                );
                debug("Power differs - updating");
                if (denon.source_control) {
                    denon.source_control.update_state({ status: stat });
                }
            }
        });

        denon.client.on("inputChanged", (val) => {
            debug("inputChanged: val=%s", val);
            let old_Input = denon.source_state.Input;
            denon.source_state.Input = val;

            if (old_Input != denon.source_state.Input) {
                let stat = check_status(
                    denon.source_state.Power,
                    denon.source_state.Input,
                );
                debug("input differs - updating");
                if (denon.source_control) {
                    denon.source_control.update_state({ status: stat });
                }
            }
        });

        denon.client.on("muteChanged", (val) => {
            debug("muteChanged: val=%s", val);

            denon.volume_state.is_muted = val === Denon.Options.MuteOptions.On;
            if (denon.volume_control) {
                denon.volume_control.update_state({
                    is_muted: denon.volume_state.is_muted,
                });
            }
        });

        denon.client.on("masterVolumeChanged", (val) => {
            debug("masterVolumeChanged: val=%s", val - 80);

            denon.volume_state.volume_value = val - 80;
            if (denon.volume_control) {
                denon.volume_control.update_state({
                    volume_value: denon.volume_state.volume_value,
                });
            }
        });

        denon.client.on("masterVolumeMaxChanged", (val) => {
            const newMaxVolume = val - 80;
            debug("masterVolumeMaxChanged: val=%s (current=%s, mode=%s)",
                newMaxVolume, denon.volume_state.volume_max, mysettings.maxVolumeMode);

            // Ignore receiver updates when in fixed mode
            if (mysettings.maxVolumeMode === "fixed") {
                debug("masterVolumeMaxChanged: Ignoring receiver update (fixed mode at 0 dB)");
                return;
            }

            // Only update Roon if the value actually changed (dynamic mode)
            if (denon.volume_state.volume_max !== newMaxVolume) {
                debug("masterVolumeMaxChanged: Value changed from %s to %s - updating Roon",
                    denon.volume_state.volume_max, newMaxVolume);
                denon.volume_state.volume_max = newMaxVolume;
                if (denon.volume_control) {
                    denon.volume_control.update_state({
                        volume_max: denon.volume_state.volume_max,
                    });
                }
            } else {
                debug("masterVolumeMaxChanged: Value unchanged, skipping Roon update");
            }
        });

        denon.client.on("zone2Changed", (val) => {
            debug("zone2Changed: val=%s", val);
            
            if (mysettings.zone === "zone2") {
                let old_power_value = denon.source_state.Power;
                denon.source_state.Power = (val === Denon.Options.Zone2Options.On) ? "ON" : "STANDBY";
                
                if (old_power_value != denon.source_state.Power) {
                    let stat = check_status(
                        denon.source_state.Power,
                        denon.source_state.Input,
                    );
                    debug("Zone2 power differs - updating");
                    if (denon.source_control) {
                        denon.source_control.update_state({ status: stat });
                    }
                }
            }
        });

        denon.client.on("zone2Changed", (val) => {
            debug("zone2Changed: val=%s", val);
            
            if (mysettings.zone === "zone2") {
                let old_power_value = denon.source_state.Power;
                denon.source_state.Power = (val === Denon.Options.Zone2Options.On) ? "ON" : "STANDBY";
                
                if (old_power_value != denon.source_state.Power) {
                    let stat = check_status(
                        denon.source_state.Power,
                        denon.source_state.Input,
                    );
                    debug("Zone2 power differs - updating");
                    if (denon.source_control) {
                        denon.source_control.update_state({ status: stat });
                    }
                }
            }
        });

        denon.keepalive = setInterval(() => {
            // Make regular calls to getBrightness for keep-alive.
            denon.client.getBrightness().then((val) => {
                debug_keepalive("Keep-Alive: getInput == %s", val);
            });
        }, 60000);

        connect();
    }
}

function connect() {
    denon.client
        .connect()
        .then(() => {
            // Initialize Audyssey control
            denon.audyssey = new AudysseyControl(denon.client);
            debug("Audyssey control initialized");

            // Only create volume control for Main Zone
            if (mysettings.zone === "main") {
                return create_volume_control(denon);
            } else {
                return Promise.resolve();
            }
        })
        .then(() =>
            mysettings.setsource
                ? create_source_control(denon)
                : Promise.resolve(),
        )
        .then(() => {
            // Apply saved Audyssey settings after connection
            if (denon.audyssey && mysettings.audyssey) {
                return apply_audyssey_settings();
            }
            return Promise.resolve();
        })
        .then(() => {
            const zoneInfo = mysettings.zone === "zone2" ? " (Zone 2 - Power Only)" : "";
            svc_status.set_status("Connected to receiver" + zoneInfo, false);
        })
        .catch((error) => {
            debug("setup_denon_connection: Error during setup. Retrying...");

            debug("Connection error during setup: %O", error);
            svc_status.set_status("Could not connect receiver: " + error, true);
        });
}

function apply_audyssey_settings() {
    debug("Audyssey: Applying all settings - dynamicEQ=%s, dynamicVolume=%s, referenceLevel=%s",
        mysettings.audyssey.dynamicEQ, mysettings.audyssey.dynamicVolume, mysettings.audyssey.referenceLevel);

    return denon.audyssey
        .setDynamicEQ(mysettings.audyssey.dynamicEQ)
        .then(() => {
            debug("Audyssey: Dynamic EQ applied: %s", mysettings.audyssey.dynamicEQ);
            return denon.audyssey.setDynamicVolume(mysettings.audyssey.dynamicVolume);
        })
        .then(() => {
            debug("Audyssey: Dynamic Volume applied: %s", mysettings.audyssey.dynamicVolume);
            return denon.audyssey.setReferenceLevel(mysettings.audyssey.referenceLevel);
        })
        .then(() => {
            debug("Audyssey: Reference Level applied: %s", mysettings.audyssey.referenceLevel);
            debug("Audyssey: All settings applied successfully");
        })
        .catch((error) => {
            debug("Audyssey: Error applying settings: %O", error);
            // Don't fail connection if Audyssey settings fail
        });
}

function check_status(power, input) {
    let stat = "";
    if (power == "ON") {
        if (input == mysettings.setsource) {
            stat = "selected";
        } else {
            stat = "deselected";
        }
    } else {
        stat = "standby";
    }
    debug("Receiver Status: %s", stat);
    return stat;
}

// Zone-specific helper functions
function getPowerForZone() {
    if (mysettings.zone === "zone2") {
        return denon.client.getZone2().then(status => {
            return (status === Denon.Options.Zone2Options.On) ? "ON" : "STANDBY";
        });
    } else {
        return denon.client.getPower();
    }
}

function setPowerForZone(powerState) {
    if (mysettings.zone === "zone2") {
        const zone2State = (powerState === "ON") ? 
            Denon.Options.Zone2Options.On : 
            Denon.Options.Zone2Options.Off;
        return denon.client.setZone2(zone2State);
    } else {
        return denon.client.setPower(powerState);
    }
}

function setPowerBothZones(powerState) {
    debug("setPowerBothZones: powerState=%s", powerState);
    
    if (mysettings.powerOffBothZones && powerState === "STANDBY") {
        // Turn off both zones when powering off
        const mainZonePromise = denon.client.setPower("STANDBY");
        const zone2Promise = denon.client.setZone2(Denon.Options.Zone2Options.Off);
        
        return Promise.all([mainZonePromise, zone2Promise]).then(() => {
            debug("Both zones powered off successfully");
        }).catch(error => {
            debug("Error powering off both zones: %O", error);
            throw error;
        });
    } else {
        // Use zone-specific power control
        return setPowerForZone(powerState);
    }
}

function create_volume_control(denon) {
    debug("create_volume_control: volume_control=%o", denon.volume_control);
    if (!denon.volume_control) {
        denon.volume_state = {
            display_name: mysettings.zone === "zone2" ? "Zone 2" : "Main Zone",
            volume_type: "db",
            volume_min: -79.5,
            volume_step: 0.5,
        };

        var device = {
            state: denon.volume_state,
            control_key: 1,

            set_volume: function (req, mode, value) {
                debug("set_volume: mode=%s value=%d", mode, value);

                let newvol =
                    mode == "absolute" ? value : state.volume_value + value;
                if (newvol < this.state.volume_min)
                    newvol = this.state.volume_min;
                else if (newvol > this.state.volume_max)
                    newvol = this.state.volume_max;

                denon.client
                    .setVolume(newvol + 80)
                    .then(() => {
                        debug("set_volume: Succeeded.");
                        req.send_complete("Success");
                    })
                    .catch((error) => {
                        debug("set_volume: Failed with error: %O", error);
                        req.send_complete("Failed");
                    });
            },
            set_mute: function (req, inAction) {
                debug("set_mute: action=%s", inAction);

                const action = !this.state.is_muted ? "on" : "off";
                denon.client
                    .setMute(
                        action === "on"
                            ? Denon.Options.MuteOptions.On
                            : Denon.Options.MuteOptions.Off,
                    )
                    .then(() => {
                        debug("set_mute: Succeeded.");

                        req.send_complete("Success");
                    })
                    .catch((error) => {
                        debug("set_mute: Failed with error: %O", error);
                        req.send_complete("Failed");
                    });
            },
        };
    }
    let result = denon.client
        .getVolume()
        .then((val) => {
            denon.volume_state.volume_value = val - 80;

            // Handle max volume based on mode
            if (mysettings.maxVolumeMode === "fixed") {
                debug("create_volume_control: Using fixed max volume of 0 dB");
                denon.volume_state.volume_max = 0;
                return Promise.resolve();
            } else {
                debug("create_volume_control: Querying receiver for max volume (dynamic mode)");
                return denon.client.getMaxVolume().then((val) => {
                    denon.volume_state.volume_max = val - 80;
                    debug("create_volume_control: Receiver max volume: %s dB", denon.volume_state.volume_max);
                });
            }
        })
        .then(() => {
            return denon.client.getMute();
        })
        .then((val) => {
            denon.volume_state.is_muted = val === Denon.Options.MuteOptions.On;
            if (denon.volume_control) {
                denon.volume_control.update_state(denon.volume_state);
            } else {
                debug("Registering volume control extension");
                denon.volume_control = svc_volume_control.new_device(device);
            }
        });
    return result;
}

function create_source_control(denon) {
    debug("create_source_control: source_control=%o", denon.source_control);
    if (!denon.source_control) {
        denon.source_state = {
            display_name: mysettings.zone === "zone2" ? "Zone 2" : "Main Zone",
            supports_standby: true,
            status: "",
            Power: "",
            Input: "",
        };

        var device = {
            state: denon.source_state,
            control_key: 2,

            convenience_switch: function (req) {
                debug("convenience_switch: Triggered - current Power=%s, Input=%s, target source=%s",
                    denon.source_state.Power, denon.source_state.Input, mysettings.setsource);

                const powerWasStandby = denon.source_state.Power === "STANDBY";
                const inputNeedsChange = denon.source_state.Input !== mysettings.setsource;

                debug("convenience_switch: powerWasStandby=%s, inputNeedsChange=%s",
                    powerWasStandby, inputNeedsChange);

                if (powerWasStandby) {
                    debug("convenience_switch: Power is in standby, turning on");
                    setPowerForZone("ON");
                }

                // Only apply Audyssey settings if we're actually making a change
                // (turning on from standby or switching input)
                const shouldApplyAudyssey = powerWasStandby || inputNeedsChange;
                debug("convenience_switch: shouldApplyAudyssey=%s", shouldApplyAudyssey);

                const applyAudyssey = shouldApplyAudyssey && denon.audyssey && mysettings.audyssey
                    ? (() => {
                        debug("convenience_switch: Applying Audyssey settings as part of source switch");
                        return apply_audyssey_settings();
                    })()
                    : Promise.resolve();

                if (inputNeedsChange) {
                    debug("convenience_switch: Switching input to %s and applying Audyssey", mysettings.setsource);
                    denon.client
                        .setInput(mysettings.setsource)
                        .then(() => {
                            debug("convenience_switch: Input switched successfully");
                            return applyAudyssey;
                        })
                        .then(() => {
                            debug("convenience_switch: Completed successfully");
                            req.send_complete("Success");
                        })
                        .catch((error) => {
                            debug("convenience_switch: Failed with error: %O", error);
                            req.send_complete("Failed");
                        });
                } else {
                    // Already on correct input
                    if (shouldApplyAudyssey) {
                        debug("convenience_switch: Already on correct input, but applying Audyssey due to power change");
                        applyAudyssey
                            .then(() => {
                                debug("convenience_switch: Completed successfully");
                                req.send_complete("Success");
                            })
                            .catch(() => {
                                debug("convenience_switch: Completed with Audyssey errors (non-fatal)");
                                req.send_complete("Success");
                            });
                    } else {
                        debug("convenience_switch: Already on correct input and power ON, no action needed");
                        req.send_complete("Success");
                    }
                }
            },
            standby: function (req) {
                getPowerForZone().then((val) => {
                    const newPowerState = val === "STANDBY" ? "ON" : "STANDBY";
                    setPowerBothZones(newPowerState)
                        .then(() => {
                            req.send_complete("Success");
                        })
                        .catch((error) => {
                            debug("set_standby: Failed with error: %O", error);
                            req.send_complete("Failed");
                        });
                });
            },
        };
    }

    let result = getPowerForZone()
        .then((val) => {
            denon.source_state.Power = val;
            return denon.client.getInput();
        })
        .then((val) => {
            denon.source_state.Input = val;
            denon.source_state.status = check_status(
                denon.source_state.Power,
                denon.source_state.Input,
            );
            if (denon.source_control) {
                denon.source_control.update_state(denon.source_state);
            } else {
                debug("Registering source control extension");
                denon.source_control = svc_source_control.new_device(device);
            }
        });
    return result;
}

setup_denon_connection(mysettings.hostname);

roon.start_discovery();
