const { describe, test, expect, beforeEach } = require("@jest/globals");

describe("AudysseyControl", () => {
    let AudysseyControl;
    let mockClient;
    let mockSocket;
    let audyssey;

    beforeEach(() => {
        // Clear module cache to get fresh instance
        jest.resetModules();

        // Create mock socket
        mockSocket = {
            write: jest.fn(),
            destroyed: false,
        };

        // Create mock Denon client
        mockClient = {
            socket: mockSocket,
            on: jest.fn(),
            removeListener: jest.fn(),
        };

        // Import module after mocks are set up
        AudysseyControl = require("../src/audyssey-control");
        audyssey = new AudysseyControl(mockClient);
    });

    describe("setDynamicEQ", () => {
        test("should send PSDYNEQ ON command when enabled", async () => {
            // Simulate response from receiver
            setTimeout(() => {
                const dataCallback = mockClient.on.mock.calls.find(
                    (call) => call[0] === "data",
                )[1];
                dataCallback(Buffer.from("PSDYNEQ ON\r"));
            }, 10);

            const result = await audyssey.setDynamicEQ(true);

            expect(mockSocket.write).toHaveBeenCalledWith("PSDYNEQ ON\r");
            expect(result).toBe(true);
        });

        test("should send PSDYNEQ OFF command when disabled", async () => {
            setTimeout(() => {
                const dataCallback = mockClient.on.mock.calls.find(
                    (call) => call[0] === "data",
                )[1];
                dataCallback(Buffer.from("PSDYNEQ OFF\r"));
            }, 10);

            const result = await audyssey.setDynamicEQ(false);

            expect(mockSocket.write).toHaveBeenCalledWith("PSDYNEQ OFF\r");
            expect(result).toBe(false);
        });
    });

    describe("getDynamicEQ", () => {
        test("should return true when Dynamic EQ is ON", async () => {
            setTimeout(() => {
                const dataCallback = mockClient.on.mock.calls.find(
                    (call) => call[0] === "data",
                )[1];
                dataCallback(Buffer.from("PSDYNEQ ON\r"));
            }, 10);

            const result = await audyssey.getDynamicEQ();

            expect(mockSocket.write).toHaveBeenCalledWith("PSDYNEQ ?\r");
            expect(result).toBe(true);
        });

        test("should return false when Dynamic EQ is OFF", async () => {
            setTimeout(() => {
                const dataCallback = mockClient.on.mock.calls.find(
                    (call) => call[0] === "data",
                )[1];
                dataCallback(Buffer.from("PSDYNEQ OFF\r"));
            }, 10);

            const result = await audyssey.getDynamicEQ();

            expect(result).toBe(false);
        });
    });

    describe("setDynamicVolume", () => {
        test("should send PSDYNVOL OFF command", async () => {
            setTimeout(() => {
                const dataCallback = mockClient.on.mock.calls.find(
                    (call) => call[0] === "data",
                )[1];
                dataCallback(Buffer.from("PSDYNVOL OFF\r"));
            }, 10);

            const result = await audyssey.setDynamicVolume("OFF");

            expect(mockSocket.write).toHaveBeenCalledWith("PSDYNVOL OFF\r");
            expect(result).toBe("OFF");
        });

        test("should send PSDYNVOL LIT command", async () => {
            setTimeout(() => {
                const dataCallback = mockClient.on.mock.calls.find(
                    (call) => call[0] === "data",
                )[1];
                dataCallback(Buffer.from("PSDYNVOL LIT\r"));
            }, 10);

            const result = await audyssey.setDynamicVolume("LIT");

            expect(mockSocket.write).toHaveBeenCalledWith("PSDYNVOL LIT\r");
            expect(result).toBe("LIT");
        });

        test("should reject invalid Dynamic Volume level", async () => {
            await expect(audyssey.setDynamicVolume("INVALID")).rejects.toThrow(
                "Invalid Dynamic Volume level",
            );
        });
    });

    describe("setReferenceLevel", () => {
        test("should send PSREFLEV 5 command", async () => {
            setTimeout(() => {
                const dataCallback = mockClient.on.mock.calls.find(
                    (call) => call[0] === "data",
                )[1];
                dataCallback(Buffer.from("PSREFLEV 5\r"));
            }, 10);

            const result = await audyssey.setReferenceLevel(5);

            expect(mockSocket.write).toHaveBeenCalledWith("PSREFLEV 5\r");
            expect(result).toBe(5);
        });

        test("should reject invalid Reference Level", async () => {
            await expect(audyssey.setReferenceLevel(3)).rejects.toThrow(
                "Invalid Reference Level",
            );
        });
    });

    describe("toggleDynamicEQ", () => {
        test("should toggle from OFF to ON", async () => {
            let callCount = 0;

            // Mock responses for both query and set operations
            mockClient.on.mockImplementation((event, callback) => {
                if (event === "data") {
                    // Intercept write calls to trigger responses
                    const originalWrite = mockSocket.write;
                    mockSocket.write = jest.fn((cmd) => {
                        originalWrite.call(mockSocket, cmd);
                        setTimeout(() => {
                            if (cmd.includes("?")) {
                                // Query response
                                callback(Buffer.from("PSDYNEQ OFF\r"));
                            } else if (cmd.includes("ON")) {
                                // Set ON response
                                callback(Buffer.from("PSDYNEQ ON\r"));
                            }
                        }, 5);
                    });
                }
            });

            const result = await audyssey.toggleDynamicEQ();

            expect(result).toBe(true);
        });
    });
});
