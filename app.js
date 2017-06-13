"use strict";

var debug                = require('debug')('roon-extension-denon'),
    debug_keepalive      = require('debug')('roon-extension-denon:keepalive'),
    Denon                = require('denon-client'),
    RoonApi              = require('node-roon-api'),
    RoonApiSettings      = require('node-roon-api-settings'),
    RoonApiStatus        = require('node-roon-api-status'),
    RoonApiVolumeControl = require('node-roon-api-volume-control');

var denon = {};
var roon = new RoonApi({
    extension_id:        'org.pruessmann.roon.denon',
    display_name:        'Denon/Marantz AVR',
    display_version:     '0.0.3',
    publisher:           'Doc Bobo',
    email:               'boris@pruessmann.org',
    website:             'https://github.com/docbobo/roon-extension-denon',
});

var mysettings = roon.load_config("settings") || {
    hostname: "",
};

function make_layout(settings) {
    var l = {
        values:    settings,
        layout:    [],
        has_error: false
    };

    l.layout.push({
        type:      "string",
        title:     "Host name or IP Address",
        subtitle:  "The IP address or hostname of the Denon/Marantz receiver.",
        maxlength: 256,
        setting:   "hostname",
    });

    return l;
}

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        cb(make_layout(mysettings));
    },
    save_settings: function(req, isdryrun, settings) {
        let l = make_layout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error) {
            var old_hostname = mysettings.hostname;
            mysettings = l.values;
            svc_settings.update_settings(l);
            if (old_hostname != mysettings.hostname) setup_denon_connection(mysettings.hostname);
            roon.save_config("settings", mysettings);
        }
    }
});

var svc_status = new RoonApiStatus(roon);
var svc_volume_control = new RoonApiVolumeControl(roon);

roon.init_services({
    provided_services: [ svc_status, svc_settings, svc_volume_control ]
});

function setup_denon_connection(host) {
    debug("setup_denon_connection (" + host + ")");

    if (denon.keepalive) { clearInterval(denon.keepalive); denon.keepalive = null; }
    if (denon.client) { denon.client.disconnect(); delete(denon.client); }

    if (!host) {
        svc_status.set_status("Not configured, please check settings.", true);
    } else {
        debug("Connecting to receiver...");
        svc_status.set_status("Connecting to " + host + "...", false);

        denon.client = new Denon.DenonClient(host);
        denon.client.socket.setTimeout(0);
        denon.client.socket.setKeepAlive(true, 10000);

        denon.client.socket.on('error', (error) => {
            // Handler for debugging purposes. No need to reconnect since the event will be followed by a close event,
            // according to documentation.
            debug('Received onError(%O)', error);
        });

        denon.client.on('data', (data) => {
            debug("%s", data);
        });

        denon.client.socket.on('timeout', () => {
            debug('Received onTimeout(): Closing connection...');
            denon.client.disconnect();
        });

        denon.client.on('close', (had_error) => {
            debug('Received onClose(%O): Reconnecting...', had_error);
            svc_status.set_status("Connection closed by receiver. Reconnecting...", true);

            if (!denon.reconnect) {
                denon.reconnect = setTimeout(() => {
                    denon.client.connect();
                    denon.reconnect = null;

                    svc_status.set_status("Connected to receiver", false);
                }, 1000);
            }
        });

        denon.client.connect().then(() => {
                create_volume_control(denon).then(() => {
                    svc_status.set_status("Connected to receiver", false);
                });
            }).catch((error) => {
                debug("setup_denon_connection: Error during setup. Retrying...");

                // TODO: Fix error message
                console.log(error);
                svc_status.set_status("Could not connect receiver: " + error, true);
            });

        denon.keepalive = setInterval(() => {
            // Make regular calls to getBrightness for keep-alive.
            denon.client.getBrightness().then((val) => {
                debug_keepalive("Keep-Alive: getInput == %s", val);
            });
        }, 60000);
    }
}

function create_volume_control(denon) {
    debug("create_volume_control: volume_control=%o", denon.volume_control)
    var result = denon.client;
    if (!denon.volume_control) {
        denon.state = {
            display_name: "Main Zone",
            volume_type:  "db",
            volume_min:   -79.5,
            volume_step:  0.5,
        };

        var device = {
            state: denon.state,
            set_volume: function (req, mode, value) {
                debug("set_volume: mode=%s value=%d", mode, value);

                let newvol = mode == "absolute" ? value : (state.volume_value + value);
                if      (newvol < this.state.volume_min) newvol = this.state.volume_min;
                else if (newvol > this.state.volume_max) newvol = this.state.volume_max;

                denon.client.setVolume(newvol + 80).then(() => {
                    debug("set_volume: Succeeded.");
                    req.send_complete("Success");
                }).catch((error) => {
                    debug("set_volume: Failed with error.");

                    console.log(error);
                    req.send_complete("Failed");
                });
            },
            set_mute: function (req, inAction) {
                debug("set_mute: action=%s", inAction);

                const action = !this.state.is_muted ? "on" : "off";
                denon.client.setMute(action === "on" ? Denon.Options.MuteOptions.On : Denon.Options.MuteOptions.Off)
                    .then(() => {
                        debug("set_mute: Succeeded.");

                        req.send_complete("Success");
                    }).catch((error) => {
                        debug("set_mute: Failed.");

                        console.log(error);
                        req.send_complete("Failed");
                    });
            }
        };

        result = denon.client.getVolume().then((val) => {
            denon.state.volume_value = val - 80;
            return denon.client.getMaxVolume();
        }).then((val) => {
            denon.state.volume_max = val - 80;
            return denon.client.getMute();
        }).then((val) => {
            debug("Registering volume control extension");
            denon.state.is_muted = (val === Denon.Options.MuteOptions.On);
            denon.volume_control = svc_volume_control.new_device(device);
        });
    }

    return result.then(() => {
        debug("Subscribing to events from receiver");
        denon.client.on('muteChanged', (val) => {
            debug("muteChanged: val=%s", val);

            let old_is_muted = denon.state.is_muted;
            denon.state.is_muted = val === Denon.Options.MuteOptions.On;
            if (old_is_muted != denon.state.is_muted) {
                debug("mute differs - updating");
                denon.volume_control.update_state({ is_muted: denon.state.is_muted });
            }
        });

        denon.client.on('masterVolumeChanged', (val) => {
            debug("masterVolumeChanged: val=%s", val - 80);

            let old_volume_value = denon.state.volume_value;
            denon.state.volume_value = val - 80;
            if (old_volume_value != denon.state.volume_value) {
                debug("masterVolume differs - updating");
                denon.volume_control.update_state({ volume_value: denon.state.volume_value });
            }
        });

        denon.client.on('masterVolumeMaxChanged', (val) => {
            debug("masterVolumeMaxChanged: val=%s", val - 80);

            let old_volume_max = denon.state.volume_max;
            denon.state.volume_max = val - 80;
            if (old_volume_max != denon.state.volume_max) {
                debug("masterVolumeMax differs - updating");
                denon.volume_control.update_state({ volume_max: denon.state.volume_max });
            }
        });
    });
}

setup_denon_connection(mysettings.hostname);

roon.start_discovery();
