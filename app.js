"use strict";

var debug                = require('debug')('roon-extension-denon'),
    debug_keepalive      = require('debug')('roon-extension-denon:keepalive'),
    Denon                = require('denon-client'),
    RoonApi              = require('node-roon-api'),
    RoonApiSettings      = require('node-roon-api-settings'),
    RoonApiStatus        = require('node-roon-api-status'),
    RoonApiVolumeControl = require('node-roon-api-volume-control'),
    RoonApiSourceControl = require('node-roon-api-source-control'),
    fetch                = require('node-fetch'),
    parse                = require('fast-xml-parser');

var denon = {};
var roon = new RoonApi({
    extension_id:        'org.pruessmann.roon.denon',
    display_name:        'Denon/Marantz AVR',
    display_version:     '0.0.9',
    publisher:           'Doc Bobo',
    email:               'boris@pruessmann.org',
    website:             'https://github.com/docbobo/roon-extension-denon',
});

var mysettings = roon.load_config("settings") || {
    hostname:  "",
    setsource: "",
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
    if(settings.err) {
        l.has_error = true;
        l.layout.push({
            type:    "status",
            title:   settings.err,
        });
    }
    else {
        l.has_error = false;
        if(settings.hostname) {
            l.layout.push({
                type:    "dropdown",
                title:   "Input",
                values:  settings.inputs,
                setting: "setsource",
            });
        }
    }
    return l;
}


var svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        probeInputs(mysettings)
            .then((settings) => {
                cb(make_layout(settings));
            });
    },
    save_settings: function(req, isdryrun, settings) {
        probeInputs(settings.values)
            .then((settings) => {
                let l = make_layout(settings);
                req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });
                delete settings.inputs;

                if(!l.has_error && !isdryrun) {
                    var old_hostname = mysettings.hostname;
                    var old_setsource = mysettings.setsource;
                    mysettings = l.values;
                    svc_settings.update_settings(l);
                    if (old_hostname != mysettings.hostname || old_setsource != mysettings.setsource) setup_denon_connection(mysettings.hostname);
                    roon.save_config("settings", mysettings);
                }
            });
    }
});

var svc_status = new RoonApiStatus(roon);
var svc_volume_control = new RoonApiVolumeControl(roon);
var svc_source_control = new RoonApiSourceControl(roon);

roon.init_services({
    provided_services: [ svc_status, svc_settings, svc_volume_control, svc_source_control ]
});

function probeInputs(settings) {

    let inputs = (settings.hostname ?
        queryInputs(settings.hostname)
        .then(inputs => {
            delete settings.err;
            settings.inputs = inputs
        }) : Promise.resolve())

        .catch(err => {
            settings.err = err.message;
        })
        .then(() => {
            return settings;
        });
    return inputs;
}

function queryInputs(hostname) {
    return fetch('http://' + hostname + '/goform/formMainZone_MainZoneXmlStatus.xml',{timeout: 2000})
        .then(res => {
            return res.text()})
        .then(body => {

            var result = parse.parse(body);
            var inputs = result['item']['InputFuncList']['value'];
            var renames = result['item']['RenameSource']['value'];

            var outs = (result.item.SourceDelete ? Promise.resolve(result.item.SourceDelete.value) :

                fetch('http://' + hostname + '/goform/formMainZone_MainZoneXml.xml',{timeout: 2000})
                .then(res => res.text())
                .then(body => {
                    let r = parse.parse(body);
                    return r['item']['SourceDelete']['value'];
                })
                )
                .then((removes) => {
                    return inputs.map((x, i) => {
                        var dict = {};
                        dict["title"] = renames[i].value ? renames[i].value : renames[i];
                        dict["value"] = x;
                        return dict;
                    }).filter((data, index) => removes[index] == "USE" && data.value != "TV");
                });
            return outs;
        });
}

function setup_denon_connection(host) {
    debug("setup_denon_connection (" + host + ")");

    if (denon.keepalive) { clearInterval(denon.keepalive); denon.keepalive = null; }
    if (denon.client) { denon.client.removeAllListeners('close'); denon.client.disconnect(); delete(denon.client); }

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

            if(denon.client) {
            svc_status.set_status("Connection closed by receiver. Reconnecting...", true);
                setTimeout(() => {
                    connect();
                }, 1000);
            } else {
                svc_status.set_status("Not configured, please check settings.", true);
            }
        });

        denon.client.on('powerChanged', (val) => {
            debug("powerChanged: val=%s", val);

            let old_power_value = denon.source_state.Power;
            denon.source_state.Power = val;
            if (old_power_value != denon.source_state.Power) {
                let stat = check_status(denon.source_state.Power, denon.source_state.Input);
                debug("Power differs - updating");
                if (denon.source_control) {
                    denon.source_control.update_state( {status: stat});
                }
            }
        });

        denon.client.on('inputChanged', (val) => {
            debug("inputChanged: val=%s", val);
            let old_Input = denon.source_state.Input;
            denon.source_state.Input = val;

            if (old_Input != denon.source_state.Input) {
                let stat = check_status(denon.source_state.Power, denon.source_state.Input);
                debug("input differs - updating");
                if (denon.source_control) {
                    denon.source_control.update_state( {status: stat});
                }

            }
        });

        denon.client.on('muteChanged', (val) => {
            debug("muteChanged: val=%s", val);

            denon.volume_state.is_muted = val === Denon.Options.MuteOptions.On;
            if (denon.volume_control) {
                denon.volume_control.update_state({ is_muted: denon.volume_state.is_muted });
            }
        });

        denon.client.on('masterVolumeChanged', (val) => {
            debug("masterVolumeChanged: val=%s", val - 80);

            denon.volume_state.volume_value = val - 80;
            if (denon.volume_control) {
                denon.volume_control.update_state({ volume_value: denon.volume_state.volume_value });
            }
        });

        denon.client.on('masterVolumeMaxChanged', (val) => {
            debug("masterVolumeMaxChanged: val=%s", val - 80);

            denon.volume_state.volume_max = val - 80;
            if (denon.volume_control) {
                denon.volume_control.update_state({ volume_max: denon.volume_state.volume_max });
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

    denon.client.connect()
    .then(() => create_volume_control(denon))
    .then(() => mysettings.setsource ? create_source_control(denon) : Promise.resolve())
    .then(() => {
        svc_status.set_status("Connected to receiver", false);
    })
    .catch((error) => {
        debug("setup_denon_connection: Error during setup. Retrying...");

        // TODO: Fix error message
        console.log(error);
        svc_status.set_status("Could not connect receiver: " + error, true);
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
    }
    else {
        stat = "standby";
    }
    debug("Receiver Status: %s", stat);
    return stat;
}

function create_volume_control(denon) {
    debug("create_volume_control: volume_control=%o", denon.volume_control)
    if(!denon.volume_control) {
        denon.volume_state = {
            display_name: "Main Zone",
            volume_type:  "db",
            volume_min:   -79.5,
            volume_step:  0.5,
        };

        var device = {
            state: denon.volume_state,
            control_key: 1,

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
    }
    let result = denon.client.getVolume().then((val) => {
        denon.volume_state.volume_value = val - 80;
        return denon.client.getMaxVolume();
    }).then((val) => {
        denon.volume_state.volume_max = val - 80;
        return denon.client.getMute();
    }).then((val) => {
        denon.volume_state.is_muted = (val === Denon.Options.MuteOptions.On);
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
    debug("create_source_control: source_control=%o", denon.source_control)
    if(!denon.source_control) {
        denon.source_state = {
            display_name: "Main Zone",
            supports_standby: true,
            status: "",
            Power: "",
            Input: ""
        };

        var device = {
            state: denon.source_state,
            control_key: 2,
            
            convenience_switch: function (req) {
                if (denon.source_state.Power === "STANDBY") {
                    denon.client.setPower('ON');
                }

                if (denon.source_state.Input == mysettings.setsource) {
                    req.send_complete("Success");
                } else {
                    denon.client.setInput(mysettings.setsource).then(() => {
                        req.send_complete("Success");
                    }).catch((error) => {
                        debug("set_source: Failed with error.");
                        req.send_complete("Failed");
                    });
                }
            },
            standby: function (req) {
                denon.client.getPower().then((val) => {
                    denon.client.setPower(val === 'STANDBY' ? "ON" : "STANDBY").then(() => {
                        req.send_complete("Success");
                    }).catch((error) => {
                        debug("set_standby: Failed with error.");

                        console.log(error);
                        req.send_complete("Failed");
                    });
                });
            }
        };
    }

    let result = denon.client.getPower().then((val) => {
        denon.source_state.Power = val;
        return denon.client.getInput();
    }).then((val) => {
        denon.source_state.Input = val;
        denon.source_state.status = check_status(denon.source_state.Power, denon.source_state.Input);
        if(denon.source_control) {
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
