"use strict";

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

// Mock all external dependencies
jest.mock('debug', () => jest.fn().mockReturnValue(jest.fn()));
jest.mock('node-roon-api');
jest.mock('node-roon-api-settings');
jest.mock('node-roon-api-status');
jest.mock('node-roon-api-volume-control');
jest.mock('node-roon-api-source-control');
jest.mock('../src/zone-functions');

// Factory function to create fresh mock client
const createMockDenonClient = () => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    removeAllListeners: jest.fn(),
    getVolume: jest.fn(),
    setVolume: jest.fn(),
    getMaxVolume: jest.fn(),
    getMute: jest.fn(),
    setMute: jest.fn(),
    getInput: jest.fn(),
    setInput: jest.fn(),
    getBrightness: jest.fn(),
    getPower: jest.fn(),
    setPower: jest.fn(),
    getZone2: jest.fn(),
    setZone2: jest.fn(),
    socket: {
        setTimeout: jest.fn(),
        setKeepAlive: jest.fn(),
        on: jest.fn()
    },
    on: jest.fn()
});

jest.mock('denon-client', () => ({
    DenonClient: jest.fn(() => createMockDenonClient()),
    Options: {
        InputOptions: {
            'CBL/SAT': 'SAT/CBL',
            'DVD': 'DVD',
            'Blu-ray': 'BD'
        },
        MuteOptions: {
            On: 'MUON',
            Off: 'MUOFF'
        },
        Zone2Options: {
            On: 'Z2ON',
            Off: 'Z2OFF'
        }
    }
}));

const DenonExtension = require('../src/denon-extension');

describe('DenonExtension', () => {
    let extension;
    let mockRoonApi;
    let mockSettings, mockStatus, mockVolumeControl, mockSourceControl;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Mock Roon API components
        mockRoonApi = {
            load_config: jest.fn().mockReturnValue({
                hostname: "192.168.1.100",
                setsource: "CBL/SAT",
                zone: "main",
                powerOffBothZones: true
            }),
            save_config: jest.fn(),
            init_services: jest.fn(),
            start_discovery: jest.fn()
        };

        mockSettings = {
            update_settings: jest.fn()
        };

        mockStatus = {
            set_status: jest.fn()
        };

        mockVolumeControl = {
            new_device: jest.fn()
        };

        mockSourceControl = {
            new_device: jest.fn()
        };

        // Mock Roon API constructors
        const RoonApi = require('node-roon-api');
        const RoonApiSettings = require('node-roon-api-settings');
        const RoonApiStatus = require('node-roon-api-status');
        const RoonApiVolumeControl = require('node-roon-api-volume-control');
        const RoonApiSourceControl = require('node-roon-api-source-control');

        RoonApi.mockImplementation(() => mockRoonApi);
        RoonApiSettings.mockImplementation(() => mockSettings);
        RoonApiStatus.mockImplementation(() => mockStatus);
        RoonApiVolumeControl.mockImplementation(() => mockVolumeControl);
        RoonApiSourceControl.mockImplementation(() => mockSourceControl);

        // Mock ZoneFunctions
        const ZoneFunctions = require('../src/zone-functions');
        ZoneFunctions.mockImplementation(() => ({
            getDisplayName: jest.fn().mockReturnValue("Main Zone"),
            checkStatus: jest.fn().mockReturnValue("selected"),
            getPowerForZone: jest.fn().mockResolvedValue("ON"),
            setPowerBothZones: jest.fn().mockResolvedValue(),
            updateSettings: jest.fn()
        }));

        // Create extension instance
        extension = new DenonExtension();
    });

    afterEach(() => {
        if (extension && extension.keepaliveTimer) {
            clearInterval(extension.keepaliveTimer);
        }
    });

    describe('Constructor', () => {
        it('should initialize with default settings', () => {
            expect(extension.settings).toBeDefined();
            expect(extension.settings.hostname).toBe("192.168.1.100");
            expect(extension.settings.zone).toBe("main");
            expect(extension.settings.powerOffBothZones).toBe(true);
        });

        it('should initialize Roon API with correct configuration', () => {
            const RoonApi = require('node-roon-api');
            expect(RoonApi).toHaveBeenCalledWith({
                extension_id: "org.pruessmann.roon.denon",
                display_name: "Denon/Marantz AVR",
                display_version: "2025.8.0",
                publisher: "Doc Bobo",
                email: "docbobo@pm.me",
                website: "https://github.com/docbobo/roon-extension-denon"
            });
        });

        it('should initialize all Roon services', () => {
            expect(mockRoonApi.init_services).toHaveBeenCalledWith({
                provided_services: [
                    mockStatus,
                    mockSettings,
                    mockVolumeControl,
                    mockSourceControl
                ]
            });
        });

        it('should initialize with null client state', () => {
            expect(extension.client).toBeNull();
            expect(extension.keepaliveTimer).toBeNull();
            expect(extension.volumeState).toBeNull();
            expect(extension.sourceState).toBeNull();
            expect(extension.volumeControl).toBeNull();
            expect(extension.sourceControl).toBeNull();
        });
    });

    describe('Settings Management', () => {
        it('should create proper settings layout without inputs', () => {
            const settings = {
                hostname: "",  // Empty hostname means no inputs
                zone: "main",
                powerOffBothZones: true
            };

            const layout = extension.makeLayout(settings);

            expect(layout.values).toEqual(settings);
            expect(layout.has_error).toBe(false);
            expect(layout.layout).toHaveLength(3); // hostname, zone, powerOffBothZones only
        });

        it('should create proper settings layout with inputs', () => {
            const settings = {
                hostname: "192.168.1.100",
                zone: "main",
                powerOffBothZones: true,
                inputs: [
                    { title: 'CBL/SAT', value: 'SAT/CBL' },
                    { title: 'DVD', value: 'DVD' }
                ]
            };

            const layout = extension.makeLayout(settings);

            expect(layout.values).toEqual(settings);
            expect(layout.has_error).toBe(false);
            expect(layout.layout).toHaveLength(4); // hostname, zone, powerOffBothZones, inputs
            const inputField = layout.layout.find(field => field.setting === "setsource");
            expect(inputField).toBeDefined();
            expect(inputField.values).toEqual(settings.inputs);
        });

        it('should show error status when error is present', () => {
            const settings = {
                hostname: "192.168.1.100",
                err: "Connection failed"
            };

            const layout = extension.makeLayout(settings);

            expect(layout.has_error).toBe(true);
            const errorField = layout.layout.find(field => field.type === "status");
            expect(errorField).toBeDefined();
            expect(errorField.title).toBe("Connection failed");
        });

        it('should include input dropdown when hostname is set and no error', () => {
            const settings = {
                hostname: "192.168.1.100",
                inputs: [
                    { title: 'CBL/SAT', value: 'SAT/CBL' },
                    { title: 'DVD', value: 'DVD' }
                ]
            };

            const layout = extension.makeLayout(settings);

            expect(layout.has_error).toBe(false);
            const inputField = layout.layout.find(field => field.setting === "setsource");
            expect(inputField).toBeDefined();
            expect(inputField.values).toEqual(settings.inputs);
        });

        it('should detect settings changes requiring reconnection', () => {
            const oldSettings = {
                hostname: "192.168.1.100",
                zone: "main",
                setsource: "CBL/SAT",
                powerOffBothZones: true
            };

            const newSettings = {
                hostname: "192.168.1.101", // Changed
                zone: "main",
                setsource: "CBL/SAT",
                powerOffBothZones: true
            };

            expect(extension.shouldReconnect(oldSettings, newSettings)).toBe(true);

            newSettings.hostname = "192.168.1.100";
            expect(extension.shouldReconnect(oldSettings, newSettings)).toBe(false);
        });
    });

    describe('Connection Management', () => {
        it('should setup connection with valid hostname', () => {
            const Denon = require('denon-client');
            
            extension.setupConnection("192.168.1.100");

            expect(Denon.DenonClient).toHaveBeenCalledWith("192.168.1.100");
            expect(extension.client).toBeDefined();
            expect(mockStatus.set_status).toHaveBeenCalledWith("Connecting to 192.168.1.100...", false);
        });

        it('should handle empty hostname', () => {
            extension.setupConnection("");

            expect(mockStatus.set_status).toHaveBeenCalledWith("Not configured, please check settings.", true);
            expect(extension.client).toBeNull();
        });

        it('should cleanup existing connection before new setup', () => {
            // First connection
            extension.setupConnection("192.168.1.100");
            const firstClient = extension.client;

            // Second connection should cleanup first
            extension.setupConnection("192.168.1.101");

            expect(firstClient.removeAllListeners).toHaveBeenCalledWith("close");
            expect(firstClient.disconnect).toHaveBeenCalled();
            expect(extension.client).not.toBe(firstClient);
        });

        it('should setup keep-alive timer', () => {
            jest.useFakeTimers();
            
            extension.setupConnection("192.168.1.100");
            expect(extension.keepaliveTimer).not.toBeNull();
            
            // Mock getBrightness to return a resolved promise
            extension.client.getBrightness.mockResolvedValue(2);

            // Fast-forward time to trigger keep-alive
            jest.advanceTimersByTime(60000);
            expect(extension.client.getBrightness).toHaveBeenCalled();

            jest.useRealTimers();
        });

        it('should setup event handlers', () => {
            extension.setupConnection("192.168.1.100");

            expect(extension.client.socket.on).toHaveBeenCalledWith("error", expect.any(Function));
            expect(extension.client.socket.on).toHaveBeenCalledWith("timeout", expect.any(Function));
            expect(extension.client.on).toHaveBeenCalledWith("data", expect.any(Function));
            expect(extension.client.on).toHaveBeenCalledWith("close", expect.any(Function));
            expect(extension.client.on).toHaveBeenCalledWith("powerChanged", expect.any(Function));
            expect(extension.client.on).toHaveBeenCalledWith("inputChanged", expect.any(Function));
            expect(extension.client.on).toHaveBeenCalledWith("muteChanged", expect.any(Function));
            expect(extension.client.on).toHaveBeenCalledWith("masterVolumeChanged", expect.any(Function));
            expect(extension.client.on).toHaveBeenCalledWith("masterVolumeMaxChanged", expect.any(Function));
            expect(extension.client.on).toHaveBeenCalledWith("zone2Changed", expect.any(Function));
        });
    });

    describe('Volume Control', () => {
        let mockClient;
        
        beforeEach(async () => {
            // Create fresh mock client for this test
            mockClient = createMockDenonClient();
            mockClient.connect.mockResolvedValue();
            mockClient.getVolume.mockResolvedValue(60);
            mockClient.getMaxVolume.mockResolvedValue(98);
            mockClient.getMute.mockResolvedValue('MUOFF');
            
            extension.settings.zone = "main";
            extension.client = mockClient;
            await extension.createVolumeControl();
        });

        it('should create volume control with proper state', () => {
            expect(extension.volumeState).toBeDefined();
            expect(extension.volumeState.display_name).toBe("Main Zone");
            expect(extension.volumeState.volume_type).toBe("db");
            expect(extension.volumeState.volume_min).toBe(-79.5);
            expect(extension.volumeState.volume_step).toBe(0.5);
            expect(extension.volumeState.volume_value).toBe(-20); // 60 - 80
            expect(extension.volumeState.volume_max).toBe(18); // 98 - 80
            expect(extension.volumeState.is_muted).toBe(false);
        });

        it('should handle absolute volume setting', () => {
            const req = { send_complete: jest.fn() };
            mockClient.setVolume.mockResolvedValue();

            extension.setVolume(req, "absolute", -10);

            expect(mockClient.setVolume).toHaveBeenCalledWith(70); // -10 + 80
        });

        it('should handle relative volume setting', () => {
            const req = { send_complete: jest.fn() };
            mockClient.setVolume.mockResolvedValue();
            extension.volumeState.volume_value = -20;

            extension.setVolume(req, "relative", 5);

            expect(mockClient.setVolume).toHaveBeenCalledWith(65); // (-20 + 5) + 80
        });

        it('should clamp volume to valid range', () => {
            const req = { send_complete: jest.fn() };
            mockClient.setVolume.mockResolvedValue();

            // Test minimum clamp
            extension.setVolume(req, "absolute", -100);
            expect(mockClient.setVolume).toHaveBeenCalledWith(0.5); // -79.5 + 80

            // Test maximum clamp
            extension.setVolume(req, "absolute", 50);
            expect(mockClient.setVolume).toHaveBeenCalledWith(98); // 18 + 80
        });

        it('should handle mute toggle', () => {
            const req = { send_complete: jest.fn() };
            mockClient.setMute.mockResolvedValue();
            extension.volumeState.is_muted = false;

            extension.setMute(req);

            expect(mockClient.setMute).toHaveBeenCalledWith('MUON'); // Turn on mute
        });
    });

    describe('Event Handlers', () => {
        let mockClient;

        beforeEach(() => {
            mockClient = createMockDenonClient();
            extension.client = mockClient;
            extension.volumeState = {
                is_muted: false,
                volume_value: -20,
                volume_max: 18
            };
            extension.sourceState = {
                Power: "ON",
                Input: "CBL/SAT"
            };
            extension.volumeControl = { update_state: jest.fn() };
            extension.sourceControl = { update_state: jest.fn() };
            extension.zoneFunctions = { checkStatus: jest.fn().mockReturnValue("selected") };
        });

        it('should handle power change events', () => {
            extension.handlePowerChanged("STANDBY");

            expect(extension.sourceState.Power).toBe("STANDBY");
            expect(extension.sourceControl.update_state).toHaveBeenCalledWith({ status: "selected" });
        });

        it('should handle input change events', () => {
            extension.handleInputChanged("DVD");

            expect(extension.sourceState.Input).toBe("DVD");
            expect(extension.sourceControl.update_state).toHaveBeenCalledWith({ status: "selected" });
        });

        it('should handle mute change events', () => {
            extension.handleMuteChanged('MUON');

            expect(extension.volumeState.is_muted).toBe(true);
            expect(extension.volumeControl.update_state).toHaveBeenCalledWith({
                is_muted: true
            });
        });

        it('should handle volume change events', () => {
            extension.handleVolumeChanged(75);

            expect(extension.volumeState.volume_value).toBe(-5); // 75 - 80
            expect(extension.volumeControl.update_state).toHaveBeenCalledWith({
                volume_value: -5
            });
        });

        it('should handle volume max change events', () => {
            extension.handleVolumeMaxChanged(90);

            expect(extension.volumeState.volume_max).toBe(10); // 90 - 80
            expect(extension.volumeControl.update_state).toHaveBeenCalledWith({
                volume_max: 10
            });
        });

        it('should handle zone2 change events when zone2 is selected', () => {
            extension.settings.zone = "zone2";
            const oldPower = extension.sourceState.Power;
            extension.sourceState.Power = "STANDBY"; // Set different initial state
            
            extension.handleZone2Changed('Z2ON');

            expect(extension.sourceState.Power).toBe("ON");
            expect(extension.sourceControl.update_state).toHaveBeenCalledWith({ status: "selected" });
        });

        it('should ignore zone2 events when main zone is selected', () => {
            extension.settings.zone = "main";
            const originalPower = extension.sourceState.Power;
            
            extension.handleZone2Changed('Z2ON');

            expect(extension.sourceState.Power).toBe(originalPower);
            expect(extension.sourceControl.update_state).not.toHaveBeenCalled();
        });
    });

    describe('Start Method', () => {
        it('should start discovery and setup connection', () => {
            const setupConnectionSpy = jest.spyOn(extension, 'setupConnection');
            
            extension.start();

            expect(setupConnectionSpy).toHaveBeenCalledWith("192.168.1.100");
            expect(mockRoonApi.start_discovery).toHaveBeenCalled();
        });
    });

    describe('Cleanup', () => {
        it('should cleanup all resources', () => {
            // Setup some state
            const mockClient = createMockDenonClient();
            extension.client = mockClient;
            extension.keepaliveTimer = setInterval(() => {}, 1000);
            extension.volumeControl = { update_state: jest.fn() };
            extension.sourceControl = { update_state: jest.fn() };
            extension.volumeState = { test: true };
            extension.sourceState = { test: true };

            extension.cleanup();

            expect(extension.client).toBeNull();
            expect(extension.keepaliveTimer).toBeNull();
            expect(extension.volumeControl).toBeNull();
            expect(extension.sourceControl).toBeNull();
            expect(extension.volumeState).toBeNull();
            expect(extension.sourceState).toBeNull();
            expect(mockClient.removeAllListeners).toHaveBeenCalledWith("close");
            expect(mockClient.disconnect).toHaveBeenCalled();
        });
    });
});