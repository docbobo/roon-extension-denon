"use strict";

const debug = require("debug")("roon-extension-denon:audyssey");

/**
 * Audyssey control extension for Denon/Marantz receivers
 * Provides control for Dynamic EQ, Dynamic Volume, MultEQ, and other Audyssey features
 */
class AudysseyControl {
    constructor(denonClient) {
        this.denonClient = denonClient;
    }

    /**
     * Get Dynamic EQ status
     * @returns {Promise<boolean>} True if Dynamic EQ is ON
     */
    getDynamicEQ() {
        return this._sendCommand("PSDYNEQ ?").then((response) => {
            debug("getDynamicEQ response: %s", response);
            return response === "PSDYNEQ ON";
        });
    }

    /**
     * Set Dynamic EQ status
     * @param {boolean} enabled - True to turn on, false to turn off
     * @returns {Promise<boolean>} Resolves with the new state
     */
    setDynamicEQ(enabled) {
        const command = enabled ? "PSDYNEQ ON" : "PSDYNEQ OFF";
        debug("setDynamicEQ: %s", command);

        return this._sendCommand(command).then((response) => {
            debug("setDynamicEQ response: %s", response);
            return response === "PSDYNEQ ON";
        });
    }

    /**
     * Toggle Dynamic EQ
     * @returns {Promise<boolean>} Resolves with the new state
     */
    toggleDynamicEQ() {
        return this.getDynamicEQ().then((currentState) => {
            return this.setDynamicEQ(!currentState);
        });
    }

    /**
     * Get Dynamic Volume status
     * @returns {Promise<string>} OFF, LIT (Light), MED (Medium), HEV (Heavy)
     */
    getDynamicVolume() {
        return this._sendCommand("PSDYNVOL ?").then((response) => {
            debug("getDynamicVolume response: %s", response);
            // Response format: PSDYNVOL OFF or PSDYNVOL LIT/MED/HEV
            return response.replace("PSDYNVOL ", "");
        });
    }

    /**
     * Set Dynamic Volume status
     * @param {string} level - OFF, LIT, MED, or HEV
     * @returns {Promise<string>} Resolves with the new state
     */
    setDynamicVolume(level) {
        const validLevels = ["OFF", "LIT", "MED", "HEV"];
        const upperLevel = level.toUpperCase();

        if (!validLevels.includes(upperLevel)) {
            return Promise.reject(
                new Error(
                    `Invalid Dynamic Volume level: ${level}. Must be one of: ${validLevels.join(", ")}`,
                ),
            );
        }

        const command = `PSDYNVOL ${upperLevel}`;
        debug("setDynamicVolume: %s", command);

        return this._sendCommand(command).then((response) => {
            debug("setDynamicVolume response: %s", response);
            return response.replace("PSDYNVOL ", "");
        });
    }

    /**
     * Get Reference Level Offset
     * @returns {Promise<number>} Reference level (0, 5, 10, or 15)
     */
    getReferenceLevel() {
        return this._sendCommand("PSREFLEV ?").then((response) => {
            debug("getReferenceLevel response: %s", response);
            const value = response.replace("PSREFLEV ", "");
            return parseInt(value, 10);
        });
    }

    /**
     * Set Reference Level Offset
     * @param {number} level - Reference level (0, 5, 10, or 15)
     * @returns {Promise<number>} Resolves with the new level
     */
    setReferenceLevel(level) {
        const validLevels = [0, 5, 10, 15];

        if (!validLevels.includes(level)) {
            return Promise.reject(
                new Error(
                    `Invalid Reference Level: ${level}. Must be one of: ${validLevels.join(", ")}`,
                ),
            );
        }

        const command = `PSREFLEV ${level}`;
        debug("setReferenceLevel: %s", command);

        return this._sendCommand(command).then((response) => {
            debug("setReferenceLevel response: %s", response);
            const value = response.replace("PSREFLEV ", "");
            return parseInt(value, 10);
        });
    }

    /**
     * Get MultEQ mode
     * @returns {Promise<string>} MultEQ mode
     */
    getMultEQ() {
        return this._sendCommand("PSMULTEQ ?").then((response) => {
            debug("getMultEQ response: %s", response);
            return response.replace("PSMULTEQ ", "");
        });
    }

    /**
     * Set MultEQ mode
     * @param {string} mode - AUDYSSEY, BYP.LR, FLAT, MANUAL, OFF
     * @returns {Promise<string>} Resolves with the new mode
     */
    setMultEQ(mode) {
        const validModes = ["AUDYSSEY", "BYP.LR", "FLAT", "MANUAL", "OFF"];
        const upperMode = mode.toUpperCase();

        if (!validModes.includes(upperMode)) {
            return Promise.reject(
                new Error(
                    `Invalid MultEQ mode: ${mode}. Must be one of: ${validModes.join(", ")}`,
                ),
            );
        }

        const command = `PSMULTEQ ${upperMode}`;
        debug("setMultEQ: %s", command);

        return this._sendCommand(command).then((response) => {
            debug("setMultEQ response: %s", response);
            return response.replace("PSMULTEQ ", "");
        });
    }

    /**
     * Send raw command to receiver and wait for response
     * @private
     * @param {string} command - Command to send (without CR)
     * @returns {Promise<string>} Response from receiver
     */
    _sendCommand(command) {
        return new Promise((resolve, reject) => {
            const socket = this.denonClient.socket;

            if (!socket || socket.destroyed) {
                return reject(new Error("Socket not connected"));
            }

            // Set up one-time listener for this specific command response
            const commandPrefix = command.split(" ")[0];
            let responseReceived = false;

            const onData = (data) => {
                const response = data.toString().trim();
                debug("_sendCommand received: %s", response);

                // Check if this is the response to our command
                if (response.startsWith(commandPrefix)) {
                    responseReceived = true;
                    this.denonClient.removeListener("data", onData);
                    clearTimeout(timeout);
                    resolve(response);
                }
            };

            // Timeout after 5 seconds
            const timeout = setTimeout(() => {
                if (!responseReceived) {
                    this.denonClient.removeListener("data", onData);
                    reject(new Error(`Timeout waiting for response to: ${command}`));
                }
            }, 5000);

            // Listen for response
            this.denonClient.on("data", onData);

            // Send command
            const fullCommand = command + "\r";
            debug("_sendCommand sending: %s", command);
            socket.write(fullCommand);
        });
    }
}

module.exports = AudysseyControl;
